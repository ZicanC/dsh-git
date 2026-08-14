import { useSyncExternalStore } from 'react'

export type Locale = 'zh-CN' | 'en-US'

export interface LocaleSource {
  readonly getSnapshot: () => { readonly active: string; readonly revision: number }
  readonly subscribe: (listener: () => void) => () => void
}

let source: LocaleSource | undefined
const fallback = Object.freeze({ active: 'zh', revision: 0 })

/** Connect UI copy to DSH's single locale preference source. */
export function installLocaleSource(next: LocaleSource): () => void {
  source = next
  return () => { if (source === next) source = undefined }
}

function snapshot(): { readonly active: string; readonly revision: number } {
  return source?.getSnapshot() ?? fallback
}

function subscribe(listener: () => void): () => void {
  return source?.subscribe(listener) ?? (() => {})
}

export function getLocale(): Locale {
  return snapshot().active === 'en' ? 'en-US' : 'zh-CN'
}

export function useLocale(): Locale {
  const state = useSyncExternalStore(subscribe, snapshot, () => fallback)
  return state.active === 'en' ? 'en-US' : 'zh-CN'
}

export function localized(zh: string, en: string, value: Locale = getLocale()): string {
  return value === 'zh-CN' ? zh : en
}
