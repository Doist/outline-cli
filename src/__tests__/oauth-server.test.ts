import { describe, expect, it } from 'vitest'
import { startOAuthCallbackServer } from '../lib/oauth-server.js'

describe('oauth callback server', () => {
    it('returns success page and resolves authorization code', async () => {
        const callbackServer = await startOAuthCallbackServer({
            state: 'expected-state',
            timeoutMs: 10_000,
            port: 0,
        })

        const response = await fetch(
            `${callbackServer.redirectUri}?code=test-code&state=expected-state`,
        )
        const html = await response.text()

        expect(response.status).toBe(200)
        expect(html).toContain('Login complete')
        await expect(callbackServer.waitForCode).resolves.toBe('test-code')
    })

    it('returns error page and rejects on state mismatch', async () => {
        const callbackServer = await startOAuthCallbackServer({
            state: 'expected-state',
            timeoutMs: 10_000,
            port: 0,
        })
        const rejection = callbackServer.waitForCode.then(
            () => new Error('Expected OAuth state mismatch.'),
            (error) => error as Error,
        )

        const response = await fetch(
            `${callbackServer.redirectUri}?code=test-code&state=wrong-state`,
        )
        const html = await response.text()

        expect(response.status).toBe(400)
        expect(html).toContain('Authentication failed')
        const error = await rejection
        expect(error.message).toBe('OAuth state mismatch.')
    })

    it('returns error page and rejects when OAuth provider sends an error', async () => {
        const callbackServer = await startOAuthCallbackServer({
            state: 'expected-state',
            timeoutMs: 10_000,
            port: 0,
        })
        const rejection = callbackServer.waitForCode.then(
            () => new Error('Expected OAuth provider error.'),
            (error) => error as Error,
        )

        const response = await fetch(
            `${callbackServer.redirectUri}?error=access_denied&error_description=User%20denied`,
        )
        const html = await response.text()

        expect(response.status).toBe(400)
        expect(html).toContain('Authentication failed')
        const error = await rejection
        expect(error.message).toBe('OAuth authorization denied: User denied')
    })
})
