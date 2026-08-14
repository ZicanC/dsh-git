import type { GraphState, TurnNode, TurnNodeId } from './types.ts';
import type { ProjectGraphResponse } from '../protocol.ts';
/** Project-only metadata layered over the shared graph node renderer. */
export interface ProjectPANode extends TurnNode {
    readonly completedAt: number;
    readonly sessionCreatedAt: number;
    readonly sessionTitle: string;
    readonly firstInSession: boolean;
    readonly fingerprint: string;
}
/** Complete project graph plus the PA-completion timeline order. */
export interface ProjectGraphModel {
    readonly state: GraphState;
    readonly nodes: Readonly<Record<TurnNodeId, ProjectPANode>>;
    readonly timeline: readonly TurnNodeId[];
    readonly sessionCount: number;
}
/** Assemble and deduplicate the project history without mutating the persistent graph repository. */
export declare function assembleProjectGraph(response: ProjectGraphResponse, local: GraphState, titles?: Readonly<Record<string, string>>): ProjectGraphModel;
/** Return the graph prefix visible at one one-based PA timeline position. */
export declare function projectGraphAt(model: ProjectGraphModel, count: number): GraphState;
