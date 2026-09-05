import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import { localized, useLocale } from './i18n.ts'

/** Supply the localized chrome required by the Host Markdown renderer. */
export function PreviewMarkdown({ text }: { readonly text: string }) {
  const locale = useLocale()
  return <MarkdownText text={text} labels={{
    code: {
      copyLabel: localized('复制', 'Copy', locale),
      copiedLabel: localized('已复制', 'Copied', locale),
    },
    footnotes: localized('脚注', 'Footnotes', locale),
  }} />
}
