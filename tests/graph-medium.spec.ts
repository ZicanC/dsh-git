/** Round-trip the ledger through the real JSON backend the web bundle routes to. */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { JsonStorageBackend } from '@deepseek-ai/dsh-storage-json'
import { descriptorOf } from '@deepseek-ai/dsh-storage-domain'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GRAPH_DOMAIN, graphStateSchema } from '../src/graph-domain.ts'
import { GraphRepository } from '../src/client/repository.ts'
import type { GraphState } from '../src/client/types.ts'

function ledger(): GraphState {
  const repository = new GraphRepository()
  repository.syncSession('source', [
    { turn: 1, prompt: 'q1', answer: 'a1', createdAt: 10, boundarySeq: 5 },
    { turn: 2, prompt: 'q2', answer: 'a2', createdAt: 20, boundarySeq: 9 },
  ])
  const refs = repository.getSnapshot().sessionTurnRefs.source!
  repository.prepareMergedSession({
    childSessionId: 'child',
    importedNodeIds: [refs[1]!, refs[2]!],
    parentIds: [refs[1]!, refs[2]!],
    primaryParentId: refs[2]!,
    contextManifest: [refs[2]!, refs[1]!],
  })
  repository.renameBranch(repository.getSnapshot().sessionBranches.source!, 'research-line')
  return repository.getSnapshot()
}

describe('graph ledger on the JSON medium', () => {
  let root: string
  beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'dsh-git-ledger-')) })
  afterEach(async () => { await rm(root, { recursive: true, force: true }) })

  it('survives a write, a close, and a reopen', async () => {
    const state = ledger()
    const descriptor = descriptorOf(GRAPH_DOMAIN)

    const writer = new JsonStorageBackend(root)
    const unit = await writer.kv.open(descriptor)
    // The medium takes opaque JSON, so store exactly what the RPC handler parses.
    await unit.putRecord('scopes', 'workspace:one', graphStateSchema.parse(state))
    await writer.close()

    const reader = new JsonStorageBackend(root)
    const reopened = await reader.kv.open(descriptor)
    const loaded = await reopened.loadAll()
    await reader.close()

    expect(Object.keys(loaded.tables.scopes!)).toEqual(['workspace:one'])
    expect(graphStateSchema.parse(loaded.tables.scopes!['workspace:one'])).toEqual(state)
  })

  it('serves an empty table for a scope that was never written', async () => {
    const backend = new JsonStorageBackend(root)
    const unit = await backend.kv.open(descriptorOf(GRAPH_DOMAIN))
    const loaded = await unit.loadAll()
    await backend.close()
    expect(loaded.tables.scopes?.['workspace:missing']).toBeUndefined()
  })
})
