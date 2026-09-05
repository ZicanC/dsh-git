import { describe, expect, it } from 'vitest'
import {
  assembleProjectGraph, projectGraphAt, restoreAnchorSourceLabels,
} from '../src/client/project-graph.ts'
import { nodeLabelMap } from '../src/client/labels.ts'
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
    expect(model.nodes[forkTip]?.primaryParentId).toBeNull()
    expect(model.nodes[forkTip]?.parentIds).toEqual([])
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

  it('projects a legacy single-source composed Session through one explicit fork occurrence', () => {
    const response: ProjectGraphResponse = {
      workspaceId: 'w',
      sessions: [
        { sessionId: 'source', createdAt: 1, seedLength: 0, turns: [
          turn({ turn: 1, fingerprint: 'one', boundarySeq: 5 }),
          turn({ turn: 2, fingerprint: 'two', boundarySeq: 10 }),
          turn({ turn: 3, fingerprint: 'three', boundarySeq: 15 }),
        ] },
        {
          sessionId: 'dsh-git-single-source', createdAt: 40, parentSessionId: 'source', seedLength: 20,
          mergeSources: [
            { sourceSessionId: 'source', sourceTurn: 1, sourceBoundarySeq: 5, targetTurn: 1 },
            { sourceSessionId: 'source', sourceTurn: 2, sourceBoundarySeq: 10, targetTurn: 2 },
            { sourceSessionId: 'source', sourceTurn: 3, sourceBoundarySeq: 15, targetTurn: 3 },
          ],
          turns: [
            turn({ turn: 1, fingerprint: 'one', boundarySeq: 4, inherited: true }),
            turn({ turn: 2, fingerprint: 'two', boundarySeq: 8, inherited: true }),
            turn({ turn: 3, fingerprint: 'three', boundarySeq: 12, inherited: true }),
            turn({ turn: 4, fingerprint: 'own', boundarySeq: 20 }),
          ],
        },
      ],
    }

    const model = assembleProjectGraph(response, graph([]))
    const source = model.state.sessionTurnRefs.source!
    const child = model.state.sessionTurnRefs['dsh-git-single-source']!
    const marker = model.nodes[child[3]!]!
    const firstOwn = model.nodes[child[4]!]!

    expect(child[1]).toBe(source[1])
    expect(child[2]).toBe(source[2])
    expect(child[3]).not.toBe(source[3])
    expect(child[3]).toBe('project-fork:dsh-git-single-source:3')
    expect(marker).toMatchObject({
      sessionId: 'dsh-git-single-source', turn: 3,
      forkSourceId: source[3], primaryParentId: null, parentIds: [],
    })
    expect(firstOwn.parentIds).toEqual([child[3]])
    expect(firstOwn.primaryParentId).toBe(child[3])
    expect(firstOwn.contextManifest).toEqual([source[1], source[2], source[3]])
    expect(model.timeline).toHaveLength(4)
    expect(nodeLabelMap(model.state).get(child[3]!)).toBe(`${nodeLabelMap(model.state).get(source[3]!)} fork`)
  })

  it('reuses the repository fork marker when projecting a single-source composed Session', () => {
    const sourceOne = node({ id: 'source-one', sessionId: 'source', turn: 1, boundarySeq: 5, createdAt: 10 })
    const sourceTwo = node({
      id: 'source-two', sessionId: 'source', turn: 2, boundarySeq: 10, createdAt: 20,
      primaryParentId: sourceOne.id, parentIds: [sourceOne.id],
    })
    const marker = node({
      id: 'repository-fork-marker', sessionId: 'dsh-git-single-source', turn: 2,
      boundarySeq: 10, createdAt: 20.001, forkSourceId: sourceTwo.id,
      primaryParentId: null, parentIds: [],
    })
    const firstOwn = node({
      id: 'child-own', sessionId: 'dsh-git-single-source', turn: 3,
      boundarySeq: 15, createdAt: 30, primaryParentId: marker.id, parentIds: [marker.id],
      contextManifest: [sourceOne.id, sourceTwo.id],
    })
    const local = graph([sourceOne, sourceTwo, marker, firstOwn], {
      sessionTurnRefs: {
        source: { 1: sourceOne.id, 2: sourceTwo.id },
        'dsh-git-single-source': { 1: sourceOne.id, 2: marker.id, 3: firstOwn.id },
      },
    })
    const response: ProjectGraphResponse = {
      workspaceId: 'w',
      sessions: [
        { sessionId: 'source', createdAt: 1, seedLength: 0, turns: [
          turn({ turn: 1, fingerprint: 'one', boundarySeq: 5 }),
          turn({ turn: 2, fingerprint: 'two', boundarySeq: 10 }),
        ] },
        {
          sessionId: 'dsh-git-single-source', createdAt: 25, parentSessionId: 'source', seedLength: 10,
          mergeSources: [
            { sourceSessionId: 'source', sourceTurn: 1, sourceBoundarySeq: 5, targetTurn: 1 },
            { sourceSessionId: 'source', sourceTurn: 2, sourceBoundarySeq: 10, targetTurn: 2 },
          ],
          turns: [
            turn({ turn: 1, fingerprint: 'one', boundarySeq: 4, inherited: true }),
            turn({ turn: 2, fingerprint: 'two', boundarySeq: 8, inherited: true }),
            turn({ turn: 3, fingerprint: 'own', boundarySeq: 15 }),
          ],
        },
      ],
    }

    const model = assembleProjectGraph(response, local)
    const child = model.state.sessionTurnRefs['dsh-git-single-source']!

    expect(child[2]).toBe(marker.id)
    expect(model.nodes[marker.id]).toMatchObject({
      forkSourceId: sourceTwo.id, primaryParentId: null, parentIds: [],
    })
    expect(model.nodes[firstOwn.id]?.parentIds).toEqual([marker.id])
    expect(Object.keys(model.nodes).some(id => id.startsWith('project-fork:dsh-git-single-source:'))).toBe(false)
  })

  it('uses only each source Session terminal as a merge parent while retaining full Context', () => {
    const response: ProjectGraphResponse = {
      workspaceId: 'w',
      sessions: [
        { sessionId: 'source-a', createdAt: 1, seedLength: 0, turns: [
          turn({ turn: 1, fingerprint: 'a1', boundarySeq: 5 }),
          turn({ turn: 2, fingerprint: 'a2', boundarySeq: 10 }),
        ] },
        { sessionId: 'source-b', createdAt: 2, seedLength: 0, turns: [
          turn({ turn: 1, fingerprint: 'b1', boundarySeq: 7 }),
        ] },
        {
          sessionId: 'dsh-git-multi-source', createdAt: 3, parentSessionId: 'source-a', seedLength: 20,
          mergeSources: [
            { sourceSessionId: 'source-a', sourceTurn: 2, sourceBoundarySeq: 10, targetTurn: 3 },
            { sourceSessionId: 'source-a', sourceTurn: 1, sourceBoundarySeq: 5, targetTurn: 1 },
            { sourceSessionId: 'source-b', sourceTurn: 1, sourceBoundarySeq: 7, targetTurn: 2 },
          ],
          turns: [
            turn({ turn: 1, fingerprint: 'a1', boundarySeq: 4, inherited: true }),
            turn({ turn: 2, fingerprint: 'b1', boundarySeq: 8, inherited: true }),
            turn({ turn: 3, fingerprint: 'a2', boundarySeq: 12, inherited: true }),
            turn({ turn: 4, fingerprint: 'merged-own', boundarySeq: 16 }),
          ],
        },
      ],
    }

    const model = assembleProjectGraph(response, graph([]))
    const a1 = model.state.sessionTurnRefs['source-a']?.[1]
    const a2 = model.state.sessionTurnRefs['source-a']?.[2]
    const b1 = model.state.sessionTurnRefs['source-b']?.[1]
    const firstOwn = model.nodes[model.state.sessionTurnRefs['dsh-git-multi-source']?.[4] ?? '']!

    expect(firstOwn.parentIds).toEqual([b1, a2])
    expect(firstOwn.primaryParentId).toBe(a2)
    expect(firstOwn.contextManifest).toEqual([a1, b1, a2])
    expect(Object.keys(model.nodes).some(id => id.startsWith('project-fork:dsh-git-multi-source:'))).toBe(false)
  })

  it.each(['source', 'other-source'])('shares original anchor PAs while keeping every anchored Session parallel (second source: %s)', (secondSource) => {
    const anchorSources = [
      { sourceSessionId: 'source', sourceTurn: 2, sourceBoundarySeq: 20, targetTurn: 1, sourceLabel: 'PA3' },
      { sourceSessionId: secondSource, sourceTurn: 5, sourceBoundarySeq: 50, targetTurn: 2, sourceLabel: 'PA7' },
    ]
    const anchored = (sessionId: string, createdAt: number, suffix: string) => ({
      sessionId,
      createdAt,
      parentSessionId: 'source',
      seedLength: 10,
      mergeSources: anchorSources,
      turns: [
        turn({ turn: 1, fingerprint: 'anchor-two', boundarySeq: 4, inherited: true,
          prompt: 'original prompt two', answer: 'original code two' }),
        turn({ turn: 2, fingerprint: 'anchor-five', boundarySeq: 8, inherited: true,
          prompt: 'original prompt five', answer: 'original code five' }),
        turn({ turn: 3, fingerprint: `${suffix}-one`, boundarySeq: 12 }),
        turn({ turn: 4, fingerprint: `${suffix}-two`, boundarySeq: 16 }),
      ],
    })
    const response: ProjectGraphResponse = {
      workspaceId: 'anchor-workspace',
      sessions: [
        anchored('dsh-git-anchor-a', 100, 'a'),
        anchored('dsh-git-anchor-b', 200, 'b'),
      ],
    }

    const model = assembleProjectGraph(response, graph([]))
    const a = model.state.sessionTurnRefs['dsh-git-anchor-a']!
    const b = model.state.sessionTurnRefs['dsh-git-anchor-b']!

    expect(a[1]).toBe(b[1])
    expect(a[2]).toBe(b[2])
    expect(model.nodes[a[1]!]!).toMatchObject({
      sessionId: 'source', turn: 2, boundarySeq: 20,
      prompt: 'original prompt two', answer: 'original code two', displayLabel: 'PA3',
    })
    expect(model.nodes[a[2]!]!).toMatchObject({
      sessionId: secondSource, turn: 5, boundarySeq: 50,
      prompt: 'original prompt five', answer: 'original code five', displayLabel: 'PA7',
    })
    expect(model.nodes[a[1]!]!.parentIds).toEqual([])
    expect(model.nodes[a[2]!]!.parentIds).toEqual([a[1]])
    expect(model.nodes[a[3]!]!.parentIds).toEqual([a[2]])
    expect(model.nodes[b[3]!]!.parentIds).toEqual([a[2]])
    expect(model.nodes[a[3]!]!.contextManifest).toEqual([a[1], a[2]])
    expect(model.nodes[b[3]!]!.contextManifest).toEqual([a[1], a[2]])
    expect(a[3]).not.toBe(b[3])
    expect(model.nodes[a[4]!]!.parentIds).toEqual([a[3]])
    expect(model.nodes[b[4]!]!.parentIds).toEqual([b[3]])
    expect(model.timeline).toHaveLength(6)
    expect(model.sessionCount).toBe(2)
    const labels = nodeLabelMap(model.state)
    expect(labels.get(a[1]!)).toBe('PA3')
    expect(labels.get(a[2]!)).toBe('PA7')
    expect(labels.get(a[3]!)).toBe('S1.1')
    expect(labels.get(a[4]!)).toBe('S1.2')
    expect(labels.get(b[3]!)).toBe('S2.1')
    expect(labels.get(b[4]!)).toBe('S2.2')
  })

  it('recovers the original PA number for pre-label Anchor Sessions', () => {
    const one = node({ id: 'one', sessionId: 'source', turn: 1, boundarySeq: 10, createdAt: 10 })
    const two = node({ id: 'two', sessionId: 'source', turn: 2, boundarySeq: 20, createdAt: 20 })
    const seven = node({ id: 'seven', sessionId: 'source', turn: 7, boundarySeq: 70, createdAt: 30 })
    const sourceState = graph([one, two, seven], {
      sessionTurnRefs: { source: { 1: 'one', 2: 'two', 7: 'seven' } },
    })
    const response: ProjectGraphResponse = {
      workspaceId: 'anchor-workspace',
      sessions: [{
        sessionId: 'dsh-git-anchor-old', createdAt: 100, parentSessionId: 'source', seedLength: 5,
        mergeSources: [{
          sourceSessionId: 'source', sourceTurn: 7, sourceBoundarySeq: 70, targetTurn: 1,
        }],
        turns: [turn({ turn: 1, fingerprint: 'anchor', inherited: true, boundarySeq: 4 })],
      }],
    }

    const restored = restoreAnchorSourceLabels(response, new Map([['source', sourceState]]))
    expect(restored.sessions[0]?.mergeSources?.[0]?.sourceLabel).toBe('PA3')
    const model = assembleProjectGraph(restored, graph([]))
    const sourceId = model.state.sessionTurnRefs['dsh-git-anchor-old']?.[1]
    expect(nodeLabelMap(model.state).get(sourceId!)).toBe('PA3')
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
