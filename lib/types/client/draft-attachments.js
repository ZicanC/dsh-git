function uploadStore(value) {
    if (typeof value !== 'object' || value === null)
        return undefined;
    const candidate = value;
    return typeof candidate.getSnapshot === 'function' && typeof candidate.subscribe === 'function'
        ? candidate
        : undefined;
}
/**
 * Resolve the staging face of the Conversation service.
 * @param conversation - the `ctx.conversation` service.
 * @returns the staging face, or undefined when this Harness does not expose it.
 */
export function draftAttachmentStaging(conversation) {
    if (typeof conversation !== 'object' || conversation === null)
        return undefined;
    const service = conversation;
    const uploads = uploadStore(service.fileUploads);
    if (typeof service.rebindDraftFiles !== 'function' || uploads === undefined)
        return undefined;
    return {
        restage: (sessionId, ids, uploadImages) => {
            service.rebindDraftFiles(sessionId, ids, uploadImages);
        },
        whenReady: (ids, signal) => new Promise((resolve, reject) => {
            let stop;
            let settled = false;
            const settle = (finish) => {
                if (settled)
                    return;
                settled = true;
                stop?.();
                signal.removeEventListener('abort', onAbort);
                finish();
            };
            const onAbort = () => { settle(() => { reject(signal.reason); }); };
            const check = () => {
                if (settled)
                    return true;
                const snapshot = uploads.getSnapshot();
                for (const id of ids) {
                    const upload = snapshot[id];
                    if (upload === undefined || upload.status === 'ready')
                        continue;
                    if (upload.status === 'error') {
                        const message = typeof upload.message === 'string' ? upload.message : 'upload failed';
                        settle(() => { reject(new Error(message)); });
                        return true;
                    }
                    return false;
                }
                settle(resolve);
                return true;
            };
            if (signal.aborted) {
                reject(signal.reason);
                return;
            }
            signal.addEventListener('abort', onAbort, { once: true });
            if (check())
                return;
            stop = uploads.subscribe(() => { check(); });
            // An upload may have settled between the first read and the subscription.
            if (settled)
                stop();
            else
                check();
        }),
    };
}
//# sourceMappingURL=draft-attachments.js.map