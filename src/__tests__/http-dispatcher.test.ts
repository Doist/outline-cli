import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { gzipSync } from 'node:zlib'
import { Agent, EnvHttpProxyAgent } from 'undici'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const PROXY_ENV_KEYS = [
    'HTTP_PROXY',
    'http_proxy',
    'HTTPS_PROXY',
    'https_proxy',
    'NO_PROXY',
    'no_proxy',
] as const

const originalProxyEnv = new Map(PROXY_ENV_KEYS.map((key) => [key, process.env[key]]))

function clearProxyEnv(): void {
    for (const key of PROXY_ENV_KEYS) {
        delete process.env[key]
    }
}

function restoreProxyEnv(): void {
    for (const key of PROXY_ENV_KEYS) {
        const value = originalProxyEnv.get(key)
        if (value === undefined) {
            delete process.env[key]
            continue
        }

        process.env[key] = value
    }
}

describe('http-dispatcher', () => {
    beforeEach(() => {
        clearProxyEnv()
        vi.spyOn(process, 'emitWarning').mockImplementation(() => {})
    })

    afterEach(async () => {
        const { resetDefaultDispatcherForTests } = await import('../transport/http-dispatcher.js')
        await resetDefaultDispatcherForTests()
        restoreProxyEnv()
        vi.restoreAllMocks()
        vi.resetModules()
    })

    it('returns a direct Agent when no proxy env vars are set', async () => {
        const { getDefaultDispatcher } = await import('../transport/http-dispatcher.js')

        expect(getDefaultDispatcher()).toBeInstanceOf(Agent)
    })

    it('returns an EnvHttpProxyAgent when proxy env vars are set', async () => {
        process.env.HTTPS_PROXY = 'http://proxy.local:8080'
        const { getDefaultDispatcher } = await import('../transport/http-dispatcher.js')

        expect(getDefaultDispatcher()).toBeInstanceOf(EnvHttpProxyAgent)
    })

    it('caches the dispatcher instance', async () => {
        const { getDefaultDispatcher } = await import('../transport/http-dispatcher.js')

        expect(getDefaultDispatcher()).toBe(getDefaultDispatcher())
    })

    it('reset lets tests re-evaluate env-dependent transport selection', async () => {
        const { getDefaultDispatcher, resetDefaultDispatcherForTests } =
            await import('../transport/http-dispatcher.js')
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
            const { getDefaultDispatcher } = await import('../transport/http-dispatcher.js')
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
        const { suppressExperimentalWarningsSync } = await import('../transport/http-dispatcher.js')

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
        const { suppressExperimentalWarningsSync } = await import('../transport/http-dispatcher.js')

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
        const { suppressExperimentalWarningsSync } = await import('../transport/http-dispatcher.js')

        const result = suppressExperimentalWarningsSync(() => 42)
        expect(result).toBe(42)
    })
})
