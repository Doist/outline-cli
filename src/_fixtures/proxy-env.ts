const PROXY_ENV_KEYS = [
    'HTTP_PROXY',
    'http_proxy',
    'HTTPS_PROXY',
    'https_proxy',
    'NO_PROXY',
    'no_proxy',
] as const

type ProxyEnvSnapshot = Map<string, string | undefined>

/** Snapshot the current proxy env. Take this per suite so restore is order-independent. */
export function captureProxyEnv(): ProxyEnvSnapshot {
    return new Map(PROXY_ENV_KEYS.map((key) => [key, process.env[key]]))
}

/** Unset every proxy env var so transport-selection tests start from a clean slate. */
export function clearProxyEnv(): void {
    for (const key of PROXY_ENV_KEYS) {
        delete process.env[key]
    }
}

/** Restore the proxy env to a snapshot taken by {@link captureProxyEnv}. */
export function restoreProxyEnv(snapshot: ProxyEnvSnapshot): void {
    for (const key of PROXY_ENV_KEYS) {
        const value = snapshot.get(key)
        if (value === undefined) {
            delete process.env[key]
            continue
        }

        process.env[key] = value
    }
}
