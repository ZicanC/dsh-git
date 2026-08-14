import { useSyncExternalStore } from 'react';
let source;
const fallback = Object.freeze({ active: 'zh', revision: 0 });
/** Connect UI copy to DSH's single locale preference source. */
export function installLocaleSource(next) {
    source = next;
    return () => { if (source === next)
        source = undefined; };
}
function snapshot() {
    return source?.getSnapshot() ?? fallback;
}
function subscribe(listener) {
    return source?.subscribe(listener) ?? (() => { });
}
export function getLocale() {
    return snapshot().active === 'en' ? 'en-US' : 'zh-CN';
}
export function useLocale() {
    const state = useSyncExternalStore(subscribe, snapshot, () => fallback);
    return state.active === 'en' ? 'en-US' : 'zh-CN';
}
export function localized(zh, en, value = getLocale()) {
    return value === 'zh-CN' ? zh : en;
}
//# sourceMappingURL=i18n.js.map