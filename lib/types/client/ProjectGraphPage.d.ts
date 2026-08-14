import type { ProjectGraphResponse } from '../protocol.ts';
import type { GraphState } from './types.ts';
export interface ProjectGraphPageProps {
    readonly workspaceId: string;
    readonly workspaceTitle: string;
    readonly sessionTitles: Readonly<Record<string, string>>;
    readonly load: (signal: AbortSignal) => Promise<ProjectGraphResponse>;
    readonly getLocalState: () => GraphState;
    readonly onClose: () => void;
    readonly onOpenSession: (sessionId: string) => void;
}
/** Full takeover page mounted by the sidebar compatibility bridge. */
export declare function ProjectGraphPage({ workspaceId, workspaceTitle, sessionTitles, load, getLocalState, onClose, onOpenSession, }: ProjectGraphPageProps): import("react").JSX.Element;
