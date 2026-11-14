import { fetchWithRetry } from '../transport/fetch-with-retry.js'
import { TOKEN_ENV_VAR } from './auth-constants.js'
import { getApiToken, getRequestContext, proactiveRefresh, reactiveRefresh } from './auth.js'
import { type SpinnerOptions, withSpinner } from './spinner.js'

type RefreshHandshake = { baseUrl: string; clientId: string }

/**
 * Spinner configuration mapping API paths to spinner options.
 * Blue for read operations, green for creates, yellow for updates/deletes.
 */
const API_SPINNER_CONFIG: Record<string, SpinnerOptions> = {
    'auth.info': { text: 'Checking authentication...', color: 'blue' },
    'documents.search': { text: 'Searching documents...', color: 'blue' },
    'documents.list': { text: 'Loading documents...', color: 'blue' },
    'documents.info': { text: 'Loading document...', color: 'blue' },
    'documents.create': { text: 'Creating document...', color: 'green' },
    'documents.update': { text: 'Updating document...', color: 'yellow' },
    'documents.delete': { text: 'Deleting document...', color: 'yellow' },
    'documents.move': { text: 'Moving document...', color: 'yellow' },
    'documents.archive': { text: 'Archiving document...', color: 'yellow' },
    'documents.unarchive': { text: 'Unarchiving document...', color: 'yellow' },
    'collections.list': { text: 'Loading collections...', color: 'blue' },
    'collections.info': { text: 'Loading collection...', color: 'blue' },
    'collections.create': { text: 'Creating collection...', color: 'green' },
    'collections.update': { text: 'Updating collection...', color: 'yellow' },
    'collections.delete': { text: 'Deleting collection...', color: 'yellow' },
    'attachments.create': { text: 'Creating attachment...', color: 'green' },
    'attachments.delete': { text: 'Deleting attachment...', color: 'yellow' },
}

export interface Pagination {
    offset: number
    limit: number
    nextPath?: string
}

interface ApiResponse<T> {
    data: T
    pagination?: Pagination
    status?: number
    ok?: boolean
}

interface ApiError {
    error: string
    message: string
}

export interface PaginatedResult<T> {
    data: T
    pagination?: Pagination
}

export type ApiRequestOverrides = {
    token?: string
    baseUrl?: string
}

/**
 * Resolve the token for a request. A caller-supplied override is used as-is.
 * On the managed path, prefer the token `proactiveRefresh` resolved (rotated
 * or current) so unrefreshable/access-only accounts stay on a single store
 * read; only fall back to `getApiToken` when proactive refresh bows out.
 * `handshake` pins the refresh to the `--user` account's instance.
 */
async function resolveRequestToken(
    managed: boolean,
    override?: string,
    handshake?: RefreshHandshake,
): Promise<string> {
    if (override) return override
    if (managed) {
        const refreshed = await proactiveRefresh(handshake)
        if (refreshed) return refreshed
    }
    return getApiToken()
}

type AuthorizedTarget = {
    baseUrl: string
    token: string
    managed: boolean
    handshake?: RefreshHandshake
}

/**
 * Resolve the instance base URL and bearer token for a request, the same way
 * for JSON API calls and raw transfers (attachment uploads and downloads).
 */
async function resolveTarget(overrides: ApiRequestOverrides): Promise<AuthorizedTarget> {
    // Only stored credentials can be refreshed: a caller-supplied token
    // override or the `OUTLINE_API_TOKEN` env var is taken as-is.
    const managed = !overrides.token && !process.env[TOKEN_ENV_VAR]?.trim()

    // A caller-supplied base URL (login validate, auth status) skips account
    // resolution — those paths pass an explicit token, so no refresh runs.
    // Otherwise resolve the request's base URL and, for a `--user` account, the
    // refresh handshake that keeps rotation pinned to that account's instance.
    let resolvedBaseUrl: string
    let handshake: RefreshHandshake | undefined
    if (overrides.baseUrl) {
        resolvedBaseUrl = overrides.baseUrl.replace(/\/$/, '')
    } else {
        const ctx = await getRequestContext()
        resolvedBaseUrl = ctx.baseUrl
        handshake = ctx.handshake
    }

    const token = await resolveRequestToken(managed, overrides.token, handshake)
    return { baseUrl: resolvedBaseUrl, token, managed, handshake }
}

/**
 * Send a request with the target's token. Reactive path: a 401 on a managed
 * token triggers a forced rotation and a single retry. `reactiveRefresh`
 * throws `NoTokenError` when the refresh token is gone, so an unrecoverable
 * 401 surfaces the re-login hint.
 */
async function sendWithAuth(
    target: AuthorizedTarget,
    send: (token: string) => Promise<Response>,
): Promise<Response> {
    let res = await send(target.token)
    if (res.status === 401 && target.managed && (await reactiveRefresh(target.handshake))) {
        res = await send(await getApiToken())
    }
    return res
}

/**
 * Build the error thrown for a failed Outline API response, preferring the
 * message from Outline's JSON error body.
 */
export async function toApiError(res: Response): Promise<Error> {
    let message = `API error: ${res.status} ${res.statusText}`
    try {
        const err = (await res.json()) as ApiError
        if (err.message) message = `API error: ${err.message}`
    } catch {}
    return new Error(message)
}

/**
 * Core API request function without spinner wrapping.
 */
async function rawApiRequest<T>(
    path: string,
    body: object = {},
    overrides: ApiRequestOverrides = {},
): Promise<PaginatedResult<T>> {
    const target = await resolveTarget(overrides)

    const res = await sendWithAuth(target, (token) =>
        fetchWithRetry({
            url: `${target.baseUrl}/api/${path}`,
            options: {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify(body),
            },
        }),
    )

    if (!res.ok) throw await toApiError(res)

    const json = (await res.json()) as ApiResponse<T>
    return { data: json.data, pagination: json.pagination }
}

export type AuthorizedFetchInit = {
    method: string
    headers?: Record<string, string>
    body?: BodyInit
    redirect?: RequestRedirect
}

export type AuthorizedFetchResult = {
    response: Response
    /** Absolute URL the request went to. */
    url: string
    /** Whether that URL is on the Outline instance (and so carried the token). */
    onInstance: boolean
}

/**
 * Send a raw request with the account's bearer token, for transfers that are
 * not JSON API calls (multipart uploads, file downloads). `url` is either a
 * path on the Outline instance (`/api/...`, appended to the base URL the same
 * way `apiRequest` builds its URLs, so a sub-path install keeps its prefix) or
 * an absolute URL. The token is only attached when the URL is on the
 * instance's own origin, so it never reaches third-party storage such as S3.
 * The response is returned as-is: callers check `ok` and read the body.
 */
export async function authorizedFetch(
    url: string,
    init: AuthorizedFetchInit,
    overrides: ApiRequestOverrides = {},
): Promise<AuthorizedFetchResult> {
    const target = await resolveTarget(overrides)
    const instancePath = url.startsWith('/') && !url.startsWith('//')
    const resolved = new URL(instancePath ? `${target.baseUrl}${url}` : url)
    const onInstance = resolved.origin === new URL(target.baseUrl).origin

    const send = (token?: string) =>
        fetchWithRetry({
            url: resolved.toString(),
            options: {
                method: init.method,
                headers: {
                    ...init.headers,
                    ...(token ? { Authorization: `Bearer ${token}` } : {}),
                },
                ...(init.body === undefined ? {} : { body: init.body }),
                ...(init.redirect ? { redirect: init.redirect } : {}),
            },
        })

    const response = onInstance ? await sendWithAuth(target, send) : await send()
    return { response, url: resolved.toString(), onInstance }
}

/**
 * Public API request function that wraps rawApiRequest with automatic spinners.
 * Spinner messages are configured per API path in API_SPINNER_CONFIG.
 */
export async function apiRequest<T>(
    path: string,
    body: object = {},
    overrides: ApiRequestOverrides = {},
): Promise<PaginatedResult<T>> {
    const spinnerConfig = API_SPINNER_CONFIG[path] ?? {
        text: 'Loading...',
        color: 'blue' as const,
    }

    return withSpinner(spinnerConfig, () => rawApiRequest<T>(path, body, overrides))
}
