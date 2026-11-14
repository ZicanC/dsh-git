/**
 * Browser plugin entry: registers the Branches view, the Context Tray dock,
 * and the composer action, and wires each to the ledger and the Host.
 *
 * The workflows themselves live beside this file — `./merged-chat.ts`,
 * `./anchor-mode.ts`, `./session-handoff.ts` — so what remains here is the
 * composition: which services each slot's component receives.
 */
import type { Context } from '@deepseek-ai/cordis';
/** Required client services: conversation view/input, sessions, Workspace, navigation, and locale. */
export declare const inject: string[];
/** Mount the browser graph view and its Workspace-isolated repository. */
export declare function apply(ctx: Context): void;
