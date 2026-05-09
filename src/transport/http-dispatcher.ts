import { Agent, type Dispatcher, EnvHttpProxyAgent, interceptors } from 'undici'

const KEEP_ALIVE_OPTIONS = {
    keepAliveTimeout: 1,
    keepAliveMaxTimeout: 1,
}

const PROXY_ENV_KEYS = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy'] as const

let defaultDispatcher: Dispatcher | undefined

function hasProxyEnv(): boolean {
    for (const key of PROXY_ENV_KEYS) {
        if (process.env[key]) {
            return true
        }
    }

    return false
}

function createDefaultDispatcher(): Dispatcher {
    const base = hasProxyEnv()
        ? new EnvHttpProxyAgent(KEEP_ALIVE_OPTIONS)
        : new Agent(KEEP_ALIVE_OPTIONS)

    // Compose the response-decompression interceptor so gzip/deflate/br/zstd
    // bodies are decoded before consumers parse them. Required on Node 24+:
    // attaching any custom dispatcher to the global `fetch` strips the
    // `content-encoding` header but does not actually decompress the body,
    // so callers receive raw gzipped bytes and `JSON.parse` fails.
    // See https://github.com/Doist/todoist-cli/issues/318.
    const decompress = suppressExperimentalWarningsSync(() => interceptors.decompress())

    return base.compose(decompress)
}

export function getDefaultDispatcher(): Dispatcher {
    defaultDispatcher ??= createDefaultDispatcher()
    return defaultDispatcher
}

export async function resetDefaultDispatcherForTests(): Promise<void> {
    if (!defaultDispatcher) {
        return
    }

    const dispatcher = defaultDispatcher
    defaultDispatcher = undefined
    await dispatcher.close()
}

// undici emits an `ExperimentalWarning` the first time `interceptors.decompress()`
// runs. The interceptor is stable for our gzipped-JSON-over-HTTPS use case;
// silence the warning during dispatcher init only so it does not leak to every
// CLI invocation's stderr on the first request.
//
// `fn` must be synchronous so the override covers a single critical section
// (microseconds) — no unrelated `ExperimentalWarning` from elsewhere can
// interleave and be lost. We suppress every `ExperimentalWarning` rather than
// pattern-matching the message text: the message wording is an undici
// implementation detail (not a stable API), and the suppression window is
// narrow enough that a coarse type filter is safe.
//
// Exported for direct unit testing — the integration path through
// `getDefaultDispatcher()` cannot reliably exercise the helper because both
// the dispatcher singleton and undici's internal `warningEmitted` flag are
// once-per-process.
export function suppressExperimentalWarningsSync<T>(fn: () => T): T {
    const originalEmit = process.emitWarning
    process.emitWarning = ((
        warning: string | Error,
        typeOrOptions?: string | { type?: string },
        ...rest: unknown[]
    ): void => {
        const type =
            typeof typeOrOptions === 'string'
                ? typeOrOptions
                : typeof typeOrOptions === 'object' && typeOrOptions !== null
                  ? typeOrOptions.type
                  : undefined
        if (type === 'ExperimentalWarning') return
        ;(originalEmit as (...args: unknown[]) => void).call(
            process,
            warning,
            typeOrOptions,
            ...rest,
        )
    }) as typeof process.emitWarning
    try {
        return fn()
    } finally {
        process.emitWarning = originalEmit
    }
}
