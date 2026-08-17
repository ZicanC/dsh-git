import { describe, expect, it } from 'vitest'
import { projectLiveTurns, type LiveTurnSource } from '../src/client/live-turn.ts'
import type { HistoryPreviewRecord } from '../src/protocol.ts'

type Nodes = LiveTurnSource['nodes']

function turnLocation(turn: number, startSeq: number, endSeq?: number) {
  return {
    turn,
    start: { seq: startSeq, type: 'turn/start', data: { turn } },
    end: endSeq === undefined ? undefined : { seq: endSeq, type: 'turn/end', data: { turn } },
    status: endSeq === undefined ? 'open' : 'closed',
    steps: [],
    data: { get: () => undefined },
  }
}

function live(input: {
  readonly turns: readonly ReturnType<typeof turnLocation>[]
  readonly nodes?: Nodes
  readonly partial?: LiveTurnSource['partial']
  readonly runningCalls?: LiveTurnSource['runningCalls']
}): LiveTurnSource {
  return {
    nodes: input.nodes ?? [],
    chat: {
      timeline: {
        turnOrder: input.turns.map(location => location.turn),
        turns: new Map(input.turns.map(location => [location.turn, location])),
      },
    } as unknown as LiveTurnSource['chat'],
    partial: input.partial ?? null,
    runningCalls: input.runningCalls ?? [],
  }
}

function textOf(record: HistoryPreviewRecord | undefined): readonly string[] {
  if (record === undefined) return []
  const blocks = record.kind === 'assistant'
    ? record.blocks
    : record.kind === 'user' ? record.content : []
  return blocks.flatMap(block => block.type === 'text' || block.type === 'reasoning' ? [block.text] : [])
}

describe('live turn projection', () => {
  it('streams the open turn: prompt, reasoning, and the growing partial answer', () => {
    const source = live({
      turns: [turnLocation(3, 100)],
      nodes: [{
        kind: 'user', seq: 101, time: 1,
        content: [{ type: 'text', text: 'streaming question' }],
        source: { kind: 'user' },
      }] as unknown as Nodes,
      partial: {
        turn: 3,
        step: 1,
        blocks: [{ kind: 'reasoning', text: 'thinking' }, { kind: 'text', text: 'partial ans' }],
      },
    })

    const [view, ...rest] = projectLiveTurns(source, 2)

    expect(rest).toEqual([])
    expect(view?.turn).toBe(3)
    expect(textOf(view?.records[0])).toEqual(['streaming question'])
    expect(textOf(view?.records[1])).toEqual(['thinking', 'partial ans'])
  })

  it('keeps a running tool call visible and stops once its result node lands', () => {
    const running = projectLiveTurns(live({
      turns: [turnLocation(1, 0)],
      runningCalls: [{
        callId: 'call-1', name: 'Read', argsRaw: '{"path":"a.ts"}', turn: 1, step: 1,
        time: 5, callView: null, subCalls: [],
      }] as unknown as LiveTurnSource['runningCalls'],
    }), 0)
    expect(running[0]?.records).toEqual([expect.objectContaining({
      kind: 'tool-call', callId: 'call-1', name: 'Read', arguments: '{"path":"a.ts"}',
    })])

    const settled = projectLiveTurns(live({
      turns: [turnLocation(1, 0)],
      nodes: [{
        kind: 'tool-result', seq: 7, time: 6, callId: 'call-1',
        call: { name: 'Read', argsRaw: '{"path":"a.ts"}' }, callTime: 5,
        content: [{ type: 'text', text: 'file body' }], isError: false,
        callView: null, resultView: null, subCalls: [],
      }] as unknown as Nodes,
    }), 0)
    expect(settled[0]?.records.map(record => record.kind)).toEqual(['tool-call', 'tool-result'])
  })

  it('projects only open turns the graph does not own yet', () => {
    const source = live({
      turns: [turnLocation(1, 0, 9), turnLocation(2, 10, 19), turnLocation(3, 20)],
      nodes: [{
        kind: 'assistant', seq: 15, time: 2, turn: 2, step: 1,
        blocks: [{ kind: 'text', text: 'closed answer' }],
      }] as unknown as Nodes,
    })

    // Closed turns belong to the graph: projecting them would duplicate the
    // whole loaded window on the first render, before the view syncs it.
    expect(projectLiveTurns(source, 0).map(view => view.turn)).toEqual([3])
    expect(projectLiveTurns(source, 3)).toEqual([])
  })

  it('reports mid-turn failures and unknown node kinds without dropping them', () => {
    const [view] = projectLiveTurns(live({
      turns: [turnLocation(1, 0)],
      // The runtime publishes nodes in seq order; the projection preserves it.
      nodes: [
        { kind: 'compaction', seq: 12, time: 2, summary: 'x', summaryEventSeq: 11, shadowedItemCount: 2, shadowedTokenCount: 9 },
        { kind: 'turn-error', seq: 20, time: 3, turn: 1, step: 1, message: 'provider failed' },
      ] as unknown as Nodes,
    }), 0)

    expect(view?.records.map(record => record.kind)).toEqual(['event', 'turn-status'])
  })
})
