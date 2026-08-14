import { resolveSessionPreset } from "@deepseek-ai/dsh-agent-presets";
import { Session, SessionId } from "@deepseek-ai/dsh-session";
import { createHash } from "node:crypto";
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
/** Read selected turns in tray order and produce a contiguous, balanced Agent seed. */
async function buildMergedSessionSeed(targetSessionId, sources, readSession) {
	const target = Session.create(SessionId(targetSessionId));
	for (const [index, source] of sources.entries()) appendHistoricalTurn(target, sourceTurnEvents(await readSession(SessionId(source.sourceSessionId)), source), index + 1);
	return target.events;
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
	return {
		sessionId: snapshot.session.id,
		createdAt: snapshot.session.createdAt,
		...snapshot.session.parentSession === void 0 ? {} : { parentSessionId: snapshot.session.parentSession },
		seedLength: snapshot.session.seedLength ?? 0,
		turns: projectTurns(snapshot)
	};
}
//#endregion
//#region lib/types/protocol.js
const CREATE_MERGED_SESSION_COMMAND = "dsh-git-create-merged-session";
/** Generic Connection channel and endpoint used by the project graph reader. */
const PROJECT_GRAPH_RPC_CHANNEL = "/dsh-git";
function object(value, label) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${label} must be an object`);
	return value;
}
function nonBlank(value, label) {
	if (typeof value !== "string" || value.trim() === "") throw new Error(`${label} must be a non-blank string`);
	return value;
}
/** Strictly validate the untrusted project graph RPC request. */
function decodeProjectGraphRequest(value) {
	return { workspaceId: nonBlank(object(value, "dsh-git project graph request").workspaceId, "workspaceId") };
}
/** Decode and strictly validate an untrusted slash-command payload. */
function decodeCreateMergedSessionPayload(rawInput) {
	let parsed;
	try {
		parsed = JSON.parse(decodeURIComponent(rawInput.trim()));
	} catch {
		throw new Error("dsh-git merge payload is not valid encoded JSON");
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("dsh-git merge payload must be an object");
	const candidate = parsed;
	if (typeof candidate.targetSessionId !== "string" || candidate.targetSessionId.trim() === "") throw new Error("dsh-git merge payload requires targetSessionId");
	if (!Array.isArray(candidate.sources) || candidate.sources.length === 0 || candidate.sources.length > 64) throw new Error("dsh-git merge payload requires 1 to 64 source turns");
	const sources = candidate.sources.map((source, index) => {
		if (typeof source !== "object" || source === null || Array.isArray(source)) throw new Error(`dsh-git source ${index + 1} must be an object`);
		const value = source;
		if (typeof value.sourceSessionId !== "string" || value.sourceSessionId.trim() === "") throw new Error(`dsh-git source ${index + 1} requires sourceSessionId`);
		if (!Number.isSafeInteger(value.sourceTurn) || value.sourceTurn < 1) throw new Error(`dsh-git source ${index + 1} has an invalid sourceTurn`);
		if (!Number.isSafeInteger(value.sourceBoundarySeq) || value.sourceBoundarySeq < 0) throw new Error(`dsh-git source ${index + 1} has an invalid sourceBoundarySeq`);
		return {
			sourceSessionId: value.sourceSessionId,
			sourceTurn: value.sourceTurn,
			sourceBoundarySeq: value.sourceBoundarySeq
		};
	});
	return {
		targetSessionId: candidate.targetSessionId,
		sources
	};
}
//#endregion
//#region lib/types/index.js
const name = "dsh-git";
const inject = [
	"agents",
	"agentPresets",
	"commands",
	"connection",
	"sessionQuery",
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
/** Mount the private history-composition command used by the browser half. */
async function apply(ctx) {
	await repairWorkspaceMembership(ctx);
	ctx.connection.rpc.handle(PROJECT_GRAPH_RPC_CHANNEL, async (endpoint, payload) => {
		if (endpoint !== "workspace/graph") return {
			ok: false,
			error: {
				code: "internal",
				message: `unknown dsh-git endpoint "${endpoint}"`,
				details: {}
			}
		};
		let request;
		try {
			request = decodeProjectGraphRequest(payload);
		} catch (error) {
			return {
				ok: false,
				error: {
					code: "internal",
					message: error instanceof Error ? error.message : String(error),
					details: {}
				}
			};
		}
		const workspace = ctx.workspaceRegistry.list().find((candidate) => candidate.id === request.workspaceId);
		if (workspace === void 0) return {
			ok: false,
			error: {
				code: "internal",
				message: `workspace "${request.workspaceId}" was not found`,
				details: {}
			}
		};
		try {
			const sessions = await Promise.all(workspace.sessionIds.map(async (sessionId) => projectSession(await ctx.sessionQuery.readSession(SessionId(sessionId)))));
			sessions.sort((left, right) => left.createdAt - right.createdAt || left.sessionId.localeCompare(right.sessionId));
			return {
				ok: true,
				value: {
					workspaceId: request.workspaceId,
					sessions
				}
			};
		} catch (error) {
			return {
				ok: false,
				error: {
					code: "internal",
					message: error instanceof Error ? error.message : String(error),
					details: {}
				}
			};
		}
	}, { authority: "trusted-host" });
	ctx.commands.register({
		name: CREATE_MERGED_SESSION_COMMAND,
		description: "Create a dsh-git branch from selected historical turns",
		recordInput: false,
		handler: async ({ agent, rawInput }) => {
			const payload = decodeCreateMergedSessionPayload(rawInput);
			const targetSessionId = SessionId(payload.targetSessionId);
			if (ctx.agents.get(targetSessionId) !== void 0) throw new Error(`target session "${targetSessionId}" already exists`);
			const seed = await buildMergedSessionSeed(targetSessionId, payload.sources, (sourceId) => ctx.sessionQuery.readSession(sourceId));
			const sourceWorkspace = ctx.workspaceRegistry.list().find((workspace) => workspace.sessionIds.includes(agent.id));
			const preset = resolveSessionPreset(agent.session);
			await ctx.agents.create({
				sessionId: targetSessionId,
				seed,
				meta: {
					...agent.session.header.cwd === void 0 ? {} : { cwd: agent.session.header.cwd },
					parentSession: agent.id,
					seedLength: seed.length,
					...preset === void 0 ? {} : { agentPreset: preset }
				},
				setup: (agentCtx) => ctx.agentPresets.mount(agentCtx, preset).then(() => void 0)
			});
			if (sourceWorkspace !== void 0) await sourceWorkspace.attachSession(targetSessionId);
			return {
				kind: "success",
				text: `created merged session ${targetSessionId}`
			};
		}
	});
}
//#endregion
export { apply, inject, name };
