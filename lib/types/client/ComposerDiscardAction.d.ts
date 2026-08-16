import type { HostObservable, InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type { ContextTrayProps } from './ContextTray.tsx';
/** Session-bound tray model, shared with the Context Tray dock. */
export interface ComposerDiscardActionInjected {
    readonly hooks: {
        readonly tray: HostObservable<ContextTrayProps | null>;
    };
}
export type ComposerDiscardActionProps = PropsRuntime<'conversation.input.right'> & InjectFace<ComposerDiscardActionInjected>;
/**
 * The escape hatch for an unmerged Context, seated in the composer tool row
 * beside the send button: the paused official composer is exactly where the
 * user looks for it. Selection state stays owned by the Branches view.
 */
export declare function ComposerDiscardAction({ useTray }: ComposerDiscardActionProps): import("react").JSX.Element | null;
