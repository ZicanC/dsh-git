export type Locale = 'zh-CN' | 'en-US';
export interface LocaleSource {
    readonly getSnapshot: () => {
        readonly active: string;
        readonly revision: number;
    };
    readonly subscribe: (listener: () => void) => () => void;
}
/** Connect UI copy to DSH's single locale preference source. */
export declare function installLocaleSource(next: LocaleSource): () => void;
export declare function getLocale(): Locale;
export declare function useLocale(): Locale;
export declare function localized(zh: string, en: string, value?: Locale): string;
