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

    // Some runtimes report `process.versions.node` but ship only a partial
    // undici: `interceptors.decompress` is absent and dispatchers have no
    // `.compose`. Bun is the common case. There the base agent alone is
    // enough — Bun's `fetch` decompresses gzip/deflate/br/zstd natively — so
    // skip the interceptor instead of crashing on the missing API. Optional
    // chaining also guards a runtime that omits the `interceptors` export.
    if (typeof interceptors?.decompress !== 'function') {
        return base
    }

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
// `SyncOnly<T>` rejects promise-returning callbacks at the type level so the
// helper can't be misused with `async`/promise-returning code (which would
// restore `process.emitWarning` before the awaited work runs and silently
// violate the suppression contract). A runtime guard catches any callable
// that slips past the type check.
//
// Exported for direct unit testing — the integration path through
// `getDefaultDispatcher()` cannot reliably exercise the helper a second time
// because both the dispatcher singleton and undici's internal `warningEmitted`
// flag are once-per-process.
type SyncOnly<T> = T extends PromiseLike<unknown> ? never : T

export function suppressExperimentalWarningsSync<T>(fn: () => SyncOnly<T>): SyncOnly<T> {
    const originalEmit = process.emitWarning
    type EmitArgs = Parameters<typeof process.emitWarning>

    const filteredEmit = ((...args: EmitArgs): void => {
        const typeOrOptions = args[1]
        const type =
            typeof typeOrOptions === 'string'
                ? typeOrOptions
                : typeof typeOrOptions === 'object' &&
                    typeOrOptions !== null &&
                    'type' in typeOrOptions
                  ? (typeOrOptions as { type?: string }).type
                  : undefined
        if (type === 'ExperimentalWarning') return
        Reflect.apply(originalEmit, process, args)
    }) as typeof process.emitWarning

    process.emitWarning = filteredEmit
    try {
        const result = fn()
        if (isThenable(result)) {
            throw new Error(
                'suppressExperimentalWarningsSync: callback returned a thenable; this helper only supports synchronous work.',
            )
        }
        return result
    } finally {
        process.emitWarning = originalEmit
    }
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
    return (
        typeof value === 'object' &&
        value !== null &&
        'then' in value &&
        typeof (value as { then: unknown }).then === 'function'
    )
}
