import { describe, expect, it } from 'vitest'
import { renderError, renderSuccess } from '../lib/auth-pages.js'

describe('auth pages', () => {
    it('renderSuccess returns the branded post-login page', () => {
        const html = renderSuccess()
        expect(html).toContain('<title>Login complete - Outline CLI</title>')
        expect(html).toContain('Outline CLI is now authenticated.')
        expect(html).toContain('You can close this tab now.')
    })

    it('renderError surfaces the failure message and escapes hostile HTML', () => {
        const html = renderError('<script>alert(1)</script>')
        expect(html).toContain('<title>Authentication failed - Outline CLI</title>')
        expect(html).toContain('Outline CLI could not finish OAuth login.')
        expect(html).not.toContain('<script>alert(1)</script>')
        expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    })
})
