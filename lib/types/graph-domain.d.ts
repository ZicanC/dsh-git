import { z } from 'zod';
import type { GraphState } from './graph-state.ts';
/** Ledger owner: one Workspace folder, or one folder-less Session. */
export type GraphScopeId = string & {
    readonly __graphScope: unique symbol;
};
/**
 * Longest accepted scope id. Scope ids are record keys, never file-path
 * segments, so the cap only bounds what one untrusted call can allocate.
 */
export declare const MAX_SCOPE_ID_LENGTH = 512;
/** One scope's complete ledger, as stored and as accepted off the wire. */
export declare const graphStateSchema: z.ZodType<GraphState>;
/**
 * The graph domain. `UNIT_NAME_RE` is `/^[a-z][a-z0-9_]*$/`, so the domain and
 * table names are underscore-separated rather than matching the package name.
 */
export declare const GRAPH_DOMAIN: {
    name: string;
    version: number;
    tables: {
        scopes: import("@deepseek-ai/dsh-storage-domain").DomainTableSpec<GraphScopeId, GraphState>;
    };
};
/** Reject a scope id that is blank or larger than one record key should be. */
export declare function assertScopeId(value: unknown): GraphScopeId;
