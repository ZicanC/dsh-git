/** Minimal generic Connection surface consumed by both dsh-git bundle halves. */
import type { Context } from '@deepseek-ai/cordis'

export type ProjectRpcResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly error: { readonly message: string } }

export interface ProjectConnection {
  readonly rpc: {
    call(
      channel: string,
      endpoint: string,
      payload: unknown,
      signal?: AbortSignal,
    ): Promise<ProjectRpcResult>
    handle(
      channel: string,
      handler: (endpoint: string, payload: unknown, signal: AbortSignal) => Promise<ProjectRpcResult>,
      options: { readonly authority: 'trusted-host' | 'loopback' },
    ): () => Promise<void>
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Generic RPC transport supplied by the composed DSH Connection plugin. */
    connection: ProjectConnection
  }
}

// Keep the import live for declaration merging while emitting no runtime dependency.
export type ProjectConnectionContext = Context
