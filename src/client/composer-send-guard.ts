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
export type SendRefusedListener = () => void

/**
 * The composer's primary control is the card's last button. A running turn
 * renders Stop there (a rect glyph instead of the arrow), and cancelling a turn
 * must stay reachable, so that shape is deliberately not guarded.
 */
function sendButton(card: HTMLElement): Element | null {
  const buttons = card.querySelectorAll('button')
  const primary = buttons[buttons.length - 1]
  if (primary === undefined) return null
  return primary.querySelector('rect') === null ? primary : null
}

/** An open slash/@ menu owns Enter for its own selection; never take it. */
function menuOpen(card: HTMLElement): boolean {
  return card.querySelector('[role="listbox"],[role="menu"],[role="dialog"]') !== null
}

/**
 * Refuse sends from the composer card containing `anchor` until the returned
 * disposer runs.
 * @param anchor - an element this plugin renders inside the composer card.
 * @param onRefused - called for each refused send gesture.
 * @returns the disposer; a no-op when no composer card contains the anchor.
 */
export function installComposerSendGuard(
  anchor: Element, onRefused: SendRefusedListener,
): () => void {
  const card = anchor.closest<HTMLElement>('[data-composer-card]')
  if (card === null) return () => {}

  const refuse = (event: Event): void => {
    event.preventDefault()
    event.stopPropagation()
    onRefused()
  }
  const onKeyDown = (event: KeyboardEvent): void => {
    if (!(event.target instanceof HTMLTextAreaElement)) return
    if (event.key !== 'Enter' || event.shiftKey || event.repeat) return
    // Shift+Enter is a newline, a composing Enter picks an IME candidate, and
    // an open menu's Enter picks a row: none of the three is a send.
    if (event.isComposing || menuOpen(card)) return
    refuse(event)
  }
  const onPointer = (event: Event): void => {
    const target = event.target
    if (!(target instanceof Element)) return
    const button = target.closest('button')
    if (button === null || button !== sendButton(card)) return
    refuse(event)
  }

  card.addEventListener('keydown', onKeyDown, true)
  card.addEventListener('pointerdown', onPointer, true)
  card.addEventListener('click', onPointer, true)
  card.dataset['dshGitSendGuard'] = 'on'
  return () => {
    card.removeEventListener('keydown', onKeyDown, true)
    card.removeEventListener('pointerdown', onPointer, true)
    card.removeEventListener('click', onPointer, true)
    delete card.dataset['dshGitSendGuard']
  }
}
