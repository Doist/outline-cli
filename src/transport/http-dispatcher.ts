import { Agent, type Dispatcher, EnvHttpProxyAgent } from 'undici'

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
    if (hasProxyEnv()) {
        return new EnvHttpProxyAgent(KEEP_ALIVE_OPTIONS)
    }

    return new Agent(KEEP_ALIVE_OPTIONS)
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
