import type { HostObservable, InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type { ContextTrayProps } from './ContextTray.tsx';
import type { GraphState } from './types.ts';
/** Session-bound tray model, shared with the Context Tray dock. */
export interface ComposerDiscardActionInjected {
    readonly hooks: {
        readonly tray: HostObservable<ContextTrayProps | null>;
        readonly graph: HostObservable<GraphState>;
    };
    readonly sessionId: string;
    readonly dispatchAnchoredDraft: () => void;
}
export type ComposerDiscardActionProps = PropsRuntime<'conversation.input.right'> & InjectFace<ComposerDiscardActionInjected>;
/**
 * The composer-row half of the unmerged-Context rule: the official composer
 * keeps accepting text — the draft is what a Merge carries into the new Chat —
 * while its send gestures are refused, leaving Merge and this discard-and-send
 * button as the only two ways out.
 */
export declare function ComposerDiscardAction({ useTray, useGraph, sessionId, dispatchAnchoredDraft, }: ComposerDiscardActionProps): import("react").JSX.Element | null;
