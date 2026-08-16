/**
 * Keep the official composer typable while a Context edit is unmerged, and
 * refuse only the send gesture — the draft belongs to the Merge, not to the
 * source Session.
 *
 * The Host has no submit veto: its one affordance (a composer block) turns the
 * whole textarea inert, which also takes away the drafting the Merge exists to
 * carry. So the guard works at the DOM edge of the composer card that this
 * plugin's own control renders inside, and it is best-effort by nature: it
 * refuses the two send gestures the shipped bar has (Enter in the textarea and
 * the primary button) and leaves everything else — typing, Shift+Enter, IME
 * composition, attachments, the model seat, Stop — alone.
 */
/** Report one refused send so the caller can explain it in its own surface. */
export type SendRefusedListener = () => void;
/**
 * Refuse sends from the composer card containing `anchor` until the returned
 * disposer runs.
 * @param anchor - an element this plugin renders inside the composer card.
 * @param onRefused - called for each refused send gesture.
 * @returns the disposer; a no-op when no composer card contains the anchor.
 */
export declare function installComposerSendGuard(anchor: Element, onRefused: SendRefusedListener): () => void;
