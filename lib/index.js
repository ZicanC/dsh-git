import { resolveSessionPreset } from "@deepseek-ai/dsh-agent-presets";
import { Session, SessionId } from "@deepseek-ai/dsh-session";
import { defineDomain, domainTable } from "@deepseek-ai/dsh-storage-domain";
import { z } from "zod";
import { createHash } from "node:crypto";
const nodeId = z.string().min(1);
const turnNodeSchema = z.object({
	id: nodeId,
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
	branchId: z.string().min(1),
	parentIds: z.array(nodeId),
	primaryParentId: nodeId.nullable(),
	contextManifest: z.array(nodeId),
	prompt: z.string().optional()
});
/** One scope's complete ledger, as stored and as accepted off the wire. */
const graphStateSchema = z.object({
	format: z.literal(1),
	nodes: z.record(z.string(), turnNodeSchema),
	branches: z.record(z.string(), branchSchema),
	sessionBranches: z.record(z.string(), z.string().min(1)),
	sessionTurnRefs: z.record(z.string(), z.record(z.string(), nodeId)),
	pendingMerges: z.record(z.string(), pendingMergeSchema),
	headNodeId: nodeId.nullable(),
	previewNodeId: nodeId.nullable(),
	contextManifest: z.array(nodeId)
});
/**
* The graph domain. `UNIT_NAME_RE` is `/^[a-z][a-z0-9_]*$/`, so the domain and
* table names are underscore-separated rather than matching the package name.
*/
const GRAPH_DOMAIN = defineDomain({
	name: "dsh_git_graph",
	version: 1,
	tables: { scopes: domainTable(graphStateSchema) }
});
/** Reject a scope id that is blank or larger than one record key should be. */
function assertScopeId(value) {
	if (typeof value !== "string" || value.trim() === "") throw new Error("dsh-git graph scopeId must be a non-blank string");
	if (value.length > 512) throw new Error(`dsh-git graph scopeId exceeds 512 characters`);
	return value;
}
//#endregion
//#region lib/types/merge-lineage.js
const MERGE_LINEAGE_EVENT = "dsh-git/merge";
/** Build the seed-tail lineage event for a merged Session. */
function mergeLineageEvent(sources, seq, time) {
	const lineage = { sources: sources.map((source, index) => ({
		sourceSessionId: source.sourceSessionId,
		sourceTurn: source.sourceTurn,
		sourceBoundarySeq: source.sourceBoundarySeq,
		targetTurn: index + 1
	})) };
	return {
		type: MERGE_LINEAGE_EVENT,
		seq,
		time,
		data: lineage,
		ignorable: true
	};
}
/** Recover merge lineage from a Session log, or `undefined` for an ordinary Session. */
function readMergeLineage(events) {
	for (const event of events) {
		if (event.type !== "dsh-git/merge") continue;
		const data = event.data;
		if (!Array.isArray(data.sources)) continue;
		return { sources: data.sources };
	}
}
//#endregion
//#region lib/types/history.js
const COPIED_EVENT_TYPES = /* @__PURE__ */ new Set([
	"turn/start",
	"turn/end",
	"step/start",
	"step/end",
	"user/message",
	"assistant/chunk",
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
		return target === void 0 ? [] : [target];
	});
	return mapped.length === 0 && event.sourceEventSeqs.length > 0 ? void 0 : mapped;
}
/** Copy one completed source turn into a detached target as a newly numbered real turn. */
function appendHistoricalTurn(target, sourceEvents, targetTurn) {
	const seqMap = /* @__PURE__ */ new Map();
	for (const event of sourceEvents) {
		if (!COPIED_EVENT_TYPES.has(event.type)) continue;
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
			case "assistant/chunk":
				appended = target.append("assistant/chunk", {
					...event.data,
					turn: targetTurn
				});
				break;
			case "assistant/message":
				appended = target.append("assistant/message", {
					...event.data,
					turn: targetTurn
				}, {
					surfaceOp: "append",
					...sourceEventSeqs === void 0 ? {} : { sourceEventSeqs }
				});
				break;
			case "tool/call":
				appended = target.append("tool/call", {
					...event.data,
					turn: targetTurn
				});
				break;
			case "tool/result":
				if (event.surfaceOp !== "append") continue;
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
			default: continue;
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
*/
async function buildMergedSessionSeed(targetSessionId, sources, readSession) {
	const target = Session.create(SessionId(targetSessionId));
	for (const [index, source] of sources.entries()) appendHistoricalTurn(target, sourceTurnEvents(await readSession(SessionId(source.sourceSessionId)), source), index + 1);
	const events = [...target.events];
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
			"sourceBoundarySeq"
		], sourceLabel);
	});
	return {
		targetSessionId: nonBlank(candidate.targetSessionId, `${label} targetSessionId`),
		sources
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
		state
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
		case "tool-result": return {
			type: "tool-result",
			callId: String(block.toolCallId),
			content: block.content.map(projectContentBlock),
			isError: block.isError ?? false
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
			const block = event.data.message.content[0];
			return {
				kind: "tool-result",
				seq: event.seq,
				step: event.data.step,
				callId: String(block.toolCallId),
				content: block.content.map(projectContentBlock),
				isError: block.isError ?? false,
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
		case "assistant/chunk": return;
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
			inherited: event.seq < (snapshot.session.seedLength ?? 0),
			fingerprint: fingerprint(events)
		});
	}
	return turns.sort((left, right) => left.turn - right.turn);
}
/** Convert one complete Session snapshot into the project graph wire record. */
function projectSession(snapshot) {
	const lineage = readMergeLineage(snapshot.events);
	return {
		sessionId: snapshot.session.id,
		createdAt: snapshot.session.createdAt,
		...snapshot.session.parentSession === void 0 ? {} : { parentSessionId: snapshot.session.parentSession },
		seedLength: snapshot.session.seedLength ?? 0,
		...lineage === void 0 ? {} : { mergeSources: lineage.sources },
		turns: projectTurns(snapshot)
	};
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
/** Repair merge sessions created by versions that copied cwd but forgot Workspace membership. */
async function repairWorkspaceMembership(ctx) {
	const workspaces = ctx.workspaceRegistry.list();
	const grouped = new Set(workspaces.flatMap((workspace) => workspace.sessionIds));
	const records = await ctx.sessionQuery.listSessions();
	for (const record of records) {
		const sessionId = record.header.id;
		if (!String(sessionId).startsWith("dsh-git-") || grouped.has(sessionId)) continue;
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
/** Create one merged child using the final tray source as its official parent. */
async function createMergedSession(ctx, payload, signal) {
	const request = decodeCreateMergedSessionRequest(payload);
	signal.throwIfAborted();
	const targetSessionId = SessionId(request.targetSessionId);
	if (ctx.agents.get(targetSessionId) !== void 0) throw new Error(`target session "${targetSessionId}" already exists`);
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
	const primarySessionId = SessionId(request.sources.at(-1).sourceSessionId);
	const primary = await readSession(primarySessionId);
	const seed = await buildMergedSessionSeed(targetSessionId, request.sources, readSession);
	signal.throwIfAborted();
	const sourceWorkspace = ctx.workspaceRegistry.list().find((workspace) => workspace.sessionIds.includes(primarySessionId));
	const preset = resolveSessionPreset({
		header: primary.session,
		events: primary.events
	});
	await ctx.agents.create({
		sessionId: targetSessionId,
		seed,
		meta: {
			...primary.session.cwd === void 0 ? {} : { cwd: primary.session.cwd },
			parentSession: primarySessionId,
			seedLength: seed.length,
			...preset === void 0 ? {} : { agentPreset: preset }
		},
		signal,
		setup: (agentCtx) => ctx.agentPresets.mount(agentCtx, preset).then(() => void 0)
	});
	if (sourceWorkspace !== void 0) await sourceWorkspace.attachSession(targetSessionId);
	return { targetSessionId };
}
/** Mount the trusted RPCs used by the browser half. */
async function apply(ctx) {
	await repairWorkspaceMembership(ctx);
	const domain = await ctx.storageDomain.open(GRAPH_DOMAIN);
	const scopes = domain.table("scopes");
	ctx.effect(() => () => domain.close(), "dsh-git: graph ledger domain");
	/** Read every completed PA of one Workspace straight from the canonical logs. */
	const readProjectGraph = async (payload) => {
		const request = decodeProjectGraphRequest(payload);
		const workspace = ctx.workspaceRegistry.list().find((candidate) => candidate.id === request.workspaceId);
		if (workspace === void 0) throw new Error(`workspace "${request.workspaceId}" was not found`);
		const sessions = await Promise.all(workspace.sessionIds.map(async (sessionId) => projectSession(await ctx.sessionQuery.readSession(SessionId(sessionId)))));
		sessions.sort((left, right) => left.createdAt - right.createdAt || left.sessionId.localeCompare(right.sessionId));
		return {
			ok: true,
			value: {
				workspaceId: request.workspaceId,
				sessions
			}
		};
	};
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
				case CREATE_MERGED_SESSION_RPC_ENDPOINT: return {
					ok: true,
					value: await createMergedSession(ctx, payload, signal)
				};
				case PROJECT_GRAPH_RPC_ENDPOINT: return await readProjectGraph(payload);
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
					await scopes.put(scopeId, graphStateSchema.parse(request.state));
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
export { apply, createMergedSession, inject, name };
