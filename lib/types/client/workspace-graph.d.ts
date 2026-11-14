/** Reading one Workspace's graph from the Host, for the Branches view and the project page. */
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client';
import type { ProjectGraphResponse } from '../protocol.ts';
import type { HostRpc } from './host-rpc.ts';
import type { GraphRepository } from './repository.ts';
/** Display titles of every Session the browser lists, by Session id. */
export declare function sessionTitles(sessions: ISessions): Readonly<Record<string, string>>;
/**
 * Read a Workspace's Sessions and their completed turns from the Host.
 *
 * Anchor Sessions written before the merge lineage carried labels get them
 * back from the ledger of the Session each PA came from.
 * @param repositoryForSession - the ledger a Session belongs to.
 * @throws when the Host refuses, or answers for another Workspace.
 */
export declare function readWorkspaceGraph(rpc: HostRpc, repositoryForSession: (sessionId: string) => GraphRepository, workspaceId: string, signal: AbortSignal): Promise<ProjectGraphResponse>;
