/** Browser access to the Host-owned graph ledger over the `/dsh-git` channel. */
import type { ProjectConnection } from '../connection-contract.ts'
import { EMPTY_GRAPH_STATE, type GraphState } from '../graph-state.ts'
import {
  GRAPH_READ_ENDPOINT,
  GRAPH_WRITE_ENDPOINT,
  PROJECT_GRAPH_RPC_CHANNEL,
  decodeGraphReadResponse,
} from '../protocol.ts'

/** Reads and writes one scope's ledger; the repository owns everything above this. */
export interface GraphTransport {
  /** Load a scope's stored ledger, or the empty ledger when it has never been written. */
  read(scopeId: string): Promise<GraphState>
  /** Replace a scope's stored ledger. */
  write(scopeId: string, state: GraphState): Promise<void>
}

function normalize(state: unknown): GraphState {
  if (state === null || typeof state !== 'object') return EMPTY_GRAPH_STATE
  const candidate = state as Partial<GraphState>
  if (candidate.format !== 1) return EMPTY_GRAPH_STATE
  return { ...EMPTY_GRAPH_STATE, ...candidate }
}

/**
 * Bind the ledger endpoints to a Connection.
 *
 * Writes are serialized per scope: the repository commits synchronously to
 * memory and hands the resulting snapshot here, so two overlapping calls would
 * otherwise be free to land on the medium out of order and leave the durable
 * ledger behind the one on screen.
 */
export function connectionGraphTransport(connection: ProjectConnection): GraphTransport {
  const chains = new Map<string, Promise<void>>()
  return {
    async read(scopeId) {
      const result = await connection.rpc.call(PROJECT_GRAPH_RPC_CHANNEL, GRAPH_READ_ENDPOINT, { scopeId })
      if (!result.ok) throw new Error(result.error.message)
      return normalize(decodeGraphReadResponse(result.value).state)
    },
    write(scopeId, state) {
      const previous = chains.get(scopeId) ?? Promise.resolve()
      const next = previous.then(async () => {
        const result = await connection.rpc.call(
          PROJECT_GRAPH_RPC_CHANNEL,
          GRAPH_WRITE_ENDPOINT,
          { scopeId, state },
        )
        if (!result.ok) throw new Error(result.error.message)
      })
      // Keep the chain alive past a rejected write so one failure cannot wedge
      // the scope; the caller still receives the rejection it asked for.
      chains.set(scopeId, next.catch(() => undefined))
      return next
    },
  }
}
