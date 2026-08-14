/** Browser plugin: conversation DAG graph, context tray, and automatic merge branches. */
import type { Context } from '@deepseek-ai/cordis';
/** Required client services: the conversation view slot and session runtime. */
export declare const inject: string[];
/** Mount the browser graph view and its process-local persistent repository. */
export declare function apply(ctx: Context): void;
