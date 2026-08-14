import { describe, expect, it } from 'vitest'
import type { ConversationSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import { extractCompletedTurns } from '../src/client/extract.ts'

describe('extractCompletedTurns', () => {
  it('groups user and assistant text inside each closed turn boundary', () => {
    const closed = {
      turn: 1,
      status: 'closed',
      start: { seq: 10, time: 100 },
      end: { seq: 20, time: 200 },
      steps: [],
      data: { get: () => undefined },
    }
    const open = {
      turn: 2,
      status: 'open',
      start: { seq: 21, time: 210 },
      end: undefined,
      steps: [],
      data: { get: () => undefined },
    }
    const snapshot = {
      chat: { timeline: { turnOrder: [1, 2], turns: new Map([[1, closed], [2, open]]) } },
      nodes: [
        { kind: 'user', seq: 11, content: [{ type: 'text', text: 'question' }] },
        { kind: 'assistant', seq: 15, blocks: [{ kind: 'text', text: 'answer' }, { kind: 'reasoning', text: 'hidden' }] },
        { kind: 'user', seq: 22, content: [{ type: 'text', text: 'unfinished' }] },
      ],
    } as unknown as ConversationSnapshot

    expect(extractCompletedTurns(snapshot)).toEqual([{
      turn: 1,
      prompt: 'question',
      answer: 'answer',
      createdAt: 100,
      boundarySeq: 20,
    }])
  })
})
