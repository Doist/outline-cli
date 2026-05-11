import { describe, expect, it } from 'vitest'
import { renderError, renderSuccess } from '../lib/auth-pages.js'

describe('renderSuccess', () => {
    it('returns a branded HTML page with the post-login title and message', () => {
        const html = renderSuccess()
        expect(html).toContain('<!doctype html>')
        expect(html).toContain('<title>Login complete - Outline CLI</title>')
        expect(html).toContain('Login complete')
        expect(html).toContain('Outline CLI is now authenticated.')
        expect(html).toContain('You can close this tab now.')
        expect(html).toContain('message success')
    })
})

describe('renderError', () => {
    it('returns a branded HTML page that includes the failure message', () => {
        const html = renderError('Authorization code expired')
        expect(html).toContain('<title>Authentication failed - Outline CLI</title>')
        expect(html).toContain('Authentication failed')
        expect(html).toContain('Outline CLI could not finish OAuth login.')
        expect(html).toContain('Authorization code expired')
        expect(html).toContain('message error')
    })

    it('html-escapes hostile characters in the failure message', () => {
        const html = renderError('<script>alert(1)</script>')
        expect(html).not.toContain('<script>alert(1)</script>')
        expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    })
})
