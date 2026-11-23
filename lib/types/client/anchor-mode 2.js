import { ANCHORED_SESSION_PREFIX } from "../protocol.js";
import { hostCoordinates, selectedNodes } from "./graph.js";
import { rewordRefusal } from "./host-rpc.js";
import { localized } from "./i18n.js";
import { randomSuffix } from "./ids.js";
import { nodeLabelMap } from "./labels.js";
import { handOverAttachments, retainCreatedSession, sameValues, submissionAccepted, } from "./session-handoff.js";
/**
 * Fix the selected PAs and reuse or create their Anchor Workspace.
 * @param owner - the Workspace the source Chat belongs to, if any.
 * @returns the anchor now recorded for the source Session.
 */
export async function activateAnchor(rpc, repository, sessionId, owner, manifest, signal) {
    signal.throwIfAborted();
    if (owner === undefined)
        throw new Error(localized('当前 Chat 不属于任何 Workspace，无法创建锚点目录。', 'The current Chat is not in a Workspace, so an anchor directory cannot be created.'));
    const selected = selectedNodes(repository.getSnapshot(), manifest);
    if (selected === undefined)
        throw new Error(localized('至少一个所选 PA 已失效，请重新选择。', 'At least one selected PA is stale; select the context again.'));
    const title = localized(`锚点问题 · ${owner.title}`, `Anchored questions · ${owner.title}`);
    const anchorWorkspace = await rpc.createAnchorWorkspace({ sourceSessionId: sessionId, title, sources: selected.map(hostCoordinates) }, signal).catch(rewordRefusal(message => localized(`创建锚点目录失败：${message}`, `Failed to create the Anchor directory: ${message}`)));
    const anchor = {
        sourceSessionId: sessionId,
        nodeIds: [...manifest],
        workspaceId: anchorWorkspace.workspaceId,
        workspacePath: anchorWorkspace.workspacePath,
        workspaceTitle: anchorWorkspace.workspaceTitle,
        createdAt: Date.now(),
    };
    repository.activateAnchor(sessionId, anchor);
    return anchor;
}
/** Leave Anchor mode. The Host keeps the Anchor Workspace so the same PAs can resume it. */
export async function cancelAnchor(rpc, repository, sessionId, signal) {
    signal.throwIfAborted();
    const state = repository.getSnapshot();
    const anchor = state.anchors[sessionId];
    if (anchor === undefined)
        return;
    // Sent so the Host can give a marker from an older version its identity.
    const sources = anchor.nodeIds.flatMap(nodeId => {
        const node = state.nodes[nodeId];
        return node === undefined ? [] : [hostCoordinates(node)];
    });
    await rpc.cancelAnchorWorkspace({
        sourceSessionId: sessionId,
        workspaceId: anchor.workspaceId,
        ...(sources.length === 0 ? {} : { sources }),
    }, signal).catch(rewordRefusal(message => localized(`取消锚点失败：${message}`, `Failed to cancel the anchor: ${message}`)));
    repository.cancelAnchor(sessionId);
}
/**
 * Send the source Chat's draft as one question to a new child Session seeded
 * with the anchored PAs.
 *
 * The child is never shown, so it is retained here for exactly as long as the
 * question is on its way, and the source composer keeps the question until
 * the Host has taken it. Resolves without sending when the draft is empty.
 * @param anchor - the anchor as it was when the user pressed send.
 * @throws with a message for the user when the question was not sent; the
 *   source draft is then still where it was.
 */
export async function dispatchAnchoredQuestion(services, repository, sessionId, anchor, signal) {
    const { sessions, composers, rpc } = services;
    const sourceBinding = sessions.binding(sessionId);
    if (sourceBinding === undefined)
        throw new Error(localized('无法访问当前 Chat 的输入草稿。', 'Cannot access the current Chat draft.'));
    const sourceInput = composers.inputFor(sourceBinding);
    const draft = sourceInput.state.getSnapshot();
    if (draft.phase !== 'plain')
        throw new Error(localized('输入框正在处理另一项操作，请稍后再发送。', 'The composer is handling another operation. Try again shortly.'));
    if (draft.occurrences.length > 0)
        throw new Error(localized('锚点问题不能包含 @ 引用或其他结构化 chip。', 'Anchored questions cannot contain @ references or other structured chips.'));
    if (draft.draft.trim() === '' && draft.attachmentIds.length === 0)
        return;
    const state = repository.getSnapshot();
    const currentAnchor = state.anchors[String(sessionId)];
    if (currentAnchor === undefined
        || currentAnchor.workspaceId !== anchor.workspaceId
        || !sameValues(currentAnchor.nodeIds, anchor.nodeIds)) {
        throw new Error(localized('锚点在发送期间已变化，请重新发送。', 'The anchor changed during dispatch. Send again.'));
    }
    const selected = selectedNodes(state, anchor.nodeIds);
    if (selected === undefined) {
        throw new Error(localized('固定的 PA 已失效，请取消后重新锚定。', 'A fixed PA is stale. Cancel and create the anchor again.'));
    }
    const childSessionId = `${ANCHORED_SESSION_PREFIX}${randomSuffix()}`;
    const labels = nodeLabelMap(state);
    const response = await rpc.createAnchoredSession({
        targetSessionId: childSessionId,
        workspaceId: anchor.workspaceId,
        sources: selected.map(node => ({
            ...hostCoordinates(node),
            sourceLabel: labels.get(node.id) ?? `PA${node.turn}`,
        })),
    }, signal).catch(rewordRefusal(message => localized(`创建锚点子问题失败：${message}`, `Failed to create the anchored question: ${message}`)));
    if (response.targetSessionId !== childSessionId)
        throw new Error(localized('Host 返回了错误的锚点子会话 ID。', 'The Host returned the wrong anchored child Session ID.'));
    const child = await retainCreatedSession(sessions, childSessionId, signal);
    if (child === undefined)
        throw new Error(localized(`子会话 ${childSessionId} 已创建，但尚未到达浏览器；原草稿未清除。`, `Child Session ${childSessionId} was created but has not reached the browser; the source draft was preserved.`));
    const childInput = composers.inputFor(child.binding);
    let accepted = false;
    let returnAttachments;
    try {
        const sourceUnchanged = () => {
            const latest = sourceInput.state.getSnapshot();
            return latest.phase === 'plain'
                && latest.draftRev === draft.draftRev
                && latest.draft === draft.draft
                && sameValues(latest.attachmentIds, draft.attachmentIds)
                && latest.occurrences.length === 0;
        };
        const assertSourceUnchanged = () => {
            if (sourceUnchanged())
                return;
            throw new Error(localized('子会话已创建，但原草稿在期间发生变化；为避免覆盖，草稿未清除或发送。', 'The child Session was created, but the source draft changed; it was not cleared or sent.'));
        };
        assertSourceUnchanged();
        const handOver = handOverAttachments(composers.conversation, draft.attachmentIds, sourceBinding, child.binding, childInput);
        if (!handOver.ok) {
            throw new Error(localized('子会话已创建，但附件无法转移；原草稿未清除。', 'The child Session was created, but its attachments could not be transferred; the source draft was preserved.'));
        }
        returnAttachments = handOver.undo;
        try {
            // The child sends at once, so its uploads must have finished first.
            await handOver.whenReady(signal);
        }
        catch (cause) {
            if (signal.aborted)
                throw cause;
            throw new Error(localized(`子会话已创建，但附件未能上传到子会话：${cause instanceof Error ? cause.message : String(cause)}；原草稿未清除。`, `The child Session was created, but its attachments could not be uploaded to it: ${cause instanceof Error ? cause.message : String(cause)}; the source draft was preserved.`));
        }
        assertSourceUnchanged();
        // No await between placing the draft and reading the phase it left behind.
        childInput.setDraft(draft.draft);
        childInput.submit();
        if (childInput.state.getSnapshot().phase === 'plain') {
            throw new Error(localized('子会话已创建，但问题未能提交；原草稿未清除。', 'The child Session was created, but the question could not be submitted; the source draft was preserved.'));
        }
        // The source composer keeps the question until the Host has taken it: the
        // child is not on screen, so a refused question would otherwise be lost
        // together with the child's composer.
        accepted = await submissionAccepted(childInput, signal);
        if (!accepted) {
            throw new Error(localized('子会话未接受该问题；问题仍保留在输入框中。', 'The child Session did not accept the question; it is still in the composer.'));
        }
        // Text typed while the question was being admitted is newer input and stays.
        if (sourceUnchanged())
            sourceInput.setDraft('');
        for (const attachmentId of draft.attachmentIds)
            sourceInput.removeAttachment(attachmentId);
        sourceInput.notify('info', localized(`已发送到「${anchor.workspaceTitle}」中的独立子会话。`, `Sent to an independent child Session in “${anchor.workspaceTitle}”.`));
    }
    finally {
        if (!accepted)
            returnAttachments?.();
        // Only this reference kept the unseen child's composer alive.
        child.release();
    }
}
//# sourceMappingURL=anchor-mode.js.map