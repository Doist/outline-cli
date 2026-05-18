import { fetchWithRetry } from '../transport/fetch-with-retry.js'
import { TOKEN_ENV_VAR } from './auth-constants.js'
import { getApiToken, getApiTokenForceRefresh, getBaseUrl } from './auth.js'
import { type SpinnerOptions, withSpinner } from './spinner.js'

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
 * Core API request function without spinner wrapping. Implements the
 * reactive half of OAuth refresh: on a 401 with a stored token (i.e. not
 * the env-var path, and not a caller-supplied override), force a single
 * refresh + retry. A second 401 after the refresh propagates the error
 * untouched — at that point the user really has to re-authenticate.
 */
async function rawApiRequest<T>(
    path: string,
    body: object = {},
    overrides: ApiRequestOverrides = {},
): Promise<PaginatedResult<T>> {
    const [resolvedBaseUrl, resolvedToken] = await Promise.all([
        overrides.baseUrl ? Promise.resolve(overrides.baseUrl.replace(/\/$/, '')) : getBaseUrl(),
        overrides.token ? Promise.resolve(overrides.token) : getApiToken(),
    ])

    const res = await fetchWithRetry({
        url: `${resolvedBaseUrl}/api/${path}`,
        options: {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${resolvedToken}`,
            },
            body: JSON.stringify(body),
        },
    })

    if (res.status === 401 && !overrides.token && !process.env[TOKEN_ENV_VAR]?.trim()) {
        const refreshed = await getApiTokenForceRefresh(true).catch(() => null)
        if (refreshed && refreshed !== resolvedToken) {
            const retry = await fetchWithRetry({
                url: `${resolvedBaseUrl}/api/${path}`,
                options: {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${refreshed}`,
                    },
                    body: JSON.stringify(body),
                },
            })
            return finalizeResponse<T>(retry)
        }
    }

    return finalizeResponse<T>(res)
}

async function finalizeResponse<T>(res: Response): Promise<PaginatedResult<T>> {
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
