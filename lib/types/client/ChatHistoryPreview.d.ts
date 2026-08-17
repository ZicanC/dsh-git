import type { HistoryPreviewImageAttachment, HistoryPreviewRecord, HistoryPreviewResponse } from '../protocol.ts';
import type { TurnNodeId } from './types.ts';
export interface LoadedPreviewImage {
    readonly url: string;
    readonly release: () => void;
}
/** One turn the official Chat is still producing, below the merged sections. */
export interface LivePreviewTurn {
    readonly key: string;
    readonly label: string;
    /** Session the streaming attachments resolve against. */
    readonly sourceSessionId: string;
    readonly records: readonly HistoryPreviewRecord[];
}
export interface ChatHistoryPreviewProps {
    readonly response: HistoryPreviewResponse | null;
    readonly orderedNodeIds: readonly TurnNodeId[];
    readonly labels: ReadonlyMap<TurnNodeId, string>;
    readonly candidateNodeId: TurnNodeId | null;
    /** PA currently stretched open in the adjacent conversation rail. */
    readonly activeNodeId?: TurnNodeId | null;
    /** Selected PAs whose records have not arrived from the Host yet. */
    readonly pendingNodeIds?: ReadonlySet<TurnNodeId>;
    /** Turns streaming in the source Session, not yet merged into the graph. */
    readonly liveTurns?: readonly LivePreviewTurn[];
    readonly loading: boolean;
    readonly error: string | null;
    readonly loadImage: (sourceSessionId: string, attachment: HistoryPreviewImageAttachment) => Promise<LoadedPreviewImage>;
}
/** Read-only, official-style projection of the exact turns a Merge will seed. */
export declare function ChatHistoryPreview({ response, orderedNodeIds, labels, candidateNodeId, activeNodeId, pendingNodeIds, liveTurns, loading, error, loadImage, }: ChatHistoryPreviewProps): import("react").JSX.Element;
