/** Host half: creates a new Agent from multiple selected turns as real session history. */
import type { Context } from '@deepseek-ai/cordis';
import { type CreateMergedSessionResponse } from './protocol.ts';
export declare const name = "dsh-git";
export declare const inject: string[];
/** Create one merged child using the final tray source as its official parent. */
export declare function createMergedSession(ctx: Context, payload: unknown, signal: AbortSignal): Promise<CreateMergedSessionResponse>;
/** Mount the trusted RPCs used by the browser half. */
export declare function apply(ctx: Context): Promise<void>;
