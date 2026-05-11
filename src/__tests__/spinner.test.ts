import { describe, expect, it, vi } from 'vitest'

const createSpinnerMock = vi.fn(() => ({
    LoadingSpinner: class {
        start() {
            return this
        }
        succeed() {}
        fail() {}
        stop() {}
    },
    withSpinner: async <T>(_opts: unknown, fn: () => Promise<T>) => fn(),
    startEarlySpinner: vi.fn(),
    stopEarlySpinner: vi.fn(),
    resetEarlySpinner: vi.fn(),
}))

vi.mock('@doist/cli-core', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@doist/cli-core')>()
    return {
        ...actual,
        createSpinner: createSpinnerMock,
    }
})

describe('spinner wiring', () => {
    it('builds the kit with the OL-specific isDisabled gate', async () => {
        await import('../lib/spinner.js')
        expect(createSpinnerMock).toHaveBeenCalledTimes(1)
        const config = createSpinnerMock.mock.calls[0]?.[0] as { isDisabled?: () => boolean }
        expect(typeof config.isDisabled).toBe('function')
    })
})
