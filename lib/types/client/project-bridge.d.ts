import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client';
import type { IWorkspaces } from '@deepseek-ai/dsh-api-workspace-controller/client';
import type { SessionId } from '@deepseek-ai/dsh-session';
import type { ProjectConnection } from '../connection-contract.ts';
import type { GraphRepository } from './repository.ts';
import type { LocaleSource } from './i18n.ts';
export interface ProjectBridgeServices {
    readonly connection: ProjectConnection;
    readonly sessions: ISessions;
    /** Show a Session in the main view; navigation belongs to the Workspace UI, not the Session list. */
    readonly openSession: (sessionId: SessionId) => void;
    readonly workspaces: IWorkspaces;
    readonly repositoryForWorkspace: (workspaceId: string) => GraphRepository;
    readonly repositoryForSession: (sessionId: string) => GraphRepository;
    readonly locale: LocaleSource;
}
/** Install the isolated compatibility layer and return its complete disposer. */
export declare function installProjectBridge(services: ProjectBridgeServices): () => void;
