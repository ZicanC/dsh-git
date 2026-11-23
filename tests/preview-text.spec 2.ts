import { describe, expect, it } from 'vitest'
import {
  argumentSummary, firstBlockText, formattedArguments, oneLine, previewContextProvenance, sourceKind,
} from '../src/client/preview-text.ts'

describe('Chat History preview text', () => {
  it('summarises on the first non-empty line and truncates with an ellipsis', () => {
    expect(oneLine('  first line  \nsecond line')).toBe('first line')
    expect(oneLine('abcdefgh', 5)).toBe('abcd…')
    expect(oneLine('')).toBe('')
  })

  it('summarises tool arguments by their most telling field and survives malformed JSON', () => {
    expect(argumentSummary('{"command":"ls -la","path":"/tmp"}')).toBe('/tmp')
    expect(argumentSummary('{"description":"List files","command":"ls"}')).toBe('List files')
    expect(argumentSummary('{"limit":3}')).toBe('{"limit":3}')
    expect(argumentSummary('{not json')).toBe('{not json')
    expect(formattedArguments('{"a":1}')).toBe('{\n  "a": 1\n}')
    expect(formattedArguments('{not json')).toBe('{not json')
  })

  it('takes the first readable text of a message, looking inside tool results', () => {
    expect(firstBlockText([
      { type: 'text', text: '   ' },
      { type: 'tool-result', callId: 'c', content: [{ type: 'text', text: 'nested\nmore' }] },
    ] as never)).toBe('nested')
    expect(firstBlockText([])).toBe('')
  })

  it('labels injected context by its durable source', () => {
    expect(sourceKind({ kind: 'user' })).toBe('user')
    expect(sourceKind('user')).toBeNull()
    expect(previewContextProvenance({
      kind: 'session-reference', references: [{ label: 'Chat A' }, { label: 'Chat B' }, { label: 'Chat A' }],
    })).toEqual({ role: 'recall', label: 'Chat A, Chat B' })
    expect(previewContextProvenance({
      kind: 'agent-instructions', changes: [{ path: 'AGENTS.md' }],
    })).toEqual({ role: 'inject', label: 'AGENTS.md' })
    expect(previewContextProvenance({ kind: 'plugin', plugin: 'dsh-git' })).toEqual({ role: 'inject', label: 'dsh-git' })
    expect(previewContextProvenance({ kind: 'skill-invocation' })).toEqual({ role: 'inject', label: 'skill-invocation' })
    expect(previewContextProvenance(null)).toEqual({ role: 'inject', label: null })
  })
})
