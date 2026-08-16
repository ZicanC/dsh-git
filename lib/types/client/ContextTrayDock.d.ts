import type { HostObservable, InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import { type ContextTrayProps } from './ContextTray.tsx';
/** Session-bound observable supplied by the dsh-git client plugin. */
export interface ContextTrayDockInjected {
    readonly hooks: {
        readonly tray: HostObservable<ContextTrayProps | null>;
    };
}
export type ContextTrayDockProps = PropsRuntime<'conversation.input.dock'> & InjectFace<ContextTrayDockInjected>;
/** Official composer-dock adapter; all mutable selection state stays in GraphView. */
export declare function ContextTrayDock({ useTray }: ContextTrayDockProps): import("react").JSX.Element | null;
