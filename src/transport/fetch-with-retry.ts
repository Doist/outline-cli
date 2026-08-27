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

export async function fetchWithRetry(args: FetchWithRetryArgs): Promise<Response> {
    const { url, options = {}, retryConfig = {} } = args
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
            const response = await fetchImpl(url, fetchOptions)
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
