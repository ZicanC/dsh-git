import type { GraphState, ImportedTurn, PrepareMergedSessionInput } from './types.ts';
/** Import one Session's completed turns, minting a node for each turn not yet known. */
export declare function syncSessionTurns(state: GraphState, sessionId: string, turns: readonly ImportedTurn[]): GraphState;
/**
 * Fold the prefix an official Harness fork copied from its parent back into
 * the parent's own PAs, leaving one fork occurrence at the tip.
 *
 * The copied turns are the same PAs as the parent's, so the child Session's
 * history points at the parent's nodes and only the last copied turn stays
 * visible, as a fork occurrence the child's own turns continue from. When the
 * copies were numbered first (the fork was read before its parent), the
 * parent's nodes take over those numbers: a label already shown never changes
 * and no number is left unused.
 */
export declare function reconcileOfficialForks(state: GraphState, parents: Readonly<Record<string, string>>): GraphState;
/**
 * Register a composed child Session before its first new official turn.
 *
 * The child's history points at the selected PAs. A selection from a single
 * lineage is a Fork: its tip becomes a fork occurrence owned by the child, and
 * the first new turn continues from that occurrence. The recipe is kept as a
 * pending merge until that first turn completes.
 */
export declare function prepareMergedSession(state: GraphState, input: PrepareMergedSessionInput): GraphState;
/**
 * Union a Host-observed Workspace graph into the ledger without replacing the
 * ledger's own records, branch names, or pending merge metadata.
 *
 * Project assembly reuses every known browser id before minting fallback ids,
 * so the union makes previously unopened Session turns available to a later
 * composed child without duplicating them.
 */
export declare function adoptObservedGraph(state: GraphState, observed: GraphState): GraphState;
