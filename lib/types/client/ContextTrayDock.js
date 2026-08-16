import { jsx as _jsx } from "react/jsx-runtime";
import { ContextTray } from "./ContextTray.js";
/** Official composer-dock adapter; all mutable selection state stays in GraphView. */
export function ContextTrayDock({ useTray }) {
    const model = useTray(value => value);
    if (model === null)
        return null;
    const cleanAndEmpty = model.selectedIds.length === 0
        && model.candidateId === null
        && !model.dirty
        && !model.busy
        && model.error === null;
    return cleanAndEmpty ? null : _jsx(ContextTray, { ...model });
}
//# sourceMappingURL=ContextTrayDock.js.map