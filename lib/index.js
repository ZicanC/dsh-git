import { Session, SessionId, SessionLogOffset, SessionSeq } from "@deepseek-ai/dsh-session";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rmdir, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { defineDomain, domainTable } from "@deepseek-ai/dsh-storage-domain";
import { z } from "zod";
//#region lib/types/merge-lineage.js
/**
* Durable provenance of one merge branch, written into the merged Session's seed.
*
* The graph ledger in `./graph-domain.ts` is the working store, but it is a
* separate medium from the session log: delete the storage root and the merge
* edges are gone. This event travels inside the log itself, so a merged Session
* always carries the coordinates it was assembled from.
*
* It must be marked `ignorable`. `session-persistence` refuses to interpret a
* log holding an event type outside `KNOWN_SESSION_EVENT_TYPES` unless the
* writer set that flag, and a plugin cannot extend that build-time set — an
* unmarked event here would make every merged Session unloadable. `ignorable`
* cannot be passed through `Session.append`, so the event is constructed
* directly and placed in the seed, which is the only write path that accepts it.
*/
const MERGE_LINEAGE_EVENT = "dsh-git/merge";
/**
* The same event after Harness's format v3 to v4 migration, which moves every
* ignorable event it does not know into the `plugin:` namespace. Logs written
* on format v4 keep {@link MERGE_LINEAGE_EVENT}; only migrated ones carry this.
*/
const MIGRATED_MERGE_LINEAGE_EVENT = `plugin:${MERGE_LINEAGE_EVENT}`;
/** Build the seed-tail lineage event for a merged Session. */
function mergeLineageEvent(sources, seq, time) {
	const lineage = { sources: sources.map((source, index) => ({
		...source.viaSessionId === void 0 ? {} : { viaSessionId: source.viaSessionId },
		sourceSessionId: source.sourceSessionId,
		sourceTurn: source.sourceTurn,
		sourceBoundarySeq: source.sourceBoundarySeq,
		targetTurn: index + 1,
		...source.sourceLabel === void 0 ? {} : { sourceLabel: source.sourceLabel }
	})) };
	return {
		type: MERGE_LINEAGE_EVENT,
		seq: SessionSeq(seq),
		time,
		data: lineage,
		ignorable: true
	};
}
/** Recover merge lineage from a Session log, or `undefined` for an ordinary Session. */
function readMergeLineage(events) {
	for (const event of events) {
		const type = event.type;
		if (type !== "dsh-git/merge" && type !== MIGRATED_MERGE_LINEAGE_EVENT) continue;
		const data = event.data;
		if (!Array.isArray(data.sources)) continue;
		return { sources: data.sources };
	}
}
//#endregion
//#region lib/types/fork-origin.js
function inheritedCount(snapshot) {
	return snapshot.inheritedEventCount ?? 0;
}
function sameEvent(left, right) {
	if (left === void 0 || right === void 0) return false;
	return left.type === right.type && left.seq === right.seq && left.time === right.time && JSON.stringify(left) === JSON.stringify(right);
}
/** Whether `candidate` holds, event for event, the whole prefix `fork` inherited. */
function holdsInheritedPrefix(fork, candidate) {
	const count = inheritedCount(fork);
	if (candidate.events.length < count) return false;
	for (let index = count - 1; index >= 0; index -= 1) if (!sameEvent(fork.events[index], candidate.events[index])) return false;
	return true;
}
/**
* The Session a fork inherited its prefix from.
*
* A parent recorded in the header (Harness before 0.2.1-rc.3, and every
* Session this plugin composes) is returned as it is. Otherwise the origin is
* the candidate that holds the inherited prefix verbatim and wrote its last
* event itself: a sibling fork of the same prefix inherited that event too, so
* it is not where the history comes from.
* @param candidates - Sessions the origin may be among; the fork itself is skipped.
* @returns the origin's Session id, or undefined when the Session is not a
*   fork or its origin is not among the candidates.
*/
function forkOrigin(fork, candidates) {
	if (fork.session.parentSession !== void 0) return fork.session.parentSession;
	const count = inheritedCount(fork);
	if (count === 0 || readMergeLineage(fork.events) !== void 0) return void 0;
	let origin;
	for (const candidate of candidates) {
		if (candidate.session.id === fork.session.id || inheritedCount(candidate) >= count) continue;
		if (!holdsInheritedPrefix(fork, candidate)) continue;
		if (origin === void 0 || candidate.session.createdAt < origin.session.createdAt || candidate.session.createdAt === origin.session.createdAt && String(candidate.session.id) < String(origin.session.id)) origin = candidate;
	}
	return origin === void 0 ? void 0 : String(origin.session.id);
}
//#endregion
//#region lib/types/graph-ledger.js
/** Identity survives projection into another scope and does not depend on labels. */
function identityOf(state, id) {
	const seen = /* @__PURE__ */ new Set();
	let node = state.nodes[id];
	while (node?.forkSourceId !== void 0) {
		if (seen.has(node.id)) throw new Error("Cyclic fork identity");
		seen.add(node.id);
		node = state.nodes[node.forkSourceId];
	}
	if (node === void 0) throw new Error(`Missing PA identity: ${id}`);
	return node.paId ?? `pa:${encodeURIComponent(node.sessionId)}:${node.turn}:${node.boundarySeq}`;
}
/** Everything a record waits for before it can be finalized. */
function finalizationDependencies(node) {
	return [
		...node.parentIds,
		...node.forkSourceId === void 0 ? [] : [node.forkSourceId],
		...node.contextKnown === true ? node.contextManifest : []
	];
}
/** Append stable numbering in dependency order. Existing final events never move. */
function finalizeGraph(state) {
	const nodes = { ...state.nodes };
	let ledger = Math.max(state.ledgerSequence ?? 0, ...Object.values(nodes).map((node) => node.ledgerOrdinal ?? 0));
	let event = Math.max(state.finalSequence ?? 0, ...Object.values(nodes).map((node) => node.finalOrdinal ?? 0));
	for (const node of Object.values(nodes)) {
		const label = /^PA([1-9]\d*)$/.exec(node.displayLabel ?? "");
		if (label !== null) ledger = Math.max(ledger, Number(label[1]));
	}
	const pending = new Map(Object.values(nodes).filter((node) => node.finalOrdinal === void 0).sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)).map((node) => [node.id, node]));
	while (pending.size > 0) {
		let progressed = false;
		for (const [id, node] of pending) {
			if (finalizationDependencies(node).some((dep) => nodes[dep]?.finalOrdinal === void 0)) continue;
			const source = node.forkSourceId === void 0 ? void 0 : nodes[node.forkSourceId];
			nodes[id] = {
				...node,
				paId: identityOf({
					...state,
					nodes
				}, id),
				ledgerOrdinal: source?.ledgerOrdinal ?? node.ledgerOrdinal ?? ++ledger,
				finalOrdinal: ++event
			};
			pending.delete(id);
			progressed = true;
			break;
		}
		if (!progressed) break;
	}
	return {
		...state,
		nodes,
		ledgerSequence: ledger,
		finalSequence: event
	};
}
/** Semantic validation at the write boundary; malformed batches are never repaired silently. */
function assertGraphSemantics(state) {
	const unique = (ids, label) => {
		if (new Set(ids).size !== ids.length) throw new Error(`Duplicate ${label}`);
	};
	const requireNode = (id) => {
		if (state.nodes[id] === void 0) throw new Error(`Missing graph reference: ${id}`);
	};
	const validateContext = (manifest, refs) => {
		manifest.forEach(requireNode);
		unique(manifest.map((id) => identityOf(state, id)), "Context identity");
		if (refs === void 0) return manifest;
		unique(refs.map((ref) => ref.paId), "Context identity");
		if (refs.length !== manifest.length) throw new Error("Context references disagree");
		return refs.map((ref, index) => {
			if (ref.paId !== identityOf(state, manifest[index])) throw new Error("Context identity disagrees");
			const matches = Object.values(state.sessionTurnRefs[ref.viaSessionId] ?? {}).filter((id) => state.nodes[id] !== void 0 && identityOf(state, id) === ref.paId);
			if (matches.length !== 1) throw new Error("Context source is not a unique history member");
			return matches[0];
		});
	};
	const dependencies = /* @__PURE__ */ new Map();
	const occurrences = /* @__PURE__ */ new Set();
	const originals = /* @__PURE__ */ new Set();
	const events = /* @__PURE__ */ new Set();
	const numbers = /* @__PURE__ */ new Set();
	for (const [id, node] of Object.entries(state.nodes)) {
		if (id !== node.id) throw new Error("Node key must match its id");
		unique(node.parentIds, "parents");
		unique(node.contextManifest, "Context");
		if (node.parentIds.includes(id) || node.contextManifest.includes(id)) throw new Error("Self reference");
		if (node.parentIds.length === 0 !== (node.primaryParentId === null) || node.primaryParentId !== null && !node.parentIds.includes(node.primaryParentId)) throw new Error("Primary parent must agree with parents");
		if (node.forkSourceId !== void 0 && node.parentIds.length !== 0) throw new Error("Fork copies cannot have parents");
		const refs = [
			...node.parentIds,
			...node.contextManifest,
			...node.forkSourceId === void 0 ? [] : [node.forkSourceId]
		];
		refs.forEach(requireNode);
		dependencies.set(id, refs);
		if (node.finalOrdinal !== void 0) {
			if (events.has(node.finalOrdinal)) throw new Error("Duplicate finalization ordinal");
			events.add(node.finalOrdinal);
		}
		if (node.forkSourceId === void 0 && node.ledgerOrdinal !== void 0) {
			if (numbers.has(node.ledgerOrdinal)) throw new Error("Duplicate PA ordinal");
			numbers.add(node.ledgerOrdinal);
		}
	}
	const done = /* @__PURE__ */ new Set();
	const visiting = /* @__PURE__ */ new Set();
	const visit = (id) => {
		if (done.has(id)) return;
		if (visiting.has(id)) throw new Error("Cyclic graph dependencies");
		visiting.add(id);
		for (const dep of dependencies.get(id) ?? []) visit(dep);
		visiting.delete(id);
		done.add(id);
	};
	for (const id of dependencies.keys()) visit(id);
	for (const node of Object.values(state.nodes)) {
		const identity = identityOf(state, node.id);
		const occurrence = JSON.stringify([node.sessionId, identity]);
		if (occurrences.has(occurrence)) throw new Error("Duplicate Session PA occurrence");
		occurrences.add(occurrence);
		if (node.forkSourceId === void 0) {
			if (originals.has(identity)) throw new Error("Duplicate original PA identity");
			originals.add(identity);
		} else {
			const source = state.nodes[node.forkSourceId];
			if (node.paId !== void 0 && node.paId !== identity || node.ledgerOrdinal !== source.ledgerOrdinal) throw new Error("Fork identity does not match source");
		}
		const resolved = validateContext(node.contextManifest, node.contextRefs);
		if (node.contextRefs !== void 0 && node.parentIds.length > 1) {
			const terminals = /* @__PURE__ */ new Map();
			node.contextRefs.forEach((ref, index) => terminals.set(ref.viaSessionId, index));
			const expected = [...terminals.values()].sort((a, b) => a - b).map((index) => resolved[index]);
			if (JSON.stringify(expected) !== JSON.stringify(node.parentIds) || node.primaryParentId !== expected.at(-1)) throw new Error("Merge parents disagree with Context sources");
		}
	}
	for (const refs of Object.values(state.sessionTurnRefs)) Object.values(refs).forEach(requireNode);
	validateContext(state.contextManifest);
	for (const pending of Object.values(state.pendingMerges)) {
		validateContext(pending.contextManifest, pending.contextRefs);
		unique(pending.parentIds, "pending parents");
		pending.parentIds.forEach(requireNode);
		if (pending.primaryParentId === null || !pending.parentIds.includes(pending.primaryParentId)) throw new Error("Pending primary parent must agree with parents");
	}
}
const nodeId = z.string().min(1);
const turnNodeSchema = z.object({
	id: nodeId,
	paId: nodeId.optional(),
	ledgerOrdinal: z.number().int().positive().optional(),
	finalOrdinal: z.number().int().positive().optional(),
	contextKnown: z.boolean().optional(),
	contextRefs: z.array(z.object({
		paId: nodeId,
		viaSessionId: nodeId
	})).optional(),
	displayLabel: z.string().regex(/^(PA[1-9]\d*(?: fork)?|S[1-9]\d*\.[1-9]\d*)$/).optional(),
	sessionId: z.string().min(1),
	turn: z.number().int().nonnegative(),
	prompt: z.string(),
	answer: z.string(),
	createdAt: z.number(),
	boundarySeq: z.number().int().nonnegative(),
	primaryParentId: nodeId.nullable(),
	parentIds: z.array(nodeId),
	contextManifest: z.array(nodeId),
	branchId: z.string().min(1),
	forkSourceId: nodeId.optional()
});
const branchSchema = z.object({
	id: z.string().min(1),
	name: z.string().min(1),
	sessionId: z.string().min(1),
	headId: nodeId.nullable(),
	color: z.number().int(),
	createdAt: z.number()
});
const pendingMergeSchema = z.object({
	contextRefs: z.array(z.object({
		paId: nodeId,
		viaSessionId: nodeId
	})).optional(),
	branchId: z.string().min(1),
	parentIds: z.array(nodeId),
	primaryParentId: nodeId.nullable(),
	contextManifest: z.array(nodeId),
	prompt: z.string().optional()
});
const anchorModeSchema = z.object({
	sourceSessionId: z.string().min(1),
	nodeIds: z.array(nodeId).min(1),
	workspaceId: z.string().min(1),
	workspacePath: z.string().min(1),
	workspaceTitle: z.string().min(1),
	createdAt: z.number()
});
/** One scope's complete ledger, as stored and as accepted off the wire. */
const storedGraphShape = z.object({
	format: z.literal(1),
	revision: z.number().int().nonnegative().optional(),
	ledgerSequence: z.number().int().nonnegative().optional(),
	finalSequence: z.number().int().nonnegative().optional(),
	nodes: z.record(z.string(), turnNodeSchema),
	branches: z.record(z.string(), branchSchema),
	sessionBranches: z.record(z.string(), z.string().min(1)),
	sessionTurnRefs: z.record(z.string(), z.record(z.string(), nodeId)),
	pendingMerges: z.record(z.string(), pendingMergeSchema),
	anchors: z.record(z.string(), anchorModeSchema).default({}),
	headNodeId: nodeId.nullable(),
	previewNodeId: nodeId.nullable(),
	contextManifest: z.array(nodeId)
});
/** Existing format-1 records remain readable; every new write receives semantic validation. */
const graphStateSchema = storedGraphShape.superRefine((state, ctx) => {
	try {
		assertGraphSemantics(state);
	} catch (error) {
		ctx.addIssue({
			code: "custom",
			message: error instanceof Error ? error.message : String(error)
		});
	}
});
/**
* The graph domain. `UNIT_NAME_RE` is `/^[a-z][a-z0-9_]*$/`, so the domain and
* table names are underscore-separated rather than matching the package name.
*/
const GRAPH_DOMAIN = defineDomain({
	name: "dsh_git_graph",
	version: 1,
	tables: { scopes: domainTable(storedGraphShape) }
});
/** Reject a scope id that is blank or larger than one record key should be. */
function assertScopeId(value) {
	if (typeof value !== "string" || value.trim() === "") throw new Error("dsh-git graph scopeId must be a non-blank string");
	if (value.length > 512) throw new Error(`dsh-git graph scopeId exceeds 512 characters`);
	return value;
}
//#endregion
//#region lib/types/project-history.js
/** Host-side projection of complete Session logs into project graph PA records. */
function contentText(value) {
	if (!Array.isArray(value)) return "";
	return value.flatMap((block) => {
		const candidate = block;
		return candidate.type === "text" && typeof candidate.text === "string" ? [candidate.text] : [];
	}).join("\n");
}
function userText(event) {
	if (event.type !== "user/message") return void 0;
	return contentText(event.data.content);
}
function assistantText(event) {
	if (event.type !== "assistant/message") return void 0;
	const message = event.data.message;
	return contentText(message?.content);
}
function fingerprint(events) {
	const material = events.flatMap((event) => {
		const user = userText(event);
		if (user !== void 0) return [{
			type: "user",
			text: user
		}];
		const assistant = assistantText(event);
		if (assistant !== void 0) return [{
			type: "assistant",
			text: assistant
		}];
		return [];
	});
	return createHash("sha256").update(JSON.stringify(material)).digest("hex");
}
/** Extract only balanced, completed, non-empty PA turns from one complete Session log. */
function projectTurns(snapshot) {
	const turns = [];
	const starts = /* @__PURE__ */ new Map();
	for (const event of snapshot.events) {
		if (event.type === "turn/start") {
			starts.set(event.data.turn, event);
			continue;
		}
		if (event.type !== "turn/end") continue;
		const start = starts.get(event.data.turn);
		if (start === void 0 || start.seq >= event.seq) continue;
		const events = snapshot.events.slice(start.seq + 1, event.seq);
		const prompt = events.flatMap((candidate) => userText(candidate) ?? []).filter(Boolean).join("\n");
		const answer = events.flatMap((candidate) => assistantText(candidate) ?? []).filter(Boolean).join("\n\n");
		if (prompt === "" && answer === "") continue;
		turns.push({
			turn: event.data.turn,
			prompt,
			answer,
			startedAt: start.time,
			completedAt: event.time,
			boundarySeq: event.seq,
			inherited: event.seq < (snapshot.inheritedEventCount ?? 0),
			fingerprint: fingerprint(events)
		});
	}
	return turns.sort((left, right) => left.turn - right.turn);
}
/**
* Convert one complete Session snapshot into the project graph wire record.
* @param origin - the Session an official fork was taken from, when the header
*   does not record it (see `./fork-origin.ts`).
*/
function projectSession(snapshot, origin) {
	const lineage = readMergeLineage(snapshot.events);
	const parentSessionId = snapshot.session.parentSession ?? origin;
	return {
		sessionId: snapshot.session.id,
		createdAt: snapshot.session.createdAt,
		...parentSessionId === void 0 ? {} : { parentSessionId },
		seedLength: snapshot.inheritedEventCount ?? 0,
		...lineage === void 0 ? {} : { mergeSources: lineage.sources },
		turns: projectTurns(snapshot)
	};
}
//#endregion
//#region lib/types/history.js
/**
* Event types a selected turn carries into the merged seed.
*
* `system/message` and `developer/message` are deliberately absent. Both
* describe the source Session's own composition — its rendered system prompt
* and its tool roster — and a `developer/message` cites a `request/header` by
* seq that may lie outside the copied turn. The seed opens with one system
* message of its own instead (see {@link SeedHead}), and the child's first
* request diffs its tools against the last copied `request/header`.
*/
const COPIED_EVENT_TYPES = /* @__PURE__ */ new Set([
	"turn/start",
	"turn/end",
	"step/start",
	"step/end",
	"user/message",
	"assistant/attempt",
	"assistant/message",
	"tool/call",
	"tool/result",
	"request/header",
	"request/context"
]);
function sourceTurnEvents(snapshot, source) {
	const end = snapshot.events[source.sourceBoundarySeq];
	if (end?.type !== "turn/end" || end.data.turn !== source.sourceTurn) throw new Error(`source session "${source.sourceSessionId}" seq ${source.sourceBoundarySeq} is not turn ${source.sourceTurn}'s end`);
	let startIndex = -1;
	for (let index = source.sourceBoundarySeq; index >= 0; index -= 1) {
		const event = snapshot.events[index];
		if (event?.type === "turn/start" && event.data.turn === source.sourceTurn) {
			startIndex = index;
			break;
		}
	}
	if (startIndex < 0) throw new Error(`source session "${source.sourceSessionId}" has no start for turn ${source.sourceTurn}`);
	return snapshot.events.slice(startIndex, source.sourceBoundarySeq + 1);
}
function mappedSources(event, seqMap) {
	if (!("sourceEventSeqs" in event) || event.sourceEventSeqs === void 0) return void 0;
	const mapped = event.sourceEventSeqs.flatMap((seq) => {
		const target = seqMap.get(seq);
		return target === void 0 ? [] : [SessionSeq(target)];
	});
	return mapped.length === 0 && event.sourceEventSeqs.length > 0 ? void 0 : mapped;
}
/** Whether a system node carries a prompt, by the rule the loop applies to its own nodes. */
function hasPrompt(message) {
	const [block] = message.content;
	return message.content.length > 1 || block !== void 0 && !(block.type === "text" && block.text === "");
}
/**
* The system message in effect at one point of a source log: the last
* surviving system node that carries a prompt, else the first system node.
* @param throughSeq - inclusive seq the surface is folded through.
* @returns the message, or undefined when the log has no system node there.
*/
function effectiveSystemMessage(events, throughSeq) {
	const surface = [];
	for (const event of events) {
		if (event.seq > throughSeq) break;
		if (!("surfaceOp" in event) || event.surfaceOp === void 0) continue;
		const operation = event.surfaceOp;
		if (operation === "append") {
			surface.push(event);
			continue;
		}
		const first = surface.findIndex((node) => node.seq === operation.startSeq);
		const last = surface.findIndex((node) => node.seq === operation.endSeq);
		if (first < 0 || last < first) continue;
		surface.splice(first, last - first + 1, event);
	}
	const nodes = surface.flatMap((event) => event.type === "system/message" ? [event.data.message] : []);
	return nodes.findLast(hasPrompt) ?? nodes[0];
}
/** A system node recording "no system prompt", for a source log that has none to copy. */
function emptySystemMessage() {
	return {
		id: randomUUID(),
		role: "system",
		content: [],
		source: { kind: "system-prompt" }
	};
}
function isSurfaceEvent(event) {
	return event.type === "user/message" || event.type === "assistant/message" || event.type === "tool/result";
}
/**
* Copy one completed source turn into a detached target as a newly numbered real turn.
* @param head - the seed's opening system message; written as the first
*   surface node, inside the first step the copied turns open.
*/
function appendHistoricalTurn(target, sourceEvents, targetTurn, head) {
	const seqMap = /* @__PURE__ */ new Map();
	const held = [];
	const placeHead = (step) => {
		if (head === void 0 || head.placed) return;
		target.append("system/message", {
			turn: targetTurn,
			step,
			message: head.message
		}, { surfaceOp: "append" });
		head.placed = true;
		for (const event of held.splice(0)) copy(event);
	};
	for (const event of sourceEvents) {
		if (!COPIED_EVENT_TYPES.has(event.type)) continue;
		if (head !== void 0 && !head.placed) {
			if (isSurfaceEvent(event)) {
				held.push(event);
				continue;
			}
			if (event.type === "turn/end" && held.length > 0) {
				target.append("step/start", {
					turn: targetTurn,
					step: 1
				});
				placeHead(1);
				target.append("step/end", {
					turn: targetTurn,
					step: 1
				});
			}
		}
		copy(event);
		if (event.type === "step/start") placeHead(event.data.step);
	}
	function copy(event) {
		const sourceEventSeqs = mappedSources(event, seqMap);
		let appended;
		switch (event.type) {
			case "turn/start":
				appended = target.append("turn/start", { turn: targetTurn });
				break;
			case "turn/end":
				appended = target.append("turn/end", {
					turn: targetTurn,
					reason: event.data.reason
				});
				break;
			case "step/start":
				appended = target.append("step/start", {
					...event.data,
					turn: targetTurn
				});
				break;
			case "step/end":
				appended = target.append("step/end", {
					...event.data,
					turn: targetTurn
				});
				break;
			case "assistant/attempt":
				appended = target.append("assistant/attempt", {
					...event.data,
					turn: targetTurn
				});
				break;
			case "assistant/message":
				appended = target.append("assistant/message", {
					...event.data,
					turn: targetTurn
				}, { surfaceOp: "append" });
				break;
			case "tool/call":
				appended = target.append("tool/call", {
					...event.data,
					turn: targetTurn
				});
				break;
			case "tool/result":
				if (event.surfaceOp !== "append") return;
				appended = target.append("tool/result", {
					...event.data,
					turn: targetTurn
				}, {
					surfaceOp: "append",
					...sourceEventSeqs === void 0 ? {} : { sourceEventSeqs }
				});
				break;
			case "user/message":
				appended = target.append("user/message", event.data, {
					surfaceOp: "append",
					...sourceEventSeqs === void 0 ? {} : { sourceEventSeqs }
				});
				break;
			case "request/header":
				appended = target.append("request/header", event.data);
				break;
			case "request/context":
				appended = target.append("request/context", event.data);
				break;
			default: return;
		}
		seqMap.set(event.seq, appended.seq);
	}
}
/**
* Read selected turns in tray order and produce a contiguous, balanced Agent seed.
*
* The seed closes with the log-only `dsh-git/merge` lineage event, appended
* directly rather than through `Session.append` because only a seed event may
* carry `ignorable` (see `./merge-lineage.ts`).
* @param forkOriginOf - the Session an official fork was taken from, for a
*   fork whose header records no parent (see `./fork-origin.ts`).
*/
async function buildMergedSessionSeed(targetSessionId, sources, readSession, forkOriginOf = async () => void 0) {
	const identities = /* @__PURE__ */ new Map();
	const resolve = async (source, visiting = /* @__PURE__ */ new Set()) => {
		const key = JSON.stringify([
			source.sourceSessionId,
			source.sourceTurn,
			source.sourceBoundarySeq
		]);
		if (visiting.has(key)) throw new Error("Cyclic Session provenance");
		const cached = identities.get(key);
		if (cached !== void 0) return cached;
		const next = new Set(visiting).add(key);
		const pending = (async () => {
			const snapshot = await readSession(SessionId(source.sourceSessionId));
			sourceTurnEvents(snapshot, source);
			const merged = readMergeLineage(snapshot.events)?.sources.find((item) => item.targetTurn === source.sourceTurn);
			if (merged !== void 0) return resolve(merged, next);
			if (source.sourceBoundarySeq < (snapshot.inheritedEventCount ?? 0)) {
				const origin = snapshot.session.parentSession ?? await forkOriginOf(snapshot);
				if (origin !== void 0) return resolve({
					...source,
					sourceSessionId: origin
				}, next);
			}
			return key;
		})();
		identities.set(key, pending);
		return pending;
	};
	const selected = /* @__PURE__ */ new Set();
	for (const source of sources) {
		const identity = await resolve(source);
		if (selected.has(identity)) throw new Error("Duplicate Context PA identity");
		selected.add(identity);
		if (source.viaSessionId === void 0 || source.viaSessionId === source.sourceSessionId) continue;
		const via = await readSession(SessionId(source.viaSessionId));
		let matches = 0;
		for (const turn of projectTurns(via)) if (await resolve({
			sourceSessionId: source.viaSessionId,
			sourceTurn: turn.turn,
			sourceBoundarySeq: turn.boundarySeq
		}) === identity) matches += 1;
		if (matches !== 1) throw new Error("Context source is not a unique Session history member");
	}
	const target = Session.create(SessionId(targetSessionId));
	const last = sources.at(-1);
	const head = last === void 0 ? void 0 : {
		message: effectiveSystemMessage((await readSession(SessionId(last.sourceSessionId))).events, last.sourceBoundarySeq) ?? emptySystemMessage(),
		placed: false
	};
	for (const [index, source] of sources.entries()) appendHistoricalTurn(target, sourceTurnEvents(await readSession(SessionId(source.sourceSessionId)), source), index + 1, head);
	const events = [...target.snapshotEvents()];
	events.push(mergeLineageEvent(sources, events.length, Date.now()));
	return events;
}
//#endregion
//#region lib/types/protocol.js
/** Generic Connection channel and endpoint used by the project graph reader. */
const PROJECT_GRAPH_RPC_CHANNEL = "/dsh-git";
const PROJECT_GRAPH_RPC_ENDPOINT = "workspace/graph";
const HISTORY_PREVIEW_RPC_ENDPOINT = "history/preview";
const CREATE_MERGED_SESSION_RPC_ENDPOINT = "session/create-merged";
const CREATE_ANCHORED_SESSION_RPC_ENDPOINT = "session/create-anchored";
const CREATE_ANCHOR_WORKSPACE_RPC_ENDPOINT = "workspace/create-anchor";
const CANCEL_ANCHOR_WORKSPACE_RPC_ENDPOINT = "workspace/cancel-anchor";
const ANCHORED_SESSION_PREFIX = "dsh-git-anchor-";
function isAnchoredSessionId(value) {
	return value.startsWith(ANCHORED_SESSION_PREFIX);
}
/** Endpoints backing the Host-owned graph ledger. */
const GRAPH_READ_ENDPOINT = "graph/read";
const GRAPH_WRITE_ENDPOINT = "graph/write";
function object(value, label) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${label} must be an object`);
	return value;
}
function exactKeys(value, allowed, label) {
	const allowedKeys = new Set(allowed);
	const unexpected = Object.keys(value).find((key) => !allowedKeys.has(key));
	if (unexpected !== void 0) throw new Error(`${label} contains unexpected field "${unexpected}"`);
}
function nonBlank(value, label) {
	if (typeof value !== "string" || value.trim() === "") throw new Error(`${label} must be a non-blank string`);
	return value;
}
function nonNegativeInteger(value, label) {
	if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer`);
	return value;
}
function positiveInteger(value, label) {
	const parsed = nonNegativeInteger(value, label);
	if (parsed < 1) throw new Error(`${label} must be positive`);
	return parsed;
}
function boolean(value, label) {
	if (typeof value !== "boolean") throw new Error(`${label} must be boolean`);
	return value;
}
function string(value, label) {
	if (typeof value !== "string") throw new Error(`${label} must be a string`);
	return value;
}
function jsonValue(value, label) {
	if (value === null || typeof value === "string" || typeof value === "boolean") return value;
	if (typeof value === "number") {
		if (!Number.isFinite(value)) throw new Error(`${label} must contain only finite JSON numbers`);
		return value;
	}
	if (Array.isArray(value)) return value.map((item, index) => jsonValue(item, `${label}[${index}]`));
	if (typeof value !== "object") throw new Error(`${label} must be JSON-serializable`);
	if (Object.getOwnPropertySymbols(value).length > 0) throw new Error(`${label} must not contain symbol keys`);
	return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonValue(item, `${label}.${key}`)]));
}
function decodeHistoryTurnSource(value, label) {
	const source = object(value, label);
	return {
		...source.viaSessionId === void 0 ? {} : { viaSessionId: nonBlank(source.viaSessionId, `${label} viaSessionId`) },
		sourceSessionId: nonBlank(source.sourceSessionId, `${label} sourceSessionId`),
		sourceTurn: positiveInteger(source.sourceTurn, `${label} sourceTurn`),
		sourceBoundarySeq: nonNegativeInteger(source.sourceBoundarySeq, `${label} sourceBoundarySeq`)
	};
}
function decodeHistoryTurnSources(value, label) {
	if (!Array.isArray(value) || value.length === 0 || value.length > 512) throw new Error(`${label} requires 1 to 512 source turns`);
	return value.map((source, index) => decodeHistoryTurnSource(source, `${label} source ${index + 1}`));
}
function decodeImageAttachment(value, label) {
	const attachment = object(value, label);
	const mediaType = attachment.mediaType;
	if (mediaType !== "image/png" && mediaType !== "image/jpeg" && mediaType !== "image/webp" && mediaType !== "image/gif") throw new Error(`${label} mediaType is invalid`);
	return {
		attachmentId: nonBlank(attachment.attachmentId, `${label} attachmentId`),
		mediaType,
		bytes: nonNegativeInteger(attachment.bytes, `${label} bytes`),
		width: positiveInteger(attachment.width, `${label} width`),
		height: positiveInteger(attachment.height, `${label} height`),
		...attachment.name === void 0 ? {} : { name: string(attachment.name, `${label} name`) }
	};
}
function decodeHistoryPreviewBlock(value, label) {
	const block = object(value, label);
	const type = nonBlank(block.type, `${label} type`);
	switch (type) {
		case "text":
		case "reasoning":
			if (typeof block.text !== "string") throw new Error(`${label} text must be a string`);
			return {
				type,
				text: block.text
			};
		case "image": return {
			type,
			attachment: decodeImageAttachment(block.attachment, `${label} attachment`)
		};
		case "tool-call":
			if (typeof block.arguments !== "string") throw new Error(`${label} arguments must be a string`);
			return {
				type,
				callId: nonBlank(block.callId, `${label} callId`),
				name: nonBlank(block.name, `${label} name`),
				arguments: block.arguments
			};
		case "tool-result":
			if (!Array.isArray(block.content)) throw new Error(`${label} content must be an array`);
			return {
				type,
				callId: nonBlank(block.callId, `${label} callId`),
				content: block.content.map((item, index) => decodeHistoryPreviewBlock(item, `${label} content ${index + 1}`)),
				isError: boolean(block.isError, `${label} isError`)
			};
		case "other": return {
			type,
			originalType: nonBlank(block.originalType, `${label} originalType`),
			value: jsonValue(block.value, `${label} value`)
		};
		default: throw new Error(`${label} has unknown type "${type}"`);
	}
}
function decodeHistoryPreviewBlocks(value, label) {
	if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
	return value.map((block, index) => decodeHistoryPreviewBlock(block, `${label} block ${index + 1}`));
}
function decodeHistoryPreviewRecord(value, label) {
	const record = object(value, label);
	const kind = nonBlank(record.kind, `${label} kind`);
	const seq = nonNegativeInteger(record.seq, `${label} seq`);
	switch (kind) {
		case "user": return {
			kind,
			seq,
			messageId: nonBlank(record.messageId, `${label} messageId`),
			content: decodeHistoryPreviewBlocks(record.content, `${label} content`),
			source: jsonValue(record.source, `${label} source`)
		};
		case "assistant": {
			const provenance = object(record.provenance, `${label} provenance`);
			return {
				kind,
				seq,
				step: nonNegativeInteger(record.step, `${label} step`),
				messageId: nonBlank(record.messageId, `${label} messageId`),
				blocks: decodeHistoryPreviewBlocks(record.blocks, `${label} blocks`),
				provenance: {
					provider: nonBlank(provenance.provider, `${label} provenance provider`),
					model: nonBlank(provenance.model, `${label} provenance model`)
				},
				...record.usage === void 0 ? {} : { usage: jsonValue(record.usage, `${label} usage`) }
			};
		}
		case "tool-call":
			if (typeof record.arguments !== "string") throw new Error(`${label} arguments must be a string`);
			return {
				kind,
				seq,
				step: nonNegativeInteger(record.step, `${label} step`),
				callId: nonBlank(record.callId, `${label} callId`),
				name: nonBlank(record.name, `${label} name`),
				arguments: record.arguments
			};
		case "tool-result": {
			const error = record.error === void 0 ? void 0 : object(record.error, `${label} error`);
			return {
				kind,
				seq,
				step: nonNegativeInteger(record.step, `${label} step`),
				callId: nonBlank(record.callId, `${label} callId`),
				content: decodeHistoryPreviewBlocks(record.content, `${label} content`),
				isError: boolean(record.isError, `${label} isError`),
				...error === void 0 ? {} : { error: {
					name: nonBlank(error.name, `${label} error name`),
					code: nonBlank(error.code, `${label} error code`)
				} },
				...record.meta === void 0 ? {} : { meta: jsonValue(record.meta, `${label} meta`) }
			};
		}
		case "request":
			if (record.requestKind !== "header" && record.requestKind !== "context") throw new Error(`${label} requestKind is invalid`);
			return {
				kind,
				seq,
				requestKind: record.requestKind,
				data: jsonValue(record.data, `${label} data`)
			};
		case "turn-status": return {
			kind,
			seq,
			status: nonBlank(record.status, `${label} status`),
			details: jsonValue(record.details, `${label} details`)
		};
		case "event": return {
			kind,
			seq,
			eventType: nonBlank(record.eventType, `${label} eventType`),
			data: jsonValue(record.data, `${label} data`)
		};
		default: throw new Error(`${label} has unknown kind "${kind}"`);
	}
}
/** Strictly validate an untrusted ordered history-preview request. */
function decodeHistoryPreviewRequest(value) {
	return { sources: decodeHistoryTurnSources(object(value, "dsh-git history preview request").sources, "dsh-git history preview request") };
}
/** Strictly validate the full Host history projection received across Connection. */
function decodeHistoryPreviewResponse(value) {
	const candidate = object(value, "dsh-git history preview response");
	if (!Array.isArray(candidate.turns) || candidate.turns.length === 0 || candidate.turns.length > 512) throw new Error(`dsh-git history preview response requires 1 to 512 turns`);
	return { turns: candidate.turns.map((rawTurn, index) => {
		const label = `dsh-git history preview response turn ${index + 1}`;
		const turn = object(rawTurn, label);
		const targetTurn = positiveInteger(turn.targetTurn, `${label} targetTurn`);
		if (targetTurn !== index + 1) throw new Error(`${label} targetTurn must preserve source order`);
		if (!Array.isArray(turn.records)) throw new Error(`${label} records must be an array`);
		const records = turn.records.map((record, recordIndex) => decodeHistoryPreviewRecord(record, `${label} record ${recordIndex + 1}`));
		for (let recordIndex = 1; recordIndex < records.length; recordIndex += 1) if (records[recordIndex].seq <= records[recordIndex - 1].seq) throw new Error(`${label} records must have ascending seq values`);
		return {
			source: decodeHistoryTurnSource(turn.source, `${label} source`),
			targetTurn,
			records
		};
	}) };
}
/** Strictly validate the trusted RPC request before creating any Host state. */
function decodeCreateMergedSessionRequest(value) {
	const label = "dsh-git create merged session request";
	const candidate = object(value, label);
	exactKeys(candidate, ["targetSessionId", "sources"], label);
	const sources = decodeHistoryTurnSources(candidate.sources, label);
	candidate.sources.forEach((source, index) => {
		const sourceLabel = `${label} source ${index + 1}`;
		exactKeys(object(source, sourceLabel), [
			"sourceSessionId",
			"sourceTurn",
			"sourceBoundarySeq",
			"viaSessionId"
		], sourceLabel);
	});
	return {
		targetSessionId: nonBlank(candidate.targetSessionId, `${label} targetSessionId`),
		sources
	};
}
/** Strictly validate an anchored-child creation request. */
function decodeCreateAnchoredSessionRequest(value) {
	const label = "dsh-git create anchored session request";
	const candidate = object(value, label);
	exactKeys(candidate, [
		"targetSessionId",
		"workspaceId",
		"sources"
	], label);
	const rawSources = candidate.sources;
	const sources = decodeHistoryTurnSources(candidate.sources, label).map((source, index) => {
		const sourceLabel = `${label} source ${index + 1}`;
		const raw = object(rawSources[index], sourceLabel);
		exactKeys(raw, [
			"sourceSessionId",
			"sourceTurn",
			"sourceBoundarySeq",
			"sourceLabel"
		], sourceLabel);
		const displayLabel = nonBlank(raw.sourceLabel, `${sourceLabel} sourceLabel`);
		if (!/^PA[1-9]\d*(?: fork)?$/.test(displayLabel)) throw new Error(`${sourceLabel} sourceLabel must be a PA number`);
		return {
			...source,
			sourceLabel: displayLabel
		};
	});
	return {
		targetSessionId: nonBlank(candidate.targetSessionId, `${label} targetSessionId`),
		workspaceId: nonBlank(candidate.workspaceId, `${label} workspaceId`),
		sources
	};
}
/** Validate an Anchor Workspace request without accepting a browser-supplied path. */
function decodeCreateAnchorWorkspaceRequest(value) {
	const label = "dsh-git create anchor workspace request";
	const candidate = object(value, label);
	exactKeys(candidate, [
		"sourceSessionId",
		"title",
		"sources"
	], label);
	const title = nonBlank(candidate.title, `${label} title`).trim();
	if (title.length > 200) throw new Error(`${label} title must not exceed 200 characters`);
	const sources = decodeHistoryTurnSources(candidate.sources, label);
	candidate.sources.forEach((source, index) => {
		const sourceLabel = `${label} source ${index + 1}`;
		exactKeys(object(source, sourceLabel), [
			"sourceSessionId",
			"sourceTurn",
			"sourceBoundarySeq"
		], sourceLabel);
	});
	return {
		sourceSessionId: nonBlank(candidate.sourceSessionId, `${label} sourceSessionId`),
		title,
		sources
	};
}
/** Validate an Anchor cleanup request without accepting a browser-supplied path. */
function decodeCancelAnchorWorkspaceRequest(value) {
	const label = "dsh-git cancel anchor workspace request";
	const candidate = object(value, label);
	exactKeys(candidate, [
		"sourceSessionId",
		"workspaceId",
		"sources"
	], label);
	let sources;
	if (candidate.sources !== void 0) {
		sources = decodeHistoryTurnSources(candidate.sources, label);
		candidate.sources.forEach((source, index) => {
			const sourceLabel = `${label} source ${index + 1}`;
			exactKeys(object(source, sourceLabel), [
				"sourceSessionId",
				"sourceTurn",
				"sourceBoundarySeq"
			], sourceLabel);
		});
	}
	return {
		sourceSessionId: nonBlank(candidate.sourceSessionId, `${label} sourceSessionId`),
		workspaceId: nonBlank(candidate.workspaceId, `${label} workspaceId`),
		...sources === void 0 ? {} : { sources }
	};
}
/** Strictly validate the untrusted project graph RPC request. */
function decodeProjectGraphRequest(value) {
	return { workspaceId: nonBlank(object(value, "dsh-git project graph request").workspaceId, "workspaceId") };
}
/** Validate the ledger-read request; the state schema is enforced by the Host domain. */
function decodeGraphReadRequest(value) {
	return { scopeId: nonBlank(object(value, "dsh-git graph read request").scopeId, "scopeId") };
}
/** Validate the ledger-write envelope; `state` is parsed against the domain schema. */
function decodeGraphWriteRequest(value) {
	const candidate = object(value, "dsh-git graph write request");
	const state = object(candidate.state, "dsh-git graph write request state");
	return {
		scopeId: nonBlank(candidate.scopeId, "scopeId"),
		state,
		expectedRevision: nonNegativeInteger(candidate.expectedRevision, "expectedRevision")
	};
}
//#endregion
//#region lib/types/history-preview.js
function projectContentBlock(block) {
	switch (block.type) {
		case "text": return {
			type: "text",
			text: block.text
		};
		case "reasoning": return {
			type: "reasoning",
			text: block.text
		};
		case "image": return {
			type: "image",
			attachment: {
				attachmentId: String(block.attachment.attachmentId),
				mediaType: block.attachment.mediaType,
				bytes: block.attachment.bytes,
				width: block.attachment.width,
				height: block.attachment.height,
				...block.attachment.name === void 0 ? {} : { name: block.attachment.name }
			}
		};
		case "tool-call": return {
			type: "tool-call",
			callId: String(block.id),
			name: block.name,
			arguments: block.arguments
		};
		default: return {
			type: "other",
			originalType: typeof block.type === "string" ? block.type : "unknown",
			value: block
		};
	}
}
function projectEvent(event) {
	switch (event.type) {
		case "user/message": return {
			kind: "user",
			seq: event.seq,
			messageId: String(event.data.id),
			content: event.data.content.map(projectContentBlock),
			source: event.data.source
		};
		case "assistant/message": return {
			kind: "assistant",
			seq: event.seq,
			step: event.data.step,
			messageId: String(event.data.message.id),
			blocks: event.data.message.content.map(projectContentBlock),
			provenance: {
				provider: event.data.message.source.provider,
				model: event.data.message.source.model
			},
			...event.data.usage === void 0 ? {} : { usage: event.data.usage }
		};
		case "tool/call": return {
			kind: "tool-call",
			seq: event.seq,
			step: event.data.step,
			callId: String(event.data.callId),
			name: event.data.name,
			arguments: event.data.arguments
		};
		case "tool/result": {
			const message = event.data.message;
			return {
				kind: "tool-result",
				seq: event.seq,
				step: event.data.step,
				callId: String(message.toolCallId),
				content: message.content.map(projectContentBlock),
				isError: message.isError ?? false,
				...event.data.error === void 0 ? {} : { error: event.data.error },
				...event.data.meta === void 0 ? {} : { meta: event.data.meta }
			};
		}
		case "request/header": return {
			kind: "request",
			seq: event.seq,
			requestKind: "header",
			data: event.data
		};
		case "request/context": return {
			kind: "request",
			seq: event.seq,
			requestKind: "context",
			data: event.data
		};
		case "turn/end":
			if (event.data.reason.kind === "completed") return void 0;
			return {
				kind: "turn-status",
				seq: event.seq,
				status: event.data.reason.kind,
				details: event.data.reason
			};
		case "turn/start":
		case "step/start":
		case "step/end":
		case "assistant/attempt":
		case "system/message": return;
		default: return {
			kind: "event",
			seq: event.seq,
			eventType: event.type,
			data: event.data
		};
	}
}
function selectedTurnEvents(seed, targetTurn) {
	const startIndex = seed.findIndex((event) => event.type === "turn/start" && event.data.turn === targetTurn);
	if (startIndex < 0) throw new Error(`merged preview seed has no start for target turn ${targetTurn}`);
	const relativeEnd = seed.slice(startIndex + 1).findIndex((event) => event.type === "turn/end" && event.data.turn === targetTurn);
	if (relativeEnd < 0) throw new Error(`merged preview seed has no end for target turn ${targetTurn}`);
	return seed.slice(startIndex + 1, startIndex + relativeEnd + 2);
}
/**
* Project selected turns through the actual merged-seed builder, so the preview
* and a later Merge share source validation, event filtering, and tray order.
*/
async function projectHistoryPreview(sources, readSession) {
	const seed = await buildMergedSessionSeed("dsh-git-history-preview", sources, readSession);
	return decodeHistoryPreviewResponse({ turns: sources.map((source, index) => {
		const targetTurn = index + 1;
		return {
			source,
			targetTurn,
			records: selectedTurnEvents(seed, targetTurn).flatMap((event) => {
				const record = projectEvent(event);
				return record === void 0 ? [] : [record];
			})
		};
	}) });
}
//#endregion
//#region lib/types/index.js
const name = "dsh-git";
const inject = [
	"agents",
	"agentPresets",
	"connection",
	"sessionQuery",
	"storageDomain",
	"workspaceRegistry"
];
const ANCHOR_WORKSPACE_MARKER = ".dsh-git-anchor";
function anchorWorkspaceMarkerPath(workspacePath) {
	return join(workspacePath, ANCHOR_WORKSPACE_MARKER);
}
async function readAnchorWorkspaceMarker(markerPath) {
	try {
		const marker = JSON.parse(await readFile(markerPath, "utf8"));
		if (typeof marker !== "object" || marker === null || Array.isArray(marker)) return void 0;
		const sourceWorkspacePath = marker.sourceWorkspacePath;
		const anchorKey = marker.anchorKey;
		if (typeof sourceWorkspacePath !== "string" || anchorKey !== void 0 && typeof anchorKey !== "string") return void 0;
		return {
			sourceWorkspacePath,
			...anchorKey === void 0 ? {} : { anchorKey }
		};
	} catch {
		return;
	}
}
async function belongsToSourceWorkspace(markerPath, sourceWorkspacePath) {
	return (await readAnchorWorkspaceMarker(markerPath))?.sourceWorkspacePath === sourceWorkspacePath;
}
/** Stable identity for one order-insensitive set of Host history coordinates. */
function anchorSourceKey(sources) {
	const coordinates = sources.map((source) => [
		source.sourceSessionId,
		source.sourceTurn,
		source.sourceBoundarySeq
	]).sort((left, right) => left[0].localeCompare(right[0]) || left[1] - right[1] || left[2] - right[2]);
	return createHash("sha256").update(JSON.stringify(coordinates)).digest("hex");
}
function isAnchorWorkspaceChild(workspace, sourceWorkspace) {
	return dirname(workspace.path) === sourceWorkspace.path && basename(workspace.path).startsWith("dsh-git-anchors-");
}
/**
* Read the effective preset from the durable session record.
*
* `agent-preset/selected` supersedes the immutable creation header while a
* session is blank. The Harness no longer exports this convenience helper,
* and this query snapshot does not expose its projection, so fold the same
* small log-backed rule here.
*/
function resolveSessionPreset(header, events) {
	let preset = header.agentPreset;
	for (const event of events) if (event.type === "agent-preset/selected") preset = event.data.agentPreset;
	return preset;
}
/** Recover identity from old markers by reading any existing anchored child lineage. */
async function recoverLegacyAnchorKey(ctx, workspace, signal) {
	for (const sessionId of workspace.sessionIds) {
		if (!isAnchoredSessionId(String(sessionId))) continue;
		signal.throwIfAborted();
		try {
			const snapshot = await ctx.sessionQuery.readSession(SessionId(sessionId));
			signal.throwIfAborted();
			const sources = readMergeLineage(snapshot.events)?.sources;
			if (sources !== void 0 && sources.length > 0) return anchorSourceKey(sources);
		} catch (error) {
			signal.throwIfAborted();
			ctx.logger.warn(`failed to recover Anchor Workspace identity from "${sessionId}": ${String(error)}`);
		}
	}
}
async function findReusableAnchorWorkspace(ctx, workspaces, sourceWorkspace, requestedKey, signal) {
	for (const workspace of workspaces) {
		if (!isAnchorWorkspaceChild(workspace, sourceWorkspace)) continue;
		const markerPath = anchorWorkspaceMarkerPath(workspace.path);
		const marker = await readAnchorWorkspaceMarker(markerPath);
		if (marker?.sourceWorkspacePath !== sourceWorkspace.path) continue;
		if (marker.anchorKey === requestedKey) return workspace;
		if (marker.anchorKey !== void 0) continue;
		const recoveredKey = await recoverLegacyAnchorKey(ctx, workspace, signal);
		if (recoveredKey !== requestedKey) continue;
		await writeFile(markerPath, JSON.stringify({
			sourceWorkspacePath: sourceWorkspace.path,
			anchorKey: recoveredKey
		}), {
			encoding: "utf8",
			flag: "w"
		}).catch(() => void 0);
		return workspace;
	}
}
/** Repair merge sessions created by versions that copied cwd but forgot Workspace membership. */
async function repairWorkspaceMembership(ctx) {
	const workspaces = ctx.workspaceRegistry.list();
	const grouped = new Set(workspaces.flatMap((workspace) => workspace.sessionIds));
	const records = await ctx.sessionQuery.listSessions();
	for (const record of records) {
		const sessionId = record.header.id;
		if (!String(sessionId).startsWith("dsh-git-") || isAnchoredSessionId(String(sessionId)) || grouped.has(sessionId)) continue;
		const parentSession = record.header.parentSession;
		if (parentSession === void 0) continue;
		const workspace = workspaces.find((candidate) => candidate.sessionIds.includes(parentSession));
		if (workspace === void 0) continue;
		try {
			await workspace.attachSession(sessionId);
			grouped.add(sessionId);
		} catch (error) {
			ctx.logger.warn(`failed to restore workspace membership for "${sessionId}": ${String(error)}`);
		}
	}
}
/** Report one handler failure without leaking a stack across the Connection boundary. */
function failure(error) {
	return {
		ok: false,
		error: {
			code: "internal",
			message: error instanceof Error ? error.message : String(error),
			details: {}
		}
	};
}
/** The Session a composed child is created under: the one its last source was selected through. */
function primarySourceSessionId(sources) {
	const last = sources.at(-1);
	return SessionId(last.viaSessionId ?? last.sourceSessionId);
}
/**
* Read every Session of a Workspace that can be read.
*
* One log Harness refuses to load must not hide the rest of the Workspace, so
* a failed read is logged and that Session is left out.
*/
async function readWorkspaceSessions(ctx, workspace, read) {
	return (await Promise.all(workspace.sessionIds.map(async (sessionId) => {
		try {
			return await read(SessionId(sessionId));
		} catch (error) {
			ctx.logger.warn(`failed to read Session "${sessionId}" of Workspace "${workspace.id}": ${String(error)}`);
			return;
		}
	}))).flatMap((snapshot) => snapshot === void 0 ? [] : [snapshot]);
}
/**
* Compose the selected turns into a seed and create the child Agent from it.
*
* The last source's Session — the one it was selected through — is the child's
* official parent and supplies its preset. Each source Session's log is read
* once per request however many of its turns were selected.
* @param cwdOf - working directory for the child, given the parent's snapshot.
* @returns the child's handle and the seed it was created from.
*/
async function createComposedAgent(ctx, targetSessionId, sources, signal, cwdOf) {
	const snapshots = /* @__PURE__ */ new Map();
	const readSession = async (sessionId) => {
		const existing = snapshots.get(sessionId);
		if (existing !== void 0) return existing;
		signal.throwIfAborted();
		const snapshot = await ctx.sessionQuery.readSession(sessionId);
		signal.throwIfAborted();
		snapshots.set(sessionId, snapshot);
		return snapshot;
	};
	const forkOriginOf = async (fork) => {
		const workspace = ctx.workspaceRegistry.list().find((candidate) => candidate.sessionIds.includes(fork.session.id));
		if (workspace === void 0) return void 0;
		const siblings = await readWorkspaceSessions(ctx, workspace, readSession);
		signal.throwIfAborted();
		return forkOrigin(fork, siblings);
	};
	const primarySessionId = primarySourceSessionId(sources);
	const primary = await readSession(primarySessionId);
	const seed = await buildMergedSessionSeed(targetSessionId, sources, readSession, forkOriginOf);
	signal.throwIfAborted();
	const preset = resolveSessionPreset(primary.session, primary.events);
	const cwd = cwdOf(primary);
	return {
		handle: await ctx.agents.create({
			sessionId: targetSessionId,
			seed,
			inheritedEventCount: SessionLogOffset(seed.length),
			meta: {
				...cwd === void 0 ? {} : { cwd },
				parentSession: primarySessionId,
				isSeeded: true,
				...preset === void 0 ? {} : { agentPreset: preset }
			},
			signal,
			setup: (agentCtx) => ctx.agentPresets.mount(agentCtx, preset).then(() => void 0)
		}),
		seed
	};
}
/**
* Finish durable Workspace membership for a just-created child.
*
* Once creation publishes, membership completes even if the browser
* disconnects. If it fails, the child is disposed so the failed transaction
* cannot leave a hidden orphan Session behind.
*/
async function attachOrDispose(workspace, handle, targetSessionId) {
	try {
		await workspace.attachSession(targetSessionId);
	} catch (error) {
		await handle.dispose();
		throw error;
	}
}
/** Create one merged child using the final tray source as its official parent. */
async function createMergedSession(ctx, payload, signal) {
	const request = decodeCreateMergedSessionRequest(payload);
	signal.throwIfAborted();
	const targetSessionId = SessionId(request.targetSessionId);
	if (ctx.agents.get(targetSessionId) !== void 0) throw new Error(`target session "${targetSessionId}" already exists`);
	const { handle, seed } = await createComposedAgent(ctx, targetSessionId, request.sources, signal, (primary) => primary.session.cwd);
	const primarySessionId = primarySourceSessionId(request.sources);
	const sourceWorkspace = ctx.workspaceRegistry.list().find((workspace) => workspace.sessionIds.includes(primarySessionId));
	if (sourceWorkspace !== void 0) await attachOrDispose(sourceWorkspace, handle, targetSessionId);
	return {
		targetSessionId,
		turnBoundaries: seed.flatMap((event) => event.type === "turn/end" ? [event.seq] : [])
	};
}
/** Create one strict-isolation child in the dedicated Anchor Workspace. */
async function createAnchoredSession(ctx, payload, signal) {
	const request = decodeCreateAnchoredSessionRequest(payload);
	signal.throwIfAborted();
	if (!request.targetSessionId.startsWith("dsh-git-anchor-")) throw new Error(`anchored target session must start with "${ANCHORED_SESSION_PREFIX}"`);
	const targetSessionId = SessionId(request.targetSessionId);
	if (ctx.agents.get(targetSessionId) !== void 0) throw new Error(`target session "${targetSessionId}" already exists`);
	const targetWorkspace = ctx.workspaceRegistry.list().find((workspace) => String(workspace.id) === request.workspaceId);
	if (targetWorkspace === void 0) throw new Error(`anchor workspace "${request.workspaceId}" was not found`);
	const { handle } = await createComposedAgent(ctx, targetSessionId, request.sources, signal, () => targetWorkspace.path);
	await attachOrDispose(targetWorkspace, handle, targetSessionId);
	return { targetSessionId };
}
/** Reuse or create the dedicated child Workspace for one exact Anchor source set. */
async function createAnchorWorkspace(ctx, payload, signal) {
	const request = decodeCreateAnchorWorkspaceRequest(payload);
	signal.throwIfAborted();
	const sourceSessionId = SessionId(request.sourceSessionId);
	const workspaces = ctx.workspaceRegistry.list();
	const sourceWorkspace = workspaces.find((workspace) => workspace.sessionIds.includes(sourceSessionId));
	if (sourceWorkspace === void 0) throw new Error(`source session "${sourceSessionId}" is not in a Workspace`);
	const anchorKey = anchorSourceKey(request.sources);
	const reusable = await findReusableAnchorWorkspace(ctx, workspaces, sourceWorkspace, anchorKey, signal);
	if (reusable !== void 0) return {
		workspaceId: String(reusable.id),
		workspacePath: reusable.path,
		workspaceTitle: reusable.title
	};
	const workspacePath = await mkdtemp(join(sourceWorkspace.path, "dsh-git-anchors-"));
	const markerPath = anchorWorkspaceMarkerPath(workspacePath);
	try {
		await writeFile(markerPath, JSON.stringify({
			sourceWorkspacePath: sourceWorkspace.path,
			anchorKey
		}), {
			encoding: "utf8",
			flag: "wx"
		});
		const workspace = await ctx.workspaceRegistry.create(workspacePath, request.title);
		return {
			workspaceId: String(workspace.id),
			workspacePath: workspace.path,
			workspaceTitle: workspace.title
		};
	} catch (error) {
		await unlink(markerPath).catch(() => void 0);
		await rmdir(workspacePath).catch(() => void 0);
		throw error;
	}
}
/** Leave Anchor mode without deleting its durable, reusable Anchor Workspace. */
async function cancelAnchorWorkspace(ctx, payload, signal) {
	const request = decodeCancelAnchorWorkspaceRequest(payload);
	signal.throwIfAborted();
	const workspaces = ctx.workspaceRegistry.list();
	const sourceWorkspace = workspaces.find((workspace) => workspace.sessionIds.includes(SessionId(request.sourceSessionId)));
	const targetWorkspace = workspaces.find((workspace) => String(workspace.id) === request.workspaceId);
	if (sourceWorkspace === void 0 || targetWorkspace === void 0 || !isAnchorWorkspaceChild(targetWorkspace, sourceWorkspace) || !await belongsToSourceWorkspace(anchorWorkspaceMarkerPath(targetWorkspace.path), sourceWorkspace.path)) return { removed: false };
	if (request.sources !== void 0) {
		const markerPath = anchorWorkspaceMarkerPath(targetWorkspace.path);
		const marker = await readAnchorWorkspaceMarker(markerPath);
		if (marker !== void 0 && marker.anchorKey === void 0) await writeFile(markerPath, JSON.stringify({
			sourceWorkspacePath: sourceWorkspace.path,
			anchorKey: anchorSourceKey(request.sources)
		}), {
			encoding: "utf8",
			flag: "w"
		});
	}
	return { removed: false };
}
/** Read every completed PA belonging to exactly one Workspace. */
async function readProjectGraph(ctx, payload) {
	const request = decodeProjectGraphRequest(payload);
	const workspace = ctx.workspaceRegistry.list().find((candidate) => candidate.id === request.workspaceId);
	if (workspace === void 0) throw new Error(`workspace "${request.workspaceId}" was not found`);
	const snapshots = await readWorkspaceSessions(ctx, workspace, (sessionId) => ctx.sessionQuery.readSession(sessionId));
	const sessions = snapshots.map((snapshot) => projectSession(snapshot, forkOrigin(snapshot, snapshots)));
	sessions.sort((left, right) => left.createdAt - right.createdAt || left.sessionId.localeCompare(right.sessionId));
	return {
		ok: true,
		value: {
			workspaceId: request.workspaceId,
			sessions
		}
	};
}
/** Mount the trusted RPCs used by the browser half. */
async function apply(ctx) {
	await repairWorkspaceMembership(ctx);
	const domain = await ctx.storageDomain.open(GRAPH_DOMAIN);
	const scopes = domain.table("scopes");
	const graphWrites = /* @__PURE__ */ new Map();
	ctx.effect(() => () => domain.close(), "dsh-git: graph ledger domain");
	/** Project selected completed turns exactly as the merged seed will copy them. */
	const readHistoryPreview = async (payload, signal) => {
		const request = decodeHistoryPreviewRequest(payload);
		signal.throwIfAborted();
		const snapshots = /* @__PURE__ */ new Map();
		const value = await projectHistoryPreview(request.sources, async (sessionId) => {
			signal.throwIfAborted();
			const existing = snapshots.get(sessionId);
			if (existing !== void 0) return await existing;
			const pending = ctx.sessionQuery.readSession(sessionId);
			snapshots.set(sessionId, pending);
			const snapshot = await pending;
			signal.throwIfAborted();
			return snapshot;
		});
		signal.throwIfAborted();
		return {
			ok: true,
			value
		};
	};
	ctx.connection.rpc.handle(PROJECT_GRAPH_RPC_CHANNEL, async (endpoint, payload, signal) => {
		try {
			switch (endpoint) {
				case CANCEL_ANCHOR_WORKSPACE_RPC_ENDPOINT: return {
					ok: true,
					value: await cancelAnchorWorkspace(ctx, payload, signal)
				};
				case CREATE_ANCHOR_WORKSPACE_RPC_ENDPOINT: return {
					ok: true,
					value: await createAnchorWorkspace(ctx, payload, signal)
				};
				case CREATE_ANCHORED_SESSION_RPC_ENDPOINT: return {
					ok: true,
					value: await createAnchoredSession(ctx, payload, signal)
				};
				case CREATE_MERGED_SESSION_RPC_ENDPOINT: return {
					ok: true,
					value: await createMergedSession(ctx, payload, signal)
				};
				case PROJECT_GRAPH_RPC_ENDPOINT: return await readProjectGraph(ctx, payload);
				case HISTORY_PREVIEW_RPC_ENDPOINT: return await readHistoryPreview(payload, signal);
				case GRAPH_READ_ENDPOINT: {
					const scopeId = assertScopeId(decodeGraphReadRequest(payload).scopeId);
					return {
						ok: true,
						value: {
							scopeId,
							state: scopes.get(scopeId) ?? null
						}
					};
				}
				case GRAPH_WRITE_ENDPOINT: {
					const request = decodeGraphWriteRequest(payload);
					const scopeId = assertScopeId(request.scopeId);
					const write = (graphWrites.get(scopeId) ?? Promise.resolve()).then(async () => {
						if ((scopes.get(scopeId)?.revision ?? 0) !== request.expectedRevision) throw new Error("Graph changed in another client. Reload before saving; the stored graph was preserved.");
						const next = finalizeGraph({
							...graphStateSchema.parse(request.state),
							revision: request.expectedRevision + 1
						});
						await scopes.put(scopeId, graphStateSchema.parse(next));
					});
					graphWrites.set(scopeId, write.catch(() => void 0));
					await write;
					return {
						ok: true,
						value: { scopeId }
					};
				}
				default: throw new Error(`unknown dsh-git endpoint "${endpoint}"`);
			}
		} catch (error) {
			return failure(error);
		}
	}, { authority: "trusted-host" });
}
//#endregion
export { apply, cancelAnchorWorkspace, createAnchorWorkspace, createAnchoredSession, createMergedSession, inject, name, readProjectGraph };
