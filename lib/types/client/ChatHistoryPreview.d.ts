import type { HistoryPreviewImageAttachment, HistoryPreviewResponse } from '../protocol.ts';
import type { TurnNodeId } from './types.ts';
export interface LoadedPreviewImage {
    readonly url: string;
    readonly release: () => void;
}
export interface ChatHistoryPreviewProps {
    readonly response: HistoryPreviewResponse | null;
    readonly orderedNodeIds: readonly TurnNodeId[];
    readonly labels: ReadonlyMap<TurnNodeId, string>;
    readonly candidateNodeId: TurnNodeId | null;
    /** PA currently stretched open in the adjacent conversation rail. */
    readonly activeNodeId?: TurnNodeId | null;
    readonly loading: boolean;
    readonly error: string | null;
    readonly loadImage: (sourceSessionId: string, attachment: HistoryPreviewImageAttachment) => Promise<LoadedPreviewImage>;
}
/** Read-only, official-style projection of the exact turns a Merge will seed. */
export declare function ChatHistoryPreview({ response, orderedNodeIds, labels, candidateNodeId, activeNodeId, loading, error, loadImage, }: ChatHistoryPreviewProps): import("react").JSX.Element;
