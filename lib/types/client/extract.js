function contentText(content) {
    return content.flatMap((block) => {
        const candidate = block;
        return candidate.type === 'text' && typeof candidate.text === 'string' ? [candidate.text] : [];
    }).join('\n');
}
function assistantText(node) {
    return node.blocks.flatMap(block => block.kind === 'text' ? [block.text] : []).join('\n');
}
/** Project completed DSH turns into Prompt + Answer records for the graph ledger. */
export function extractCompletedTurns(snapshot) {
    const result = [];
    for (const turnNumber of snapshot.chat.timeline.turnOrder) {
        const location = snapshot.chat.timeline.turns.get(turnNumber);
        const start = location?.start;
        const end = location?.end;
        if (location?.status !== 'closed' || start === undefined || end === undefined)
            continue;
        const nodes = snapshot.nodes.filter(node => node.seq > start.seq && node.seq < end.seq);
        const prompt = nodes.flatMap(node => node.kind === 'user' ? [contentText(node.content)] : [])
            .filter(Boolean)
            .join('\n');
        const answer = nodes.flatMap(node => node.kind === 'assistant' ? [assistantText(node)] : [])
            .filter(Boolean)
            .join('\n\n');
        if (prompt === '' && answer === '')
            continue;
        result.push({
            turn: turnNumber,
            prompt,
            answer,
            createdAt: start.time,
            boundarySeq: end.seq,
        });
    }
    return result;
}
//# sourceMappingURL=extract.js.map