import type {
  HostObservable, InjectFace, PropsRuntime,
} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ContextTrayProps } from './ContextTray.tsx'
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
 * The escape hatch for an unmerged Context, seated in the composer tool row
 * beside the send button: the paused official composer is exactly where the
 * user looks for it. Selection state stays owned by the Branches view.
 */
export function ComposerDiscardAction({ useTray }: ComposerDiscardActionProps) {
  const locale = useLocale()
  const model = useTray(value => value)
  if (model === null || !model.dirty) return null
  return <button
    className="dsh-git-composer-discard"
    type="button"
    disabled={model.busy}
    title={localized(
      'Context 有未 Merge 的更改。官方输入框已暂停，以免发送到原 Session。',
      'Context has unmerged changes. The official composer is paused to avoid sending to the source Session.',
      locale,
    )}
    onClick={() => model.onDiscard(model.draftHasContent)}
  >
    {localized('放弃更改并发送', 'Discard changes and send', locale)}
  </button>
}
