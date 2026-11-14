export function json(value) {
    try {
        return JSON.stringify(value, null, 2);
    }
    catch {
        return String(value);
    }
}
export function oneLine(value, maximum = 180) {
    const line = value.trim().split(/\r?\n/, 1)[0]?.trim() ?? '';
    return line.length <= maximum ? line : `${line.slice(0, maximum - 1)}…`;
}
export function sourceKind(source) {
    if (typeof source !== 'object' || source === null || Array.isArray(source))
        return null;
    const record = source;
    return typeof record.kind === 'string' ? record.kind : null;
}
function sourceRecord(value) {
    if (typeof value !== 'object' || value === null || Array.isArray(value))
        return null;
    return value;
}
function sourceString(record, key) {
    const value = record[key];
    return typeof value === 'string' && value !== '' ? value : null;
}
/** Same durable-source projection used by the official Context Injection row. */
export function previewContextProvenance(source) {
    const record = sourceRecord(source);
    if (record === null)
        return { role: 'inject', label: null };
    const kind = sourceString(record, 'kind');
    if (kind === null)
        return { role: 'inject', label: null };
    const collect = (member, field) => {
        const entries = record[member];
        if (!Array.isArray(entries))
            return [];
        const values = [];
        for (const entry of entries) {
            const item = sourceRecord(entry);
            const value = item === null ? null : sourceString(item, field);
            if (value !== null && !values.includes(value))
                values.push(value);
        }
        return values;
    };
    if (kind === 'session-reference') {
        const labels = collect('references', 'label');
        return { role: 'recall', label: labels.length === 0 ? kind : labels.join(', ') };
    }
    if (kind === 'agent-instructions') {
        const paths = collect('changes', 'path');
        return { role: 'inject', label: paths.length === 0 ? kind : paths.join(', ') };
    }
    if (kind === 'plugin')
        return { role: 'inject', label: sourceString(record, 'plugin') ?? kind };
    if (kind === 'skill-invocation')
        return { role: 'inject', label: sourceString(record, 'name') ?? kind };
    return { role: 'inject', label: kind };
}
export function firstBlockText(blocks) {
    for (const block of blocks) {
        if ((block.type === 'text' || block.type === 'reasoning') && block.text.trim() !== '')
            return oneLine(block.text);
        if (block.type === 'tool-result') {
            const nested = firstBlockText(block.content);
            if (nested !== '')
                return nested;
        }
    }
    return '';
}
export function argumentSummary(argumentsText) {
    try {
        const parsed = JSON.parse(argumentsText);
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
            return oneLine(String(parsed));
        const record = parsed;
        for (const key of ['description', 'path', 'file_path', 'command', 'query', 'pattern', 'url', 'name']) {
            const value = record[key];
            if (typeof value === 'string' && value.trim() !== '')
                return oneLine(value);
        }
    }
    catch {
        // Tool arguments are producer-owned; malformed JSON stays readable as text.
    }
    return oneLine(argumentsText);
}
export function formattedArguments(argumentsText) {
    try {
        return JSON.stringify(JSON.parse(argumentsText), null, 2);
    }
    catch {
        return argumentsText;
    }
}
//# sourceMappingURL=preview-text.js.map