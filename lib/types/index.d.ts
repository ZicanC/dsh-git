/** Host half: creates a new Agent from multiple selected turns as real session history. */
import type { Context } from '@deepseek-ai/cordis';
import { type CancelAnchorWorkspaceResponse, type CreateAnchorWorkspaceResponse, type CreateAnchoredSessionResponse, type CreateMergedSessionResponse } from './protocol.ts';
export declare const name = "dsh-git";
export declare const inject: string[];
/** Create one merged child using the final tray source as its official parent. */
export declare function createMergedSession(ctx: Context, payload: unknown, signal: AbortSignal): Promise<CreateMergedSessionResponse>;
/** Create one strict-isolation child in the dedicated Anchor Workspace. */
export declare function createAnchoredSession(ctx: Context, payload: unknown, signal: AbortSignal): Promise<CreateAnchoredSessionResponse>;
/** Reuse or create the dedicated child Workspace for one exact Anchor source set. */
export declare function createAnchorWorkspace(ctx: Context, payload: unknown, signal: AbortSignal): Promise<CreateAnchorWorkspaceResponse>;
/** Leave Anchor mode without deleting its durable, reusable Anchor Workspace. */
export declare function cancelAnchorWorkspace(ctx: Context, payload: unknown, signal: AbortSignal): Promise<CancelAnchorWorkspaceResponse>;
/** Read every completed PA belonging to exactly one Workspace. */
export declare function readProjectGraph(ctx: Context, payload: unknown): Promise<{
    ok: true;
    value: unknown;
}>;
/** Mount the trusted RPCs used by the browser half. */
export declare function apply(ctx: Context): Promise<void>;
