/** Host half: creates a new Agent from multiple selected turns as real session history. */
import type { Context } from '@deepseek-ai/cordis';
export declare const name = "dsh-git";
export declare const inject: string[];
/** Mount the private history-composition command used by the browser half. */
export declare function apply(ctx: Context): Promise<void>;
