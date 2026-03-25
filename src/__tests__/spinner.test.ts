import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LoadingSpinner, withSpinner } from '../lib/spinner.js'

const mockSpinnerInstance = {
    start: vi.fn().mockReturnThis(),
    success: vi.fn(),
    error: vi.fn(),
    stop: vi.fn(),
}

vi.mock('yocto-spinner', () => ({
    default: vi.fn(() => mockSpinnerInstance),
}))

vi.mock('chalk', () => ({
    default: {
        green: (text: string) => text,
        yellow: (text: string) => text,
        blue: (text: string) => text,
        red: (text: string) => text,
    },
}))

describe('withSpinner', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        delete process.env.OL_SPINNER
        delete process.env.CI
        Object.defineProperty(process.stdout, 'isTTY', {
            value: true,
            configurable: true,
        })
        process.argv = ['node', 'ol']
    })

    afterEach(() => {
        vi.clearAllMocks()
    })

    it('handles successful operations', async () => {
        const result = await withSpinner(
            { text: 'Testing...', color: 'blue' },
            async () => 'success',
        )

        expect(result).toBe('success')
        expect(mockSpinnerInstance.start).toHaveBeenCalled()
        expect(mockSpinnerInstance.stop).toHaveBeenCalled()
        expect(mockSpinnerInstance.error).not.toHaveBeenCalled()
    })

    it('handles failed operations', async () => {
        await expect(
            withSpinner({ text: 'Testing...', color: 'blue' }, async () => {
                throw new Error('test error')
            }),
        ).rejects.toThrow('test error')

        expect(mockSpinnerInstance.start).toHaveBeenCalled()
        expect(mockSpinnerInstance.error).toHaveBeenCalled()
        expect(mockSpinnerInstance.stop).not.toHaveBeenCalled()
    })

    it('skips spinner when noSpinner option is true', async () => {
        const result = await withSpinner(
            { text: 'Testing...', color: 'blue', noSpinner: true },
            async () => 'success',
        )

        expect(result).toBe('success')
        expect(mockSpinnerInstance.start).not.toHaveBeenCalled()
    })

    it('skips spinner when OL_SPINNER=false', async () => {
        process.env.OL_SPINNER = 'false'

        const result = await withSpinner(
            { text: 'Testing...', color: 'blue' },
            async () => 'success',
        )

        expect(result).toBe('success')
        expect(mockSpinnerInstance.start).not.toHaveBeenCalled()
    })

    it('skips spinner in CI environment', async () => {
        process.env.CI = 'true'

        const result = await withSpinner(
            { text: 'Testing...', color: 'blue' },
            async () => 'success',
        )

        expect(result).toBe('success')
        expect(mockSpinnerInstance.start).not.toHaveBeenCalled()
    })

    it('skips spinner when not in TTY', async () => {
        Object.defineProperty(process.stdout, 'isTTY', {
            value: false,
            configurable: true,
        })

        const result = await withSpinner(
            { text: 'Testing...', color: 'blue' },
            async () => 'success',
        )

        expect(result).toBe('success')
        expect(mockSpinnerInstance.start).not.toHaveBeenCalled()
    })

    it('skips spinner with --json flag', async () => {
        process.argv = ['node', 'ol', 'search', '--json']

        const result = await withSpinner(
            { text: 'Testing...', color: 'blue' },
            async () => 'success',
        )

        expect(result).toBe('success')
        expect(mockSpinnerInstance.start).not.toHaveBeenCalled()
    })

    it('skips spinner with --ndjson flag', async () => {
        process.argv = ['node', 'ol', 'search', '--ndjson']

        const result = await withSpinner(
            { text: 'Testing...', color: 'blue' },
            async () => 'success',
        )

        expect(result).toBe('success')
        expect(mockSpinnerInstance.start).not.toHaveBeenCalled()
    })

    it('skips spinner with --no-spinner flag', async () => {
        process.argv = ['node', 'ol', 'auth', 'status', '--no-spinner']

        const result = await withSpinner(
            { text: 'Testing...', color: 'blue' },
            async () => 'success',
        )

        expect(result).toBe('success')
        expect(mockSpinnerInstance.start).not.toHaveBeenCalled()
    })
})

describe('LoadingSpinner', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        delete process.env.OL_SPINNER
        delete process.env.CI
        Object.defineProperty(process.stdout, 'isTTY', {
            value: true,
            configurable: true,
        })
        process.argv = ['node', 'ol']
    })

    it('starts and stops', () => {
        const spinner = new LoadingSpinner()
        spinner.start({ text: 'Testing...', color: 'blue' })
        expect(mockSpinnerInstance.start).toHaveBeenCalled()

        spinner.stop()
        expect(mockSpinnerInstance.stop).toHaveBeenCalled()
    })

    it('shows success message', () => {
        const spinner = new LoadingSpinner()
        spinner.start({ text: 'Testing...', color: 'blue' })
        spinner.succeed('Done')
        expect(mockSpinnerInstance.success).toHaveBeenCalledWith('✓ Done')
    })

    it('shows failure message', () => {
        const spinner = new LoadingSpinner()
        spinner.start({ text: 'Testing...', color: 'blue' })
        spinner.fail('Failed')
        expect(mockSpinnerInstance.error).toHaveBeenCalledWith('✗ Failed')
    })

    it('handles multiple stop calls gracefully', () => {
        const spinner = new LoadingSpinner()
        spinner.start({ text: 'Testing...', color: 'blue' })
        spinner.stop()
        spinner.stop()
        expect(mockSpinnerInstance.stop).toHaveBeenCalledTimes(1)
    })

    it('handles succeed/fail without starting', () => {
        const spinner = new LoadingSpinner()
        spinner.succeed('Test')
        spinner.fail('Test')
        expect(mockSpinnerInstance.success).not.toHaveBeenCalled()
        expect(mockSpinnerInstance.error).not.toHaveBeenCalled()
    })
})
