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

  it('uses exact merge lineage instead of a same-fingerprint parent or candidate', () => {
    const response: ProjectGraphResponse = {
      workspaceId: 'w',
      sessions: [
        { sessionId: 'source-a', createdAt: 1, seedLength: 0, turns: [
          turn({ turn: 1, fingerprint: 'duplicate', boundarySeq: 5 }),
        ] },
        { sessionId: 'source-b', createdAt: 2, seedLength: 0, turns: [
          turn({ turn: 1, fingerprint: 'duplicate', boundarySeq: 9 }),
        ] },
        {
          sessionId: 'merged', createdAt: 3, parentSessionId: 'source-b', seedLength: 10,
          mergeSources: [
            { sourceSessionId: 'source-a', sourceTurn: 1, sourceBoundarySeq: 5, targetTurn: 1 },
            { sourceSessionId: 'source-b', sourceTurn: 1, sourceBoundarySeq: 9, targetTurn: 2 },
          ],
          turns: [
            turn({ turn: 1, fingerprint: 'duplicate', boundarySeq: 4, inherited: true }),
            turn({ turn: 2, fingerprint: 'duplicate', boundarySeq: 8, inherited: true }),
            turn({ turn: 3, fingerprint: 'merged-answer', boundarySeq: 12 }),
          ],
        },
      ],
    }

    const model = assembleProjectGraph(response, graph([]))
    const sourceA = model.state.sessionTurnRefs['source-a']?.[1]
    const sourceB = model.state.sessionTurnRefs['source-b']?.[1]
    expect(sourceA).toBeDefined()
    expect(sourceB).toBeDefined()
    expect(sourceA).not.toBe(sourceB)
    expect(model.state.sessionTurnRefs.merged?.[1]).toBe(sourceA)
    expect(model.state.sessionTurnRefs.merged?.[2]).toBe(sourceB)
    expect(model.state.sessionTurnRefs.merged?.[1]).not.toBe(model.state.sessionTurnRefs.merged?.[2])
    expect(Object.keys(model.nodes).some(id => id.startsWith('project-fork:merged:'))).toBe(false)

    const firstOwn = model.nodes[model.state.sessionTurnRefs.merged?.[3] ?? '']!
    expect(firstOwn.parentIds).toEqual([sourceA, sourceB])
    expect(firstOwn.primaryParentId).toBe(sourceB)
    expect(firstOwn.contextManifest).toEqual([sourceA, sourceB])
  })

  it('does not substitute a duplicate fingerprint when an exact merge boundary is stale', () => {
    const response: ProjectGraphResponse = {
      workspaceId: 'w',
      sessions: [
        { sessionId: 'source-a', createdAt: 1, seedLength: 0, turns: [
          turn({ turn: 1, fingerprint: 'duplicate', boundarySeq: 5 }),
        ] },
        { sessionId: 'source-b', createdAt: 2, seedLength: 0, turns: [
          turn({ turn: 1, fingerprint: 'duplicate', boundarySeq: 9 }),
        ] },
        {
          sessionId: 'merged', createdAt: 3, parentSessionId: 'source-b', seedLength: 10,
          mergeSources: [
            { sourceSessionId: 'source-a', sourceTurn: 1, sourceBoundarySeq: 999, targetTurn: 1 },
          ],
          turns: [turn({ turn: 1, fingerprint: 'duplicate', boundarySeq: 4, inherited: true })],
        },
      ],
    }

    const model = assembleProjectGraph(response, graph([]))
    const imported = model.state.sessionTurnRefs.merged?.[1]
    expect(imported).toBe('project-pa:merged:1')
    expect(imported).not.toBe(model.state.sessionTurnRefs['source-a']?.[1])
    expect(imported).not.toBe(model.state.sessionTurnRefs['source-b']?.[1])
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

  it('keeps locally completed turns that arrived after the project RPC snapshot', () => {
    const localOne = node({
      id: 'local-one', sessionId: 'current', turn: 1, createdAt: 10, boundarySeq: 5,
    })
    const localTwo = node({
      id: 'local-two', sessionId: 'current', turn: 2, createdAt: 30, boundarySeq: 10,
      primaryParentId: 'local-one', parentIds: ['local-one'], contextManifest: ['local-one'],
    })
    const local = graph([localOne, localTwo], {
      sessionTurnRefs: { current: { 1: 'local-one', 2: 'local-two' } },
      sessionBranches: { current: 'branch-a' },
      branches: {
        'branch-a': {
          id: 'branch-a', name: 'current', sessionId: 'current',
          headId: 'local-two', color: 0, createdAt: 1,
        },
      },
    })
    const response: ProjectGraphResponse = {
      workspaceId: 'w',
      sessions: [{
        sessionId: 'current', createdAt: 1, seedLength: 0,
        turns: [turn({ turn: 1, fingerprint: 'one', boundarySeq: 5 })],
      }],
    }

    const first = assembleProjectGraph(response, local)
    expect(first.state.sessionTurnRefs.current).toEqual({ 1: 'local-one', 2: 'local-two' })
    expect(first.nodes['local-two']).toMatchObject({
      sessionId: 'current', turn: 2, primaryParentId: 'local-one', parentIds: ['local-one'],
    })
    expect(first.state.branches['project-branch:current']?.headId).toBe('local-two')
    expect(first.timeline.filter(id => id === 'local-two')).toHaveLength(1)
    expect(first.nodes['project-pa:current:2']).toBeUndefined()

    // Reassembly after the observed graph is adopted remains idempotent.
    const second = assembleProjectGraph(response, first.state)
    expect(second.state.sessionTurnRefs.current).toEqual({ 1: 'local-one', 2: 'local-two' })
    expect(second.timeline.filter(id => id === 'local-two')).toHaveLength(1)
  })
})
