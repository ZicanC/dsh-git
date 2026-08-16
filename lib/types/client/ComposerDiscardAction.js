import { jsx as _jsx } from "react/jsx-runtime";
import { localized, useLocale } from "./i18n.js";
/**
 * The escape hatch for an unmerged Context, seated in the composer tool row
 * beside the send button: the paused official composer is exactly where the
 * user looks for it. Selection state stays owned by the Branches view.
 */
export function ComposerDiscardAction({ useTray }) {
    const locale = useLocale();
    const model = useTray(value => value);
    if (model === null || !model.dirty)
        return null;
    return _jsx("button", { className: "dsh-git-composer-discard", type: "button", disabled: model.busy, title: localized('Context 有未 Merge 的更改。官方输入框已暂停，以免发送到原 Session。', 'Context has unmerged changes. The official composer is paused to avoid sending to the source Session.', locale), onClick: () => model.onDiscard(model.draftHasContent), children: localized('放弃更改并发送', 'Discard changes and send', locale) });
}
//# sourceMappingURL=ComposerDiscardAction.js.map