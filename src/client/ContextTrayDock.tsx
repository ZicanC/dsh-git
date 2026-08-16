import type {
  HostObservable, InjectFace, PropsRuntime,
} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { ContextTray, type ContextTrayProps } from './ContextTray.tsx'

/** Session-bound observable supplied by the dsh-git client plugin. */
export interface ContextTrayDockInjected {
  readonly hooks: {
    readonly tray: HostObservable<ContextTrayProps | null>
  }
}

export type ContextTrayDockProps = PropsRuntime<'conversation.input.dock'>
  & InjectFace<ContextTrayDockInjected>

/** Official composer-dock adapter; all mutable selection state stays in GraphView. */
export function ContextTrayDock({ useTray }: ContextTrayDockProps) {
  const model = useTray(value => value)
  if (model === null) return null
  const cleanAndEmpty = model.selectedIds.length === 0
    && model.candidateId === null
    && !model.dirty
    && !model.busy
    && model.error === null
  return cleanAndEmpty ? null : <ContextTray {...model} />
}
