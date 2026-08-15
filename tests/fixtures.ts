import type { GraphTransport } from '../src/client/graph-transport.ts'
import { EMPTY_GRAPH_STATE, type GraphState, type TurnNode } from '../src/client/types.ts'

/** In-process stand-in for the Host ledger; `reads`/`writes` count RPC traffic. */
export class MemoryTransport implements GraphTransport {
  readonly scopes = new Map<string, GraphState>()
  reads = 0
  writes = 0

  constructor(seed: Readonly<Record<string, GraphState>> = {}) {
    for (const [scope, state] of Object.entries(seed)) this.scopes.set(scope, state)
  }

  async read(scopeId: string): Promise<GraphState> {
    this.reads += 1
    return this.scopes.get(scopeId) ?? EMPTY_GRAPH_STATE
  }

  async write(scopeId: string, state: GraphState): Promise<void> {
    this.writes += 1
    this.scopes.set(scopeId, state)
  }
}

export function node(overrides: Partial<TurnNode> & Pick<TurnNode, 'id'>): TurnNode {
  return {
    id: overrides.id,
    sessionId: 'session-a',
    turn: 1,
    prompt: `question ${overrides.id}`,
    answer: `answer ${overrides.id}`,
    createdAt: 1,
    boundarySeq: 5,
    primaryParentId: null,
    parentIds: [],
    contextManifest: [],
    branchId: 'branch-a',
    ...overrides,
  }
}

export function graph(nodes: readonly TurnNode[], overrides: Partial<GraphState> = {}): GraphState {
  return {
    format: 1,
    nodes: Object.fromEntries(nodes.map(value => [value.id, value])),
    branches: {
      'branch-a': {
        id: 'branch-a', name: 'main', sessionId: 'session-a',
        headId: nodes.at(-1)?.id ?? null, color: 0, createdAt: 1,
      },
    },
    sessionBranches: { 'session-a': 'branch-a' },
    sessionTurnRefs: {},
    pendingMerges: {},
    headNodeId: nodes.at(-1)?.id ?? null,
    previewNodeId: nodes.at(-1)?.id ?? null,
    contextManifest: nodes.map(value => value.id),
    ...overrides,
  }
}
