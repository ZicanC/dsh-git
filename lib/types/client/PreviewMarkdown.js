import { jsx as _jsx } from "react/jsx-runtime";
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives';
import { localized, useLocale } from "./i18n.js";
/** Supply the localized chrome required by the Host Markdown renderer. */
export function PreviewMarkdown({ text }) {
    const locale = useLocale();
    return _jsx(MarkdownText, { text: text, labels: {
            code: {
                copyLabel: localized('复制', 'Copy', locale),
                copiedLabel: localized('已复制', 'Copied', locale),
            },
            footnotes: localized('脚注', 'Footnotes', locale),
        } });
}
//# sourceMappingURL=PreviewMarkdown.js.map