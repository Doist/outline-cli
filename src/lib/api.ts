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

/**
 * Core API request function without spinner wrapping.
 */
async function rawApiRequest<T>(
    path: string,
    body: object = {},
    overrides: ApiRequestOverrides = {},
): Promise<PaginatedResult<T>> {
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

    const resolvedToken = await resolveRequestToken(managed, overrides.token, handshake)

    const performRequest = (token: string) =>
        fetchWithRetry({
            url: `${resolvedBaseUrl}/api/${path}`,
            options: {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify(body),
            },
        })

    let res = await performRequest(resolvedToken)

    // Reactive path: a 401 on a managed token triggers a forced rotation and
    // a single retry. `reactiveRefresh` throws `NoTokenError` when the refresh
    // token is gone, so an unrecoverable 401 surfaces the re-login hint.
    if (res.status === 401 && managed && (await reactiveRefresh(handshake))) {
        res = await performRequest(await getApiToken())
    }

    if (!res.ok) {
        let message = `API error: ${res.status} ${res.statusText}`
        try {
            const err = (await res.json()) as ApiError
            if (err.message) message = `API error: ${err.message}`
        } catch {}
        throw new Error(message)
    }

    const json = (await res.json()) as ApiResponse<T>
    return { data: json.data, pagination: json.pagination }
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
