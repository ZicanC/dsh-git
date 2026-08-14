import type { GraphState, TurnNode } from '../src/client/types.ts'

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
