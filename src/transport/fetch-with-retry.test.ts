import type { Dispatcher } from 'undici'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { okResponse } from '../_fixtures/auth.js'
import { captureProxyEnv, clearProxyEnv, restoreProxyEnv } from '../_fixtures/proxy-env.js'

const originalProxyEnv = captureProxyEnv()

// Stand in for the real transport so these tests can drive both halves of the
// pairing: `fetch: undefined` routes through the global `fetch` (which every
// test below stubs), and setting `fetch` exercises the paired-fetch path.
// Dispatcher selection itself is covered in `http-dispatcher.test.ts`.
const transport = vi.hoisted(() => ({
    dispatcher: { id: 'test-dispatcher' } as unknown as Dispatcher,
    fetch: undefined as typeof fetch | undefined,
}))

vi.mock('./http-dispatcher.js', () => ({
    getDefaultTransport: () => ({ dispatcher: transport.dispatcher, fetch: transport.fetch }),
    resetDefaultDispatcherForTests: vi.fn(() => Promise.resolve()),
}))

/** A `fetch` impl that never resolves and rejects with the abort reason on signal. */
function abortableFetch(_url: RequestInfo | URL, options?: RequestInit): Promise<Response> {
    return new Promise<Response>((_resolve, reject) => {
        options?.signal?.addEventListener(
            'abort',
            () => {
                const reason = options.signal?.reason
                reject(
                    reason instanceof Error
                        ? reason
                        : new Error(String(reason ?? 'Request aborted')),
                )
            },
            { once: true },
        )
    })
}

describe('fetchWithRetry', () => {
    beforeEach(() => {
        clearProxyEnv()
        vi.spyOn(process, 'emitWarning').mockImplementation(() => {})
    })

    afterEach(() => {
        transport.fetch = undefined
        restoreProxyEnv(originalProxyEnv)
        vi.useRealTimers()
        vi.unstubAllGlobals()
        vi.restoreAllMocks()
        vi.resetModules()
    })

    it('uses the default dispatcher for requests', async () => {
        const fetchMock = vi.fn()
        fetchMock.mockResolvedValue(okResponse({ ok: true }))
        vi.stubGlobal('fetch', fetchMock)

        const { fetchWithRetry } = await import('./fetch-with-retry.js')
        const response = await fetchWithRetry({
            url: 'https://test.outline.com/api/documents.info',
            options: { method: 'POST' },
        })

        expect(fetchMock).toHaveBeenCalledTimes(1)
        expect(fetchMock).toHaveBeenCalledWith('https://test.outline.com/api/documents.info', {
            method: 'POST',
            dispatcher: transport.dispatcher,
        })
        expect(response.ok).toBe(true)
    })

    it('uses the fetch paired with the dispatcher in preference to the global one', async () => {
        // The dispatcher decompresses the body itself, so the request has to go
        // through the `fetch` from the same undici build. Reaching for the
        // global `fetch` instead makes it decode an already-decoded body and
        // the request fails with `terminated` on Node 26.
        const globalFetch = vi.fn().mockResolvedValue(okResponse({ ok: true }))
        vi.stubGlobal('fetch', globalFetch)
        const pairedFetch = vi.fn().mockResolvedValue(okResponse({ paired: true }))
        transport.fetch = pairedFetch as unknown as typeof fetch

        const { fetchWithRetry } = await import('./fetch-with-retry.js')
        await fetchWithRetry({
            url: 'https://test.outline.com/api/documents.info',
            options: { method: 'POST' },
        })

        expect(globalFetch).not.toHaveBeenCalled()
        expect(pairedFetch).toHaveBeenCalledWith('https://test.outline.com/api/documents.info', {
            method: 'POST',
            dispatcher: transport.dispatcher,
        })
    })

    it('retries network errors when configured', async () => {
        const fetchMock = vi.fn()
        fetchMock
            .mockRejectedValueOnce(new TypeError('Failed to fetch'))
            .mockRejectedValueOnce(new TypeError('Failed to fetch'))
            .mockResolvedValue(okResponse({ ok: true }))
        vi.stubGlobal('fetch', fetchMock)

        const { fetchWithRetry } = await import('./fetch-with-retry.js')
        const response = await fetchWithRetry({
            url: 'https://test.outline.com/api/documents.info',
            retryConfig: {
                retries: 2,
                retryDelay: () => 0,
            },
        })

        expect(fetchMock).toHaveBeenCalledTimes(3)
        expect(response.ok).toBe(true)
    })

    it('retries timeout errors when configured', async () => {
        vi.useFakeTimers()

        const fetchMock = vi.fn()
        fetchMock
            .mockImplementationOnce(abortableFetch)
            .mockResolvedValueOnce(okResponse({ ok: true }))
        vi.stubGlobal('fetch', fetchMock)

        const { fetchWithRetry } = await import('./fetch-with-retry.js')
        const requestPromise = fetchWithRetry({
            url: 'https://test.outline.com/api/documents.info',
            options: {
                method: 'GET',
                timeout: 20,
            },
            retryConfig: {
                retries: 1,
                retryDelay: () => 0,
            },
        })

        await vi.advanceTimersByTimeAsync(20)
        const response = await requestPromise

        expect(fetchMock).toHaveBeenCalledTimes(2)
        expect(response.ok).toBe(true)
    })

    it('aborts built-in fetch requests when the timeout is reached', async () => {
        vi.useFakeTimers()

        const fetchMock = vi.fn()
        fetchMock.mockImplementation(abortableFetch)
        vi.stubGlobal('fetch', fetchMock)

        const { fetchWithRetry } = await import('./fetch-with-retry.js')

        const requestPromise = fetchWithRetry({
            url: 'https://test.outline.com/api/documents.info',
            options: {
                method: 'GET',
                timeout: 20,
            },
            retryConfig: { retries: 0 },
        })
        const requestExpectation = expect(requestPromise).rejects.toThrow(
            'Request timeout after 20ms',
        )

        await vi.advanceTimersByTimeAsync(20)
        await requestExpectation

        expect(fetchMock).toHaveBeenCalledTimes(1)
        expect(fetchMock).toHaveBeenCalledWith(
            'https://test.outline.com/api/documents.info',
            expect.objectContaining({
                method: 'GET',
                dispatcher: transport.dispatcher,
                signal: expect.any(AbortSignal),
            }),
        )
    })
})
