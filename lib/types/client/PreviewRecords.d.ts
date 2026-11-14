/** Row components of the Chat History preview: one per kind of projected log record. */
import { type ReactNode } from 'react';
import type { HistoryPreviewImageAttachment, HistoryPreviewRecord } from '../protocol.ts';
import { type Locale } from './i18n.ts';
/** An image read from its source Session, with the handle that frees it. */
export interface LoadedPreviewImage {
    readonly url: string;
    readonly release: () => void;
}
/** Reads one attachment of a previewed turn from the Session that owns it. */
export type LoadPreviewImage = (sourceSessionId: string, attachment: HistoryPreviewImageAttachment) => Promise<LoadedPreviewImage>;
/** Thin divider between the parts of a one-line row. */
export declare function separator(): ReactNode;
/** Every record of one turn in log order, with each tool call paired to its result. */
export declare function TurnRecords({ records, sourceSessionId, loadImage, locale, }: {
    readonly records: readonly HistoryPreviewRecord[];
    readonly sourceSessionId: string;
    readonly loadImage: LoadPreviewImage;
    readonly locale: Locale;
}): import("react").JSX.Element;
