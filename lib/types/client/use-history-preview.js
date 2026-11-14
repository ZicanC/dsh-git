/** Records of the selected PAs for Chat History, read from the Host once each. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { MAX_MERGED_HISTORY_TURNS, } from "../protocol.js";
import { localized } from "./i18n.js";
import { HistoryPreviewCache, previewSourceKey } from "./preview-cache.js";
/**
 * Keep Chat History in step with the selection.
 *
 * A completed turn is immutable, so its records are cached for the lifetime
 * of the view. Only PAs this view has never read are requested, and a request
 * in flight is never cancelled by a later selection edit: its records stay
 * valid for whatever selection is current when they land. Removing a PA is
 * therefore pure local work, and re-adding one costs no Host round trip.
 *
 * The Host answers a batch as a whole, so one PA it cannot read fails the
 * batch. The PAs of a failed batch are then read one by one: those that can
 * be read appear, and the one that cannot is remembered as failed instead of
 * being asked for again. Taking it out of the selection forgets the failure.
 * @param entries - the selection in order; keep its identity stable between
 *   renders that do not change it.
 */
export function useHistoryPreview(entries, load, locale) {
    // Bumped whenever the cache or the failures change, to republish what is derived from them.
    const [revision, setRevision] = useState(0);
    const [loading, setLoading] = useState(false);
    const cacheRef = useRef(new HistoryPreviewCache());
    const failuresRef = useRef(new Map());
    const inFlightRef = useRef(new Set());
    const selectedRef = useRef(new Set());
    const abortRef = useRef(null);
    useEffect(() => () => { abortRef.current?.abort(); }, []);
    const key = entries.map(({ source }) => previewSourceKey(source)).join('|');
    const overLimit = entries.length > MAX_MERGED_HISTORY_TURNS;
    // The latest `load` without making its identity a reason to re-run the effect's requests.
    const loadRef = useRef(load);
    loadRef.current = load;
    useEffect(() => {
        const sources = entries.map(entry => entry.source);
        const selected = new Set(sources.map(previewSourceKey));
        selectedRef.current = selected;
        const failures = failuresRef.current;
        for (const failed of [...failures.keys()]) {
            if (!selected.has(failed))
                failures.delete(failed);
        }
        if (sources.length === 0 || overLimit) {
            setLoading(false);
            return;
        }
        const cache = cacheRef.current;
        const inFlight = inFlightRef.current;
        const request = (batch) => {
            abortRef.current ??= new AbortController();
            const signal = abortRef.current.signal;
            const keys = batch.map(previewSourceKey);
            for (const batchKey of keys)
                inFlight.add(batchKey);
            setLoading(true);
            let retry = [];
            void loadRef.current(batch, signal).then((response) => {
                if (signal.aborted)
                    return;
                cache.absorb(response);
                setRevision(current => current + 1);
            }).catch((cause) => {
                if (signal.aborted)
                    return;
                if (batch.length > 1) {
                    // One unreadable PA failed the whole batch; find out which.
                    retry = batch;
                    return;
                }
                failures.set(keys[0], cause instanceof Error ? cause.message : String(cause));
                setRevision(current => current + 1);
            }).finally(() => {
                for (const batchKey of keys)
                    inFlight.delete(batchKey);
                if (signal.aborted)
                    return;
                for (const source of retry) {
                    const sourceKey = previewSourceKey(source);
                    if (selectedRef.current.has(sourceKey) && !cache.has(source) && !inFlight.has(sourceKey))
                        request([source]);
                }
                setLoading(inFlight.size > 0);
            });
        };
        const missing = cache.missing(sources).filter((source) => {
            const sourceKey = previewSourceKey(source);
            return !inFlight.has(sourceKey) && !failures.has(sourceKey);
        });
        if (missing.length === 0)
            setLoading(inFlight.size > 0);
        else
            request(missing);
    }, [key, overLimit]);
    const response = useMemo(() => {
        if (entries.length === 0 || overLimit)
            return null;
        return cacheRef.current.assemble(entries.map(entry => entry.source));
    }, [entries, overLimit, revision]);
    const pendingNodeIds = useMemo(() => new Set(entries.flatMap(entry => cacheRef.current.has(entry.source) || failuresRef.current.has(previewSourceKey(entry.source))
        ? []
        : [entry.nodeId])), [entries, revision]);
    const error = useMemo(() => {
        if (overLimit) {
            return localized(`单次 Merge 最多支持 ${MAX_MERGED_HISTORY_TURNS} 个 PA；请移除部分 PA。`, `One Merge supports up to ${MAX_MERGED_HISTORY_TURNS} PAs. Remove some PAs to continue.`, locale);
        }
        for (const entry of entries) {
            const failure = failuresRef.current.get(previewSourceKey(entry.source));
            if (failure !== undefined)
                return failure;
        }
        return null;
    }, [entries, overLimit, revision, locale]);
    return { response, pendingNodeIds, loading, error };
}
//# sourceMappingURL=use-history-preview.js.map