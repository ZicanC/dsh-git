import type { DraftAttachmentId } from '@deepseek-ai/dsh-client-ui-conversation/client';
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client';
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots';
import type { HistoryPreviewImageAttachment, HistoryPreviewResponse, HistoryTurnSource, ProjectGraphResponse } from '../protocol.ts';
import { type LoadedPreviewImage } from './ChatHistoryPreview.tsx';
import type { GraphRepository } from './repository.ts';
import type { GraphState, ImportedTurn, TurnNodeId } from './types.ts';
export interface ProjectGraphLoad {
    readonly response: ProjectGraphResponse;
    readonly sessionTitles: Readonly<Record<string, string>>;
}
export interface MergeDraftTransfer {
    readonly text: string;
    readonly draftRevision: number;
    readonly imageIds: readonly DraftAttachmentId[];
    readonly hasStructuredReferences: boolean;
}
/** Browser callbacks and observables supplied from the plugin apply closure. */
export interface GraphViewInjected {
    readonly hooks: {
        graph: GraphRepository;
    };
    readonly syncTurns: (turns: readonly ImportedTurn[]) => void;
    readonly adoptObservedGraph: (state: GraphState) => void;
    readonly loadProjectGraph: (signal: AbortSignal) => Promise<ProjectGraphLoad | null>;
    readonly loadHistoryPreview: (sources: readonly HistoryTurnSource[], signal: AbortSignal) => Promise<HistoryPreviewResponse>;
    readonly loadPreviewImage: (sourceSessionId: string, attachment: HistoryPreviewImageAttachment) => Promise<LoadedPreviewImage>;
    /** Returns whether the composer is free after the requested lease change. */
    readonly setComposerBlocked: (blocked: boolean) => boolean;
    readonly createMergedSession: (manifest: readonly TurnNodeId[], draft: MergeDraftTransfer, signal: AbortSignal) => Promise<void>;
}
/** Complete Branches workbench: graph selection, read-only history, and Merge. */
export declare function GraphView({ sessionId, useSession, useInput, inputActions, useGraph, syncTurns, adoptObservedGraph, loadProjectGraph, loadHistoryPreview, loadPreviewImage, setComposerBlocked, createMergedSession, }: ConvViewProps & InjectFace<GraphViewInjected>): import("react").JSX.Element;
