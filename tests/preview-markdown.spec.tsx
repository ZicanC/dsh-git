// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { PreviewMarkdown } from '../src/client/PreviewMarkdown.tsx'
import { installLocaleSource } from '../src/client/i18n.ts'

afterEach(cleanup)

it.each([['en', 'Copy'], ['zh', '复制']])('renders code controls in %s without crashing', (active, label) => {
  const snapshot = { active, revision: 1 }
  const uninstall = installLocaleSource({
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
  })
  try {
    const { container } = render(<PreviewMarkdown text={'```js\nconst answer = 42\n```'} />)
    expect(screen.getByRole('button', { name: label })).toBeTruthy()
    expect(container.querySelector('code')?.textContent).toBe('const answer = 42')
  } finally {
    uninstall()
  }
})
