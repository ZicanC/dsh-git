import { useEffect, useRef } from 'react'
import type {
  HostObservable, InjectFace, PropsRuntime,
} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ContextTrayProps } from './ContextTray.tsx'
import { installComposerSendGuard } from './composer-send-guard.ts'
import { localized, useLocale } from './i18n.ts'

/** Session-bound tray model, shared with the Context Tray dock. */
export interface ComposerDiscardActionInjected {
  readonly hooks: {
    readonly tray: HostObservable<ContextTrayProps | null>
  }
}

export type ComposerDiscardActionProps = PropsRuntime<'conversation.input.right'>
  & InjectFace<ComposerDiscardActionInjected>

/**
 * The composer-row half of the unmerged-Context rule: the official composer
 * keeps accepting text — the draft is what a Merge carries into the new Chat —
 * while its send gestures are refused, leaving Merge and this discard-and-send
 * button as the only two ways out.
 */
export function ComposerDiscardAction({ useTray }: ComposerDiscardActionProps) {
  const locale = useLocale()
  const model = useTray(value => value)
  const anchorRef = useRef<HTMLSpanElement | null>(null)
  const guarded = model !== null && (model.dirty || model.busy)
  const onSendRefused = model?.onSendRefused

  useEffect(() => {
    const anchor = anchorRef.current
    if (!guarded || anchor === null || onSendRefused === undefined) return
    return installComposerSendGuard(anchor, onSendRefused)
  }, [guarded, onSendRefused])

  if (model === null) return null
  // The seat stays mounted while the Branches view publishes, so the guard has
  // an anchor inside the card even when the button itself is not shown.
  return <span className="dsh-git-composer-seat" ref={anchorRef}>
    {model.dirty ? <button
      className="dsh-git-composer-discard"
      type="button"
      disabled={model.busy}
      title={localized(
        'Context 有未 Merge 的更改：官方输入框可以继续输入，但只能 Merge 或在此放弃更改并发送到原 Session。',
        'Context has unmerged changes: the official composer still accepts text, but sending goes through Merge or this discard-and-send button.',
        locale,
      )}
      onClick={() => model.onDiscard(model.draftHasContent)}
    >
      {localized('放弃更改并发送', 'Discard changes and send', locale)}
    </button> : null}
  </span>
}
