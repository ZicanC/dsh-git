/** Browser plugin: Conversation Graph selection and merge-only Chat creation. */
import type { Context } from '@deepseek-ai/cordis';
declare module '@deepseek-ai/dsh-api-session-controller/client' {
    interface SessionReferenceSourceMap {
        /** A dsh-git operation holding a Session it created or reads but does not display. */
        dshGit: unknown;
    }
}
/** Required client services: conversation view/input, sessions, Workspace, navigation, and locale. */
export declare const inject: string[];
/** Mount the browser graph view and its Workspace-isolated repository. */
export declare function apply(ctx: Context): void;
