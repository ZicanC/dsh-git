import type { ISessions, IWorkspaces } from '@deepseek-ai/dsh-client-runtime/client';
import type { ProjectConnection } from '../connection-contract.ts';
import type { GraphRepository } from './repository.ts';
import type { LocaleSource } from './i18n.ts';
export interface ProjectBridgeServices {
    readonly connection: ProjectConnection;
    readonly sessions: ISessions;
    readonly workspaces: IWorkspaces;
    readonly repositoryForWorkspace: (workspaceId: string) => GraphRepository;
    readonly locale: LocaleSource;
}
/** Install the isolated compatibility layer and return its complete disposer. */
export declare function installProjectBridge(services: ProjectBridgeServices): () => void;
