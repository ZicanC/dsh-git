import { describe, expect, it } from 'vitest'
import { assertGraphSemantics, finalizeGraph, repairOccurrences } from '../src/graph-ledger.ts'
import { GraphRepository } from '../src/client/repository.ts'
import { nodeLabelMap } from '../src/client/labels.ts'
import { assembleProjectGraph } from '../src/client/project-graph.ts'
import type { GraphState, ImportedTurn } from '../src/client/types.ts'
import type { ProjectTurnDTO } from '../src/protocol.ts'
import { graph, node, MemoryTransport } from './fixtures.ts'

const turn = (number: number, text: string, boundarySeq: number): ImportedTurn => ({
  turn: number, prompt: `q${text}`, answer: `a${text}`, createdAt: number * 10, boundarySeq,
})

const hostTurn = (number: number, text: string, boundarySeq: number, inherited: boolean): ProjectTurnDTO => ({
  turn: number,
  prompt: `q${text}`,
  answer: `a${text}`,
  startedAt: number * 10,
  completedAt: number * 10 + 1,
  boundarySeq,
  inherited,
  fingerprint: `fp${text}`,
})

/** `turn → label` for one Session, with fork occurrences marked. */
function labels(state: GraphState, sessionId: string): Record<number, string> {
  const map = nodeLabelMap(state)
  return Object.fromEntries(Object.entries(state.sessionTurnRefs[sessionId] ?? {})
    .map(([number, id]) => [Number(number), map.get(id) ?? '?']))
}

const parentTurns = [turn(1, '1', 5), turn(2, '2', 11)]
const childTurns = [...parentTurns, turn(3, '3', 17)]

describe('official Harness forks', () => {
  it('spends no PA number on the copied prefix when the parent is already known', () => {
    const repository = new GraphRepository()
    repository.syncSession('S', parentTurns)
    repository.syncSession('T', childTurns, { T: 'S' })

    const state = repository.getSnapshot()
    expect(labels(state, 'S')).toEqual({ 1: 'PA1', 2: 'PA2' })
    expect(labels(state, 'T')).toEqual({ 1: 'PA1', 2: 'PA2 fork', 3: 'PA3' })
    expect(state.ledgerSequence).toBe(3)
    expect(() => assertGraphSemantics(state)).not.toThrow()
  })

  it('keeps the numbers already shown when the parent is first read after its fork', () => {
    const repository = new GraphRepository()
    repository.syncSession('T', childTurns, { T: 'S' })
    expect(labels(repository.getSnapshot(), 'T')).toEqual({ 1: 'PA1', 2: 'PA2', 3: 'PA3' })

    repository.syncSession('S', parentTurns, { T: 'S' })

    const state = repository.getSnapshot()
    expect(labels(state, 'S')).toEqual({ 1: 'PA1', 2: 'PA2' })
    expect(labels(state, 'T')).toEqual({ 1: 'PA1', 2: 'PA2 fork', 3: 'PA3' })
    expect(state.ledgerSequence).toBe(3)
    expect(() => assertGraphSemantics(state)).not.toThrow()
  })

  it('carries a Context reference across to the identity that replaces a copied turn', () => {
    const repository = new GraphRepository()
    repository.syncSession('S', parentTurns)
    repository.syncSession('T', childTurns)
    const before = repository.getSnapshot()
    const copyId = before.sessionTurnRefs.T![1]!
    const ownId = before.sessionTurnRefs.T![3]!
    // A third Session was composed from the copy before the fork was recognised.
    repository.prepareMergedSession({
      childSessionId: 'dsh-git-merged',
      importedNodeIds: [copyId, ownId],
      parentIds: [ownId],
      primaryParentId: ownId,
      contextManifest: [copyId, ownId],
      contextRefs: [
        { paId: before.nodes[copyId]!.paId!, viaSessionId: 'T' },
        { paId: before.nodes[ownId]!.paId!, viaSessionId: 'T' },
      ],
    })

    repository.reconcileOfficialForks({ T: 'S' })

    const state = repository.getSnapshot()
    expect(state.nodes[copyId]).toBeUndefined()
    expect(() => assertGraphSemantics(state)).not.toThrow()
    const sourceId = state.sessionTurnRefs.S![1]!
    expect(state.pendingMerges['dsh-git-merged']!.contextRefs![0]!.paId).toBe(state.nodes[sourceId]!.paId)
  })

  it('reuses the live fork occurrence when the Workspace graph is adopted', () => {
    const repository = new GraphRepository()
    repository.syncSession('S', parentTurns)
    repository.syncSession('T', childTurns, { T: 'S' })
    const model = assembleProjectGraph({ workspaceId: 'w', sessions: [
      { sessionId: 'S', createdAt: 1, seedLength: 0, turns: [hostTurn(1, '1', 5, false), hostTurn(2, '2', 11, false)] },
      {
        sessionId: 'T', parentSessionId: 'S', createdAt: 25, seedLength: 12,
        turns: [hostTurn(1, '1', 5, true), hostTurn(2, '2', 11, true), hostTurn(3, '3', 17, false)],
      },
    ] }, repository.getSnapshot())

    const liveForkId = repository.getSnapshot().sessionTurnRefs.T![2]!
    expect(model.state.sessionTurnRefs.T![2]).toBe(liveForkId)
    expect(model.nodes[liveForkId]).toMatchObject({ sessionId: 'T', forkSourceId: model.state.sessionTurnRefs.S![2] })

    repository.adoptObservedGraph(model.state)

    const state = repository.getSnapshot()
    expect(Object.values(state.nodes).filter(candidate => candidate.forkSourceId !== undefined)).toHaveLength(1)
    expect(Object.keys(state.nodes)).toHaveLength(4)
    expect(() => assertGraphSemantics(state)).not.toThrow()
  })
})

describe('composed Fork occurrences', () => {
  it('address the child Session by its own coordinates once the child has been read', () => {
    const repository = new GraphRepository()
    repository.syncSession('S', parentTurns)
    const sourceId = repository.getSnapshot().sessionTurnRefs.S![2]!
    repository.prepareMergedSession({
      childSessionId: 'dsh-git-child',
      importedNodeIds: [sourceId],
      parentIds: [sourceId],
      primaryParentId: sourceId,
      contextManifest: [sourceId],
    })

    // The child seed holds one renumbered turn; its boundary is not the source's.
    repository.syncSession('dsh-git-child', [turn(1, '2', 5), turn(2, 'new', 11)])

    const state = repository.getSnapshot()
    const copy = state.nodes[state.sessionTurnRefs['dsh-git-child']![1]!]!
    expect(copy.forkSourceId).toBe(sourceId)
    expect({ sessionId: copy.sessionId, turn: copy.turn, boundarySeq: copy.boundarySeq })
      .toEqual({ sessionId: 'dsh-git-child', turn: 1, boundarySeq: 5 })
    // The source keeps the coordinates of the Session that produced it.
    expect(state.nodes[sourceId]!.boundarySeq).toBe(11)
    expect(labels(state, 'dsh-git-child')).toEqual({ 1: 'PA2 fork', 2: 'PA3' })
  })
})

describe('one occurrence per Session and PA', () => {
  it('never adopts a second copy of a turn the ledger already holds', () => {
    const repository = new GraphRepository()
    repository.syncSession('A', [turn(1, '1', 5)])
    const localId = repository.getSnapshot().sessionTurnRefs.A![1]!
    const observed = graph([
      node({ id: 'project-pa:A:1', sessionId: 'A', turn: 1, boundarySeq: 5 }),
      node({ id: 'project-pa:A:2', sessionId: 'A', turn: 2, boundarySeq: 11, primaryParentId: 'project-pa:A:1', parentIds: ['project-pa:A:1'] }),
    ], { sessionTurnRefs: { A: { 1: 'project-pa:A:1', 2: 'project-pa:A:2' } }, contextManifest: [] })

    repository.adoptObservedGraph(observed)

    const state = repository.getSnapshot()
    expect(Object.keys(state.nodes).sort()).toEqual([localId, 'project-pa:A:2'].sort())
    expect(state.nodes['project-pa:A:2']!.parentIds).toEqual([localId])
    expect(state.nodes['project-pa:A:2']!.primaryParentId).toBe(localId)
    expect(() => assertGraphSemantics(state)).not.toThrow()
  })

  it('repairs a stored ledger that holds the same turn under two ids', async () => {
    // Shape found in a real ledger: the Session history references one id while
    // an unreferenced second node carries the same Session, turn, and boundary.
    const kept = node({ id: 'pa-kept', sessionId: 'A', turn: 1, boundarySeq: 247 })
    const orphan = node({ id: 'project-pa:A:1', sessionId: 'A', turn: 1, boundarySeq: 247 })
    const child = node({
      id: 'pa-child', sessionId: 'A', turn: 2, boundarySeq: 694,
      primaryParentId: 'project-pa:A:1', parentIds: ['project-pa:A:1'], contextManifest: ['project-pa:A:1'],
    })
    const stored = graph([kept, orphan, child], {
      sessionTurnRefs: { A: { 1: 'pa-kept', 2: 'pa-child' } },
      headNodeId: 'pa-child',
      previewNodeId: 'project-pa:A:1',
      contextManifest: ['project-pa:A:1', 'pa-kept'],
    })
    expect(() => assertGraphSemantics(finalizeGraph(stored))).toThrow(/Duplicate Session PA occurrence/)

    const repaired = repairOccurrences(stored)
    expect(Object.keys(repaired.nodes).sort()).toEqual(['pa-child', 'pa-kept'])
    expect(repaired.nodes['pa-child']!.parentIds).toEqual(['pa-kept'])
    expect(repaired.nodes['pa-child']!.contextManifest).toEqual(['pa-kept'])
    expect(repaired.previewNodeId).toBe('pa-kept')
    expect(repaired.contextManifest).toEqual(['pa-kept'])
    expect(() => assertGraphSemantics(finalizeGraph(repaired))).not.toThrow()
    // A healthy ledger is returned untouched.
    expect(repairOccurrences(repaired)).toBe(repaired)

    const transport = new MemoryTransport({ w: stored })
    const repository = new GraphRepository(transport, 'w')
    await repository.hydrate()
    expect(() => assertGraphSemantics(repository.getSnapshot())).not.toThrow()
    repository.syncSession('A', [turn(1, '1', 247), turn(2, '2', 694), turn(3, '3', 900)])
    expect(() => assertGraphSemantics(transport.scopes.get('w')!)).not.toThrow()
    expect(Object.keys(transport.scopes.get('w')!.nodes)).toHaveLength(3)
  })
})
