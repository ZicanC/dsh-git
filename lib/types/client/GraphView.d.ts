import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client';
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots';
import type { GraphRepository } from './repository.ts';
import type { BranchId, ImportedTurn, TurnNodeId } from './types.ts';
/** Browser callbacks and observable supplied from the plugin apply closure. */
export interface GraphViewInjected {
    readonly hooks: {
        graph: GraphRepository;
    };
    readonly syncTurns: (turns: readonly ImportedTurn[]) => void;
    readonly toggleContext: (nodeId: TurnNodeId) => void;
    readonly moveContext: (nodeId: TurnNodeId, beforeId: TurnNodeId) => void;
    readonly moveContextToEnd: (nodeId: TurnNodeId) => void;
    readonly clearContext: () => void;
    readonly checkout: (nodeId: TurnNodeId) => void;
    readonly renameBranch: (branchId: BranchId, name: string) => void;
    readonly ask: (question: string, manifest: readonly TurnNodeId[]) => Promise<void>;
}
/** Complete graph view registered as one conversation tab. */
export declare function GraphView({ useSession, useGraph, syncTurns, toggleContext, moveContext, moveContextToEnd, clearContext, checkout, renameBranch, ask, }: ConvViewProps & InjectFace<GraphViewInjected>): import("react").JSX.Element;
