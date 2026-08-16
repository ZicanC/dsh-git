// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installComposerSendGuard } from '../src/client/composer-send-guard.ts'

interface Card {
  readonly card: HTMLElement
  readonly textarea: HTMLTextAreaElement
  readonly anchor: HTMLElement
  readonly primary: HTMLButtonElement
  readonly model: HTMLButtonElement
}

/** The shipped composer card's shape: tool row, model seat, primary last. */
function composer(options: { running?: boolean } = {}): Card {
  document.body.innerHTML = `
    <div data-composer-card>
      <textarea></textarea>
      <div>
        <button data-role="attach"></button>
        <span data-role="seat"></span>
        <button data-role="model"></button>
        <button data-role="primary">
          <svg>${options.running === true ? '<rect></rect>' : '<path></path>'}</svg>
        </button>
      </div>
    </div>`
  const card = document.querySelector<HTMLElement>('[data-composer-card]')!
  return {
    card,
    textarea: card.querySelector('textarea')!,
    anchor: card.querySelector<HTMLElement>('[data-role="seat"]')!,
    primary: card.querySelector<HTMLButtonElement>('[data-role="primary"]')!,
    model: card.querySelector<HTMLButtonElement>('[data-role="model"]')!,
  }
}

function enter(target: Element, init: KeyboardEventInit = {}): boolean {
  return target.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'Enter', bubbles: true, cancelable: true, ...init,
  }))
}

afterEach(() => { document.body.innerHTML = '' })

describe('installComposerSendGuard', () => {
  it('refuses the two send gestures and reports each one', () => {
    const { anchor, textarea, primary } = composer()
    const refused = vi.fn()
    const stop = installComposerSendGuard(anchor, refused)

    expect(enter(textarea)).toBe(false)
    expect(primary.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))).toBe(false)
    expect(refused).toHaveBeenCalledTimes(2)

    stop()
    expect(enter(textarea)).toBe(true)
    expect(primary.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))).toBe(true)
    expect(refused).toHaveBeenCalledTimes(2)
  })

  it('leaves typing, newlines, composition, menus, and other controls alone', () => {
    const { anchor, card, textarea, model } = composer()
    const refused = vi.fn()
    installComposerSendGuard(anchor, refused)

    expect(textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true }))).toBe(true)
    expect(enter(textarea, { shiftKey: true })).toBe(true)
    expect(enter(textarea, { isComposing: true })).toBe(true)
    expect(enter(textarea, { repeat: true })).toBe(true)
    expect(enter(model)).toBe(true)
    expect(model.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))).toBe(true)

    // An open slash/@ menu owns Enter for its own selection.
    const menu = document.createElement('div')
    menu.setAttribute('role', 'listbox')
    card.appendChild(menu)
    expect(enter(textarea)).toBe(true)
    expect(refused).not.toHaveBeenCalled()
  })

  it('never takes Stop away from a running turn', () => {
    const { anchor, primary } = composer({ running: true })
    const refused = vi.fn()
    installComposerSendGuard(anchor, refused)

    expect(primary.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))).toBe(true)
    expect(refused).not.toHaveBeenCalled()
  })

  it('is inert when no composer card contains the anchor', () => {
    const orphan = document.createElement('span')
    document.body.appendChild(orphan)
    const refused = vi.fn()

    expect(() => installComposerSendGuard(orphan, refused)()).not.toThrow()
    expect(refused).not.toHaveBeenCalled()
  })
})
