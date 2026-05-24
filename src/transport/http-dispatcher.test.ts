import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { gzipSync } from 'node:zlib'
import { Agent, EnvHttpProxyAgent } from 'undici'
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
        const { getDefaultDispatcher } = await import('./http-dispatcher.js')

        expect(getDefaultDispatcher()).toBeInstanceOf(Agent)
    })

    it('returns an EnvHttpProxyAgent when proxy env vars are set', async () => {
        process.env.HTTPS_PROXY = 'http://proxy.local:8080'
        const { getDefaultDispatcher } = await import('./http-dispatcher.js')

        expect(getDefaultDispatcher()).toBeInstanceOf(EnvHttpProxyAgent)
    })

    it('caches the dispatcher instance', async () => {
        const { getDefaultDispatcher } = await import('./http-dispatcher.js')

        expect(getDefaultDispatcher()).toBe(getDefaultDispatcher())
    })

    it('reset lets tests re-evaluate env-dependent transport selection', async () => {
        const { getDefaultDispatcher, resetDefaultDispatcherForTests } =
            await import('./http-dispatcher.js')
        const directDispatcher = getDefaultDispatcher()

        process.env.HTTPS_PROXY = 'http://proxy.local:8080'
        await resetDefaultDispatcherForTests()
        const proxiedDispatcher = getDefaultDispatcher()

        expect(directDispatcher).toBeInstanceOf(Agent)
        expect(proxiedDispatcher).toBeInstanceOf(EnvHttpProxyAgent)
        expect(proxiedDispatcher).not.toBe(directDispatcher)
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
            const { getDefaultDispatcher } = await import('./http-dispatcher.js')
            const dispatcher = getDefaultDispatcher()
            const response = await fetch(`http://127.0.0.1:${port}/`, {
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
                        // shape `getDefaultDispatcher()` must suppress.
                        process.emitWarning(
                            'mock decompress experimental warning',
                            'ExperimentalWarning',
                        )
                        return actual.interceptors.decompress()
                    },
                },
            }
        })

        const { getDefaultDispatcher } = await import('./http-dispatcher.js')
        const dispatcher = getDefaultDispatcher()
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
