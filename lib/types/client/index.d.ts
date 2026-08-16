/** Browser plugin: Conversation Graph selection and merge-only Chat creation. */
import type { Context } from '@deepseek-ai/cordis';
/** Required client services: conversation view/input, sessions, Workspace, and locale. */
export declare const inject: string[];
/** Mount the browser graph view and its Workspace-isolated repository. */
export declare function apply(ctx: Context): void;
