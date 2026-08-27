import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { gzipSync } from 'node:zlib'
import { Agent, EnvHttpProxyAgent, fetch as undiciFetch } from 'undici'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { captureProxyEnv, clearProxyEnv, restoreProxyEnv } from '../_fixtures/proxy-env.js'

const originalProxyEnv = captureProxyEnv()

describe('http-dispatcher', () => {
    beforeEach(() => {
        clearProxyEnv()
        vi.spyOn(process, 'emitWarning').mockImplementation(() => {})
    })

    afterEach(async () => {
        const { resetDefaultDispatcherForTests } = await import('./http-dispatcher.js')
        await resetDefaultDispatcherForTests()
        restoreProxyEnv(originalProxyEnv)
        vi.restoreAllMocks()
        vi.resetModules()
    })

    it('returns a direct Agent when no proxy env vars are set', async () => {
        const { getDefaultTransport } = await import('./http-dispatcher.js')

        expect(getDefaultTransport().dispatcher).toBeInstanceOf(Agent)
    })

    it('returns an EnvHttpProxyAgent when proxy env vars are set', async () => {
        process.env.HTTPS_PROXY = 'http://proxy.local:8080'
        const { getDefaultTransport } = await import('./http-dispatcher.js')

        expect(getDefaultTransport().dispatcher).toBeInstanceOf(EnvHttpProxyAgent)
    })

    it("pairs the dispatcher with undici's own fetch, not the global one", async () => {
        const { getDefaultTransport } = await import('./http-dispatcher.js')

        // The dispatcher decompresses the body and strips `content-encoding`
        // from the parsed headers only. Node's global `fetch` comes from a
        // different undici build that reads the raw headers, so it decodes the
        // body a second time and the request dies with `terminated`.
        expect(getDefaultTransport().fetch).toBe(undiciFetch)
        expect(getDefaultTransport().fetch).not.toBe(globalThis.fetch)
    })

    it('caches the transport instance', async () => {
        const { getDefaultTransport } = await import('./http-dispatcher.js')

        expect(getDefaultTransport()).toBe(getDefaultTransport())
    })

    it('reset lets tests re-evaluate env-dependent transport selection', async () => {
        const { getDefaultTransport, resetDefaultDispatcherForTests } =
            await import('./http-dispatcher.js')
        const directDispatcher = getDefaultTransport().dispatcher

        process.env.HTTPS_PROXY = 'http://proxy.local:8080'
        await resetDefaultDispatcherForTests()
        const proxiedDispatcher = getDefaultTransport().dispatcher

        expect(directDispatcher).toBeInstanceOf(Agent)
        expect(proxiedDispatcher).toBeInstanceOf(EnvHttpProxyAgent)
        expect(proxiedDispatcher).not.toBe(directDispatcher)
    })

    it('skips the decompress interceptor when the runtime undici lacks it (e.g. Bun)', async () => {
        // Bun reports `process.versions.node` but ships a partial undici whose
        // `interceptors.decompress` is absent. Building the dispatcher must not
        // throw there — the base agent alone is correct because Bun's `fetch`
        // decompresses natively.
        // Clear the module cache first so the fresh `http-dispatcher.js` import
        // below re-evaluates against the mocked `undici` instead of a copy that
        // earlier tests already bound to the real one.
        vi.resetModules()
        vi.doMock('undici', async () => {
            const actual = await vi.importActual<typeof import('undici')>('undici')
            return {
                ...actual,
                interceptors: {
                    ...actual.interceptors,
                    decompress: undefined,
                },
            }
        })

        try {
            const { getDefaultTransport } = await import('./http-dispatcher.js')
            const { dispatcher, fetch: pairedFetch } = getDefaultTransport()

            expect(dispatcher).toBeDefined()
            expect(typeof dispatcher.dispatch).toBe('function')
            // Nothing decompresses on our side here, so the global `fetch` —
            // which decompresses natively on such runtimes — is the correct
            // partner, signalled by `fetch: undefined`.
            expect(pairedFetch).toBeUndefined()
        } finally {
            // Leave `resetModules` to `afterEach`: it must reach this same
            // module instance to close the dispatcher created above before the
            // cache is cleared, otherwise the dispatcher leaks.
            vi.doUnmock('undici')
        }
    })

    it('decompresses gzip-encoded response bodies', async () => {
        const payload = { hello: 'world', nested: { value: 42 } }
        const compressed = gzipSync(Buffer.from(JSON.stringify(payload)))

        const httpServer: Server = await new Promise((resolve) => {
            const s = createServer((_req, res) => {
                res.writeHead(200, {
                    'content-type': 'application/json',
                    'content-encoding': 'gzip',
                    'content-length': String(compressed.length),
                })
                res.end(compressed)
            })
            s.listen(0, '127.0.0.1', () => resolve(s))
        })

        try {
            const { port } = httpServer.address() as AddressInfo
            const { getDefaultTransport } = await import('./http-dispatcher.js')
            const { dispatcher, fetch: pairedFetch } = getDefaultTransport()
            // Request through the paired `fetch`, which is what
            // `fetchWithRetry` does — the global `fetch` with this dispatcher
            // is the mismatched pairing production never uses.
            const fetchImpl = (pairedFetch ?? fetch) as typeof fetch
            const response = await fetchImpl(`http://127.0.0.1:${port}/`, {
                // @ts-expect-error - dispatcher is a valid Node fetch option not in TS lib types
                dispatcher,
            })
            const body = await response.text()

            expect(response.status).toBe(200)
            expect(body).toBe(JSON.stringify(payload))
            expect(JSON.parse(body)).toEqual(payload)
        } finally {
            await new Promise<void>((resolve) => httpServer.close(() => resolve()))
        }
    })
})

describe('suppressExperimentalWarningsSync', () => {
    it('swallows ExperimentalWarning emissions during the synchronous call', async () => {
        const { suppressExperimentalWarningsSync } = await import('./http-dispatcher.js')

        const calls: unknown[][] = []
        const originalEmit = process.emitWarning
        process.emitWarning = ((...args: unknown[]) => {
            calls.push(args)
        }) as typeof process.emitWarning

        try {
            suppressExperimentalWarningsSync(() => {
                process.emitWarning('experimental-string-form', 'ExperimentalWarning')
                process.emitWarning('experimental-options-form', {
                    type: 'ExperimentalWarning',
                })
                process.emitWarning('deprecation', 'DeprecationWarning')
            })
        } finally {
            process.emitWarning = originalEmit
        }

        expect(calls).toHaveLength(1)
        expect(calls[0]?.[0]).toBe('deprecation')
    })

    it('restores the original emitWarning even if the callback throws', async () => {
        const { suppressExperimentalWarningsSync } = await import('./http-dispatcher.js')

        const originalEmit = process.emitWarning
        const placeholder = (() => {}) as typeof process.emitWarning
        process.emitWarning = placeholder

        try {
            expect(() =>
                suppressExperimentalWarningsSync(() => {
                    throw new Error('boom')
                }),
            ).toThrow('boom')
            expect(process.emitWarning).toBe(placeholder)
        } finally {
            process.emitWarning = originalEmit
        }
    })

    it('returns the callback result', async () => {
        const { suppressExperimentalWarningsSync } = await import('./http-dispatcher.js')

        const result = suppressExperimentalWarningsSync(() => 42)
        expect(result).toBe(42)
    })

    it('throws if the callback returns a thenable (sync-only contract)', async () => {
        const { suppressExperimentalWarningsSync } = await import('./http-dispatcher.js')

        // Cast through `unknown` — the public type rejects async callbacks at
        // compile time; this exercises the runtime defence-in-depth.
        const asyncCallback = (() => Promise.resolve(1)) as unknown as () => SyncReturn

        expect(() => suppressExperimentalWarningsSync(asyncCallback)).toThrow(/thenable/)
    })
})

describe('http-dispatcher integration with decompress interceptor', () => {
    afterEach(async () => {
        const { resetDefaultDispatcherForTests } = await import('./http-dispatcher.js')
        await resetDefaultDispatcherForTests()
        vi.doUnmock('undici')
        vi.resetModules()
    })

    it('does not forward ExperimentalWarning emitted from interceptors.decompress during dispatcher creation', async () => {
        const emitSpy = vi.spyOn(process, 'emitWarning').mockImplementation(() => {})

        vi.doMock('undici', async () => {
            const actual = await vi.importActual<typeof import('undici')>('undici')
            return {
                ...actual,
                interceptors: {
                    ...actual.interceptors,
                    decompress: () => {
                        // Simulate undici's experimental warning being emitted
                        // synchronously at compose time — this is the exact
                        // shape `getDefaultTransport()` must suppress.
                        process.emitWarning(
                            'mock decompress experimental warning',
                            'ExperimentalWarning',
                        )
                        return actual.interceptors.decompress()
                    },
                },
            }
        })

        const { getDefaultTransport } = await import('./http-dispatcher.js')
        const { dispatcher } = getDefaultTransport()
        expect(dispatcher).toBeDefined()

        const experimentalCalls = emitSpy.mock.calls.filter(
            (args) => args[1] === 'ExperimentalWarning',
        )
        expect(experimentalCalls).toEqual([])
    })
})

// Helper type for the runtime-guard test above — `SyncOnly<Promise<...>>` is
// `never`, so the public signature already rejects async callbacks; the test
// reaches the runtime check via a deliberate `unknown` cast.
type SyncReturn = number
