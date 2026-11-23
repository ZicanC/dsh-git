import type { GraphState, TurnNodeId } from './graph-state.ts';
/** Identity survives projection into another scope and does not depend on labels. */
export declare function identityOf(state: GraphState, id: TurnNodeId): string;
/**
 * Retire node ids in favour of others, rewriting every reference the ledger holds.
 *
 * Each key of `replacements` is removed from the graph and every edge, Context
 * entry, Session history ref, pending recipe, anchor, branch head, and view
 * pointer that named it now names the replacement. A Context reference follows
 * its PA to the replacement's identity, so no reference is left dangling.
 */
export declare function replaceNodes(state: GraphState, replacements: ReadonlyMap<TurnNodeId, TurnNodeId>): GraphState;
/**
 * Collapse records that describe the same PA occurrence in the same Session.
 *
 * A Session holds at most one occurrence of a PA. Ledgers written before that
 * rule was enforced, and graphs observed under another id scheme, can carry
 * the same turn twice: once under the id its Session history references and
 * once under an unreferenced id. The referenced record survives and inherits
 * any number the other had already been given; a ledger with nothing to
 * collapse is returned as the same object.
 */
export declare function repairOccurrences(state: GraphState): GraphState;
/** Append stable numbering in dependency order. Existing final events never move. */
export declare function finalizeGraph(state: GraphState): GraphState;
/** Semantic validation at the write boundary; malformed batches are never repaired silently. */
export declare function assertGraphSemantics(state: GraphState): void;
