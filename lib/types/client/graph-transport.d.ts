/** Browser access to the Host-owned graph ledger over the `/dsh-git` channel. */
import type { ProjectConnection } from '../connection-contract.ts';
import { type GraphState } from '../graph-state.ts';
/** Reads and writes one scope's ledger; the repository owns everything above this. */
export interface GraphTransport {
    /** Load a scope's stored ledger, or the empty ledger when it has never been written. */
    read(scopeId: string): Promise<GraphState>;
    /** Replace a scope's stored ledger. */
    write(scopeId: string, state: GraphState): Promise<void>;
}
/**
 * Bind the ledger endpoints to a Connection.
 *
 * Writes are serialized per scope: the repository commits synchronously to
 * memory and hands the resulting snapshot here, so two overlapping calls would
 * otherwise be free to land on the medium out of order and leave the durable
 * ledger behind the one on screen.
 */
export declare function connectionGraphTransport(connection: ProjectConnection): GraphTransport;
