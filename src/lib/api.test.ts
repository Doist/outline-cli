import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { errResponse, okResponse } from '../_fixtures/auth.js'

const authMocks = vi.hoisted(() => ({
    getApiToken: vi.fn(async () => 'test-token'),
    getRequestContext: vi.fn(async () => ({ baseUrl: 'https://test.outline.com' })),
    proactiveRefresh: vi.fn(async () => undefined),
    reactiveRefresh: vi.fn(async () => false),
}))

vi.mock('./auth.js', () => authMocks)

vi.mock('../transport/fetch-with-retry.js', () => ({
    fetchWithRetry: vi.fn(),
}))

describe('apiRequest', () => {
    beforeEach(() => {
        delete process.env.OUTLINE_API_TOKEN
        authMocks.getApiToken.mockReset().mockResolvedValue('test-token')
        authMocks.getRequestContext
            .mockReset()
            .mockResolvedValue({ baseUrl: 'https://test.outline.com' })
        authMocks.proactiveRefresh.mockReset().mockResolvedValue(undefined)
        authMocks.reactiveRefresh.mockReset().mockResolvedValue(false)
    })

    afterEach(() => {
        vi.clearAllMocks()
        vi.unstubAllEnvs()
    })

    it('uses fetchWithRetry for API requests', async () => {
        const { fetchWithRetry } = await import('../transport/fetch-with-retry.js')
        ;(fetchWithRetry as ReturnType<typeof vi.fn>).mockResolvedValue(
            okResponse({ data: { id: '123' } }),
        )

        const { apiRequest } = await import('./api.js')
        await apiRequest('documents.info', { id: 'abc' })

        expect(fetchWithRetry).toHaveBeenCalledWith({
            url: 'https://test.outline.com/api/documents.info',
            options: {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: 'Bearer test-token',
                },
                body: JSON.stringify({ id: 'abc' }),
            },
        })
    })

    it('returns data and pagination', async () => {
        const { fetchWithRetry } = await import('../transport/fetch-with-retry.js')
        ;(fetchWithRetry as ReturnType<typeof vi.fn>).mockResolvedValue(
            okResponse({ data: [{ id: '1' }], pagination: { offset: 0, limit: 25 } }),
        )

        const { apiRequest } = await import('./api.js')
        const result = await apiRequest('documents.list')

        expect(result.data).toEqual([{ id: '1' }])
        expect(result.pagination).toEqual({ offset: 0, limit: 25 })
    })

    it('throws on non-ok response with API message', async () => {
        const { fetchWithRetry } = await import('../transport/fetch-with-retry.js')
        ;(fetchWithRetry as ReturnType<typeof vi.fn>).mockResolvedValue(
            errResponse(500, 'Internal Server Error', {
                error: 'server_error',
                message: 'Server exploded',
            }),
        )

        const { apiRequest } = await import('./api.js')
        await expect(apiRequest('documents.list')).rejects.toThrow('Server exploded')
    })

    it('throws generic message when no API error body', async () => {
        const mockResponse = {
            ok: false,
            status: 500,
            statusText: 'Internal Server Error',
            json: async () => {
                throw new Error('not json')
            },
        }
        const { fetchWithRetry } = await import('../transport/fetch-with-retry.js')
        ;(fetchWithRetry as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse)

        const { apiRequest } = await import('./api.js')
        await expect(apiRequest('documents.list')).rejects.toThrow(
            'API error: 500 Internal Server Error',
        )
    })

    it('force-refreshes and retries once when a managed token gets a 401', async () => {
        const { fetchWithRetry } = await import('../transport/fetch-with-retry.js')
        const f = fetchWithRetry as ReturnType<typeof vi.fn>
        f.mockResolvedValueOnce(errResponse(401, 'Unauthorized'))
        f.mockResolvedValueOnce(okResponse({ data: { id: 'ok' } }))
        authMocks.reactiveRefresh.mockResolvedValueOnce(true)
        authMocks.getApiToken
            .mockResolvedValueOnce('stale-token')
            .mockResolvedValueOnce('rotated-token')

        const { apiRequest } = await import('./api.js')
        const result = await apiRequest('documents.info', { id: 'abc' })

        expect(result.data).toEqual({ id: 'ok' })
        expect(authMocks.reactiveRefresh).toHaveBeenCalledTimes(1)
        expect(f).toHaveBeenCalledTimes(2)
        const retryHeaders = f.mock.calls[1][0].options.headers as Record<string, string>
        expect(retryHeaders.Authorization).toBe('Bearer rotated-token')
    })

    it('proactively refreshes a managed token and uses the rotated token (no extra store read)', async () => {
        const { fetchWithRetry } = await import('../transport/fetch-with-retry.js')
        const f = fetchWithRetry as ReturnType<typeof vi.fn>
        f.mockResolvedValue(okResponse({ data: {} }))
        authMocks.proactiveRefresh.mockResolvedValueOnce('rotated-proactive')

        const { apiRequest } = await import('./api.js')
        await apiRequest('documents.list')

        expect(authMocks.proactiveRefresh).toHaveBeenCalledTimes(1)
        // The proactive token is reused — no fallback read of getApiToken.
        expect(authMocks.getApiToken).not.toHaveBeenCalled()
        const headers = f.mock.calls[0][0].options.headers as Record<string, string>
        expect(headers.Authorization).toBe('Bearer rotated-proactive')
    })

    it('does not refresh when OUTLINE_API_TOKEN is set (unmanaged token)', async () => {
        vi.stubEnv('OUTLINE_API_TOKEN', 'env-tok')
        const { fetchWithRetry } = await import('../transport/fetch-with-retry.js')
        ;(fetchWithRetry as ReturnType<typeof vi.fn>).mockResolvedValue(okResponse({ data: {} }))

        const { apiRequest } = await import('./api.js')
        await apiRequest('documents.list')

        expect(authMocks.proactiveRefresh).not.toHaveBeenCalled()
        expect(authMocks.reactiveRefresh).not.toHaveBeenCalled()
    })
})
