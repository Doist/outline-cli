const PROXY_ENV_KEYS = [
    'HTTP_PROXY',
    'http_proxy',
    'HTTPS_PROXY',
    'https_proxy',
    'NO_PROXY',
    'no_proxy',
] as const

/** Snapshot of the ambient proxy env, captured once at module load. */
const originalProxyEnv = new Map(PROXY_ENV_KEYS.map((key) => [key, process.env[key]]))

/** Unset every proxy env var so transport-selection tests start from a clean slate. */
export function clearProxyEnv(): void {
    for (const key of PROXY_ENV_KEYS) {
        delete process.env[key]
    }
}

/** Restore the proxy env to the snapshot taken at module load. */
export function restoreProxyEnv(): void {
    for (const key of PROXY_ENV_KEYS) {
        const value = originalProxyEnv.get(key)
        if (value === undefined) {
            delete process.env[key]
            continue
        }

        process.env[key] = value
    }
}
