import { jsx as _jsx } from "react/jsx-runtime";
import { useEffect, useRef } from 'react';
import { installComposerSendGuard } from "./composer-send-guard.js";
import { localized, useLocale } from "./i18n.js";
/**
 * The composer-row half of the unmerged-Context rule: the official composer
 * keeps accepting text — the draft is what a Merge carries into the new Chat —
 * while its send gestures are refused, leaving Merge and this discard-and-send
 * button as the only two ways out.
 */
export function ComposerDiscardAction({ useTray }) {
    const locale = useLocale();
    const model = useTray(value => value);
    const anchorRef = useRef(null);
    const guarded = model !== null && (model.dirty || model.busy);
    const onSendRefused = model?.onSendRefused;
    useEffect(() => {
        const anchor = anchorRef.current;
        if (!guarded || anchor === null || onSendRefused === undefined)
            return;
        return installComposerSendGuard(anchor, onSendRefused);
    }, [guarded, onSendRefused]);
    if (model === null)
        return null;
    // The seat stays mounted while the Branches view publishes, so the guard has
    // an anchor inside the card even when the button itself is not shown.
    return _jsx("span", { className: "dsh-git-composer-seat", ref: anchorRef, children: model.dirty ? _jsx("button", { className: "dsh-git-composer-discard", type: "button", disabled: model.busy, title: localized('Context 有未 Merge 的更改：官方输入框可以继续输入，但只能 Merge 或在此放弃更改并发送到原 Session。', 'Context has unmerged changes: the official composer still accepts text, but sending goes through Merge or this discard-and-send button.', locale), onClick: () => model.onDiscard(model.draftHasContent), children: localized('放弃更改并发送', 'Discard changes and send', locale) }) : null });
}
//# sourceMappingURL=ComposerDiscardAction.js.map