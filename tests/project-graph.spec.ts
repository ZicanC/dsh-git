import { describe, expect, it } from 'vitest'
import { assembleProjectGraph, projectGraphAt } from '../src/client/project-graph.ts'
import { graph, node } from './fixtures.ts'
import type { ProjectGraphResponse, ProjectTurnDTO } from '../src/protocol.ts'

function turn(overrides: Partial<ProjectTurnDTO> & Pick<ProjectTurnDTO, 'turn' | 'fingerprint'>): ProjectTurnDTO {
  return {
    turn: overrides.turn,
    prompt: `q${overrides.turn}`,
    answer: `a${overrides.turn}`,
    startedAt: overrides.turn * 10,
    completedAt: overrides.turn * 10 + 5,
    boundarySeq: overrides.turn * 5,
    inherited: false,
    fingerprint: overrides.fingerprint,
    ...overrides,
  }
}

describe('project graph assembly', () => {
  it('renders one fork-point copy without consuming a PA number and attaches the next PA below it', () => {
    const response: ProjectGraphResponse = {
      workspaceId: 'w1',
      sessions: [
        { sessionId: 'root', createdAt: 1, seedLength: 0, turns: [turn({ turn: 1, fingerprint: 'one' }), turn({ turn: 2, fingerprint: 'two' })] },
        { sessionId: 'fork', createdAt: 30, parentSessionId: 'root', seedLength: 10, turns: [
          turn({ turn: 1, fingerprint: 'one', inherited: true }),
          turn({ turn: 2, fingerprint: 'two', inherited: true }),
          turn({ turn: 3, fingerprint: 'three', startedAt: 40, completedAt: 50 }),
        ] },
      ],
    }
    const model = assembleProjectGraph(response, graph([]), { root: 'Root', fork: 'Fork' })
    expect(model.timeline).toHaveLength(3)
    expect(model.state.sessionTurnRefs.fork?.[1]).toBe(model.state.sessionTurnRefs.root?.[1])
    const forkTip = model.state.sessionTurnRefs.fork?.[2] ?? ''
    const sourceTip = model.state.sessionTurnRefs.root?.[2] ?? ''
    expect(forkTip).not.toBe(sourceTip)
    expect(model.nodes[forkTip]?.forkSourceId).toBe(sourceTip)
    expect(model.nodes[forkTip]?.primaryParentId).toBe(model.state.sessionTurnRefs.root?.[1])
    const third = model.nodes[model.state.sessionTurnRefs.fork?.[3] ?? '']!
    expect(third.parentIds).toEqual([forkTip])
    expect(third.firstInSession).toBe(true)
    expect(projectGraphAt(model, 2).nodes[forkTip]).toBeUndefined()
    expect(projectGraphAt(model, 3).nodes[forkTip]).toBeDefined()
  })

  it('ignores duplicate local ledger ids for an official fork prefix', () => {
    const localOne = node({ id: 'local-one', sessionId: 'root', turn: 1, createdAt: 10 })
    const localTwo = node({ id: 'local-two', sessionId: 'root', turn: 2, createdAt: 20, primaryParentId: 'local-one', parentIds: ['local-one'] })
    const copiedOne = node({ id: 'copied-one', sessionId: 'fork', turn: 1, createdAt: 10 })
    const copiedTwo = node({ id: 'copied-two', sessionId: 'fork', turn: 2, createdAt: 20, primaryParentId: 'copied-one', parentIds: ['copied-one'] })
    const copiedThree = node({ id: 'copied-three', sessionId: 'fork', turn: 3, createdAt: 40, primaryParentId: 'copied-two', parentIds: ['copied-two'] })
    const local = graph([localOne, localTwo, copiedOne, copiedTwo, copiedThree], {
      sessionTurnRefs: { root: { 1: 'local-one', 2: 'local-two' }, fork: { 1: 'copied-one', 2: 'copied-two', 3: 'copied-three' } },
    })
    const response: ProjectGraphResponse = {
      workspaceId: 'w',
      sessions: [
        { sessionId: 'root', createdAt: 1, seedLength: 0, turns: [turn({ turn: 1, fingerprint: 'one' }), turn({ turn: 2, fingerprint: 'two' })] },
        { sessionId: 'fork', createdAt: 30, parentSessionId: 'root', seedLength: 10, turns: [
          turn({ turn: 1, fingerprint: 'one', inherited: true }),
          turn({ turn: 2, fingerprint: 'two', inherited: true }),
          turn({ turn: 3, fingerprint: 'three', startedAt: 40, completedAt: 50 }),
        ] },
      ],
    }

    const model = assembleProjectGraph(response, local)
    expect(model.state.sessionTurnRefs.fork?.[1]).toBe('local-one')
    expect(model.timeline).toEqual(['local-one', 'local-two', model.state.sessionTurnRefs.fork?.[3]])
    expect(model.nodes['copied-one']).toBeUndefined()
    expect(model.nodes['copied-two']).toBeUndefined()
    expect(model.nodes['copied-three']?.parentIds).toEqual([model.state.sessionTurnRefs.fork?.[2]])
  })

  it('preserves exact local multi-parent merge relations', () => {
    const one = node({ id: 'one', sessionId: 'source', turn: 1, createdAt: 10 })
    const two = node({ id: 'two', sessionId: 'source', turn: 2, createdAt: 20, primaryParentId: 'one', parentIds: ['one'] })
    const merge = node({
      id: 'merge', sessionId: 'child', turn: 3, createdAt: 30,
      primaryParentId: 'two', parentIds: ['one', 'two'], contextManifest: ['two', 'one'],
    })
    const local = graph([one, two, merge], {
      sessionTurnRefs: { source: { 1: 'one', 2: 'two' }, child: { 1: 'one', 2: 'two', 3: 'merge' } },
    })
    const response: ProjectGraphResponse = {
      workspaceId: 'w',
      sessions: [
        { sessionId: 'source', createdAt: 1, seedLength: 0, turns: [turn({ turn: 1, fingerprint: '1' }), turn({ turn: 2, fingerprint: '2' })] },
        { sessionId: 'child', createdAt: 25, seedLength: 10, turns: [
          turn({ turn: 1, fingerprint: '1', inherited: true }),
          turn({ turn: 2, fingerprint: '2', inherited: true }),
          turn({ turn: 3, fingerprint: '3' }),
        ] },
      ],
    }
    const model = assembleProjectGraph(response, local)
    expect(model.nodes.merge?.parentIds).toEqual(['one', 'two'])
    expect(model.nodes.merge?.contextManifest).toEqual(['two', 'one'])
  })

  it('reuses a merged parent prefix when an official fork has ambiguous content fingerprints', () => {
    const one = node({ id: 'one', sessionId: 'source', turn: 1, createdAt: 10 })
    const seven = node({ id: 'seven', sessionId: 'other', turn: 1, createdAt: 20 })
    const merge = node({
      id: 'merge', sessionId: 'merged', turn: 3, createdAt: 30,
      primaryParentId: 'seven', parentIds: ['one', 'seven'], contextManifest: ['one', 'seven'],
    })
    const local = graph([one, seven, merge], {
      sessionTurnRefs: {
        source: { 1: 'one' },
        other: { 1: 'seven' },
        merged: { 1: 'one', 2: 'seven', 3: 'merge' },
      },
    })
    const response: ProjectGraphResponse = {
      workspaceId: 'w',
      sessions: [
        { sessionId: 'source', createdAt: 1, seedLength: 0, turns: [turn({ turn: 1, fingerprint: 'same-one' })] },
        { sessionId: 'duplicate-one', createdAt: 2, seedLength: 0, turns: [turn({ turn: 1, fingerprint: 'same-one' })] },
        { sessionId: 'other', createdAt: 3, seedLength: 0, turns: [turn({ turn: 1, fingerprint: 'same-seven' })] },
        { sessionId: 'duplicate-seven', createdAt: 4, seedLength: 0, turns: [turn({ turn: 1, fingerprint: 'same-seven' })] },
        { sessionId: 'merged', createdAt: 5, parentSessionId: 'source', seedLength: 10, turns: [
          turn({ turn: 1, fingerprint: 'same-one', inherited: true }),
          turn({ turn: 2, fingerprint: 'same-seven', inherited: true }),
          turn({ turn: 3, fingerprint: 'same-merge' }),
        ] },
        { sessionId: 'duplicate-merge', createdAt: 6, seedLength: 0, turns: [turn({ turn: 1, fingerprint: 'same-merge' })] },
        { sessionId: 'official-fork', createdAt: 7, parentSessionId: 'merged', seedLength: 15, turns: [
          turn({ turn: 1, fingerprint: 'same-one', inherited: true }),
          turn({ turn: 2, fingerprint: 'same-seven', inherited: true }),
          turn({ turn: 3, fingerprint: 'same-merge', inherited: true }),
          turn({ turn: 4, fingerprint: 'new-question', startedAt: 80, completedAt: 90 }),
        ] },
      ],
    }

    const model = assembleProjectGraph(response, local)
    expect(model.state.sessionTurnRefs['official-fork']?.[1]).toBe('one')
    expect(model.state.sessionTurnRefs['official-fork']?.[2]).toBe('seven')
    const forkTip = model.state.sessionTurnRefs['official-fork']?.[3] ?? ''
    expect(model.nodes[forkTip]?.forkSourceId).toBe('merge')
    const next = model.nodes[model.state.sessionTurnRefs['official-fork']?.[4] ?? '']!
    expect(next.parentIds).toEqual([forkTip])
    expect(next.firstInSession).toBe(true)
  })

  it('reveals exactly one additional PA at each timeline step', () => {
    const response: ProjectGraphResponse = {
      workspaceId: 'w',
      sessions: [{ sessionId: 's', createdAt: 1, seedLength: 0, turns: [
        turn({ turn: 1, fingerprint: 'a', completedAt: 30 }),
        turn({ turn: 2, fingerprint: 'b', completedAt: 40 }),
      ] }],
    }
    const model = assembleProjectGraph(response, graph([]))
    const first = projectGraphAt(model, 1)
    expect(Object.keys(first.nodes)).toHaveLength(1)
    expect(Object.values(first.nodes)[0]?.parentIds).toEqual([])
    expect(Object.keys(projectGraphAt(model, 2).nodes)).toHaveLength(2)
  })
})
