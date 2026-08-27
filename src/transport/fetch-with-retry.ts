import { getDefaultTransport } from './http-dispatcher.js'

interface RetryConfig {
    retries: number
    retryCondition: (error: Error) => boolean
    retryDelay: (retryNumber: number) => number
}

interface FetchOptions extends RequestInit {
    timeout?: number
}

interface FetchWithRetryArgs {
    url: RequestInfo | URL
    options?: FetchOptions
    retryConfig?: Partial<RetryConfig>
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
    retries: 0,
    retryCondition: isNetworkError,
    retryDelay: () => 0,
}

const TIMEOUT_ERROR_NAME = 'TimeoutError'

function createTimeoutError(timeoutMs: number): Error {
    const error = new Error(`Request timeout after ${timeoutMs}ms`)
    error.name = TIMEOUT_ERROR_NAME
    return error
}

function isNetworkError(error: Error): boolean {
    return error instanceof TypeError || error.name === TIMEOUT_ERROR_NAME
}

function wait(delayMs: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, delayMs))
}

function createTimeoutSignal(
    timeoutMs: number,
    existingSignal?: AbortSignal,
): {
    signal: AbortSignal
    clear: () => void
} {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => {
        controller.abort(createTimeoutError(timeoutMs))
    }, timeoutMs)
    let abortHandler: (() => void) | undefined

    function clear(): void {
        clearTimeout(timeoutId)
        if (existingSignal && abortHandler) {
            existingSignal.removeEventListener('abort', abortHandler)
        }
    }

    if (existingSignal) {
        if (existingSignal.aborted) {
            clearTimeout(timeoutId)
            controller.abort(existingSignal.reason)
        } else {
            abortHandler = () => {
                clearTimeout(timeoutId)
                controller.abort(existingSignal.reason)
            }
            existingSignal.addEventListener('abort', abortHandler, { once: true })
        }
    }

    controller.signal.addEventListener('abort', () => {
        clearTimeout(timeoutId)
    })

    return { signal: controller.signal, clear }
}

/**
 * Both `Request` classes in play here — the global one and undici's — reject
 * each other's instances: the check is a plain `instanceof`, and anything that
 * fails it gets stringified, so the request dies with `Failed to parse URL
 * from [object Request]`. Duck-typing catches either class.
 */
function isRequestLike(value: unknown): value is Request {
    return (
        typeof value === 'object' &&
        value !== null &&
        'url' in value &&
        'method' in value &&
        'headers' in value
    )
}

/**
 * Flatten a `Request` input into a plain URL and init, so neither `fetch`
 * implementation is ever handed a `Request` the other one owns.
 * `fetchWithRetry` is exposed as a `typeof fetch` (see `outlineFetch` in
 * `auth-provider.ts`), so a `Request` is a shape callers may legitimately pass.
 *
 * Reading the body to a buffer up front also keeps it replayable: a request
 * stream is consumed by the first attempt and would replay as an empty body.
 *
 * Explicit `options` win over the request's own fields, matching
 * `fetch(request, init)`.
 */
async function flattenRequestInput(
    url: RequestInfo | URL,
    options: FetchOptions,
): Promise<{ url: string | URL; options: FetchOptions }> {
    if (typeof url === 'string' || url instanceof URL || !isRequestLike(url)) {
        return { url: url as string | URL, options }
    }

    const body = url.body ? await url.arrayBuffer() : undefined

    return {
        url: url.url,
        options: {
            method: url.method,
            headers: [...url.headers],
            ...(body === undefined ? {} : { body }),
            ...(url.signal ? { signal: url.signal } : {}),
            ...options,
        },
    }
}

export async function fetchWithRetry(args: FetchWithRetryArgs): Promise<Response> {
    const { url, options: rawOptions = {}, retryConfig = {} } = args
    const { url: requestUrl, options } = await flattenRequestInput(url, rawOptions)
    const config = { ...DEFAULT_RETRY_CONFIG, ...retryConfig }
    const { timeout, signal: userSignal, ...requestOptions } = options
    let lastError: Error | undefined

    for (let attempt = 0; attempt <= config.retries; attempt++) {
        let clearTimeoutFn: (() => void) | undefined

        try {
            let requestSignal = userSignal ?? undefined
            if (timeout && timeout > 0) {
                const timeoutResult = createTimeoutSignal(timeout, requestSignal)
                requestSignal = timeoutResult.signal
                clearTimeoutFn = timeoutResult.clear
            }

            const fetchOptions: RequestInit = {
                ...requestOptions,
                signal: requestSignal,
            }
            // Take the dispatcher and its `fetch` as one value: the dispatcher
            // decompresses the body itself, so a `fetch` from a different
            // undici build decodes it a second time and the request fails with
            // `terminated`. A `fetch` of `undefined` means the global one is
            // the right partner (see `DefaultTransport`).
            const transport = getDefaultTransport()
            // @ts-expect-error dispatcher is supported by Node.js fetch via Undici
            fetchOptions.dispatcher = transport.dispatcher

            // undici's `fetch` and the global `fetch` have the same call shape;
            // the cast only reconciles undici's own Request/Response types with
            // the global lib types.
            const fetchImpl = (transport.fetch ?? fetch) as typeof fetch
            const response = await fetchImpl(requestUrl, fetchOptions)
            if (clearTimeoutFn) {
                clearTimeoutFn()
            }

            return response
        } catch (error) {
            if (clearTimeoutFn) {
                clearTimeoutFn()
            }

            lastError = error as Error
            const shouldRetry = attempt < config.retries && config.retryCondition(lastError)

            if (!shouldRetry) {
                throw lastError
            }

            const delay = config.retryDelay(attempt + 1)
            if (delay > 0) {
                await wait(delay)
            }
        }
    }

    throw lastError ?? new Error('Request failed after retries')
}
