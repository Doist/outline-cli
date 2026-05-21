import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
    beforeEach(() => {
        delete process.env.OL_SPINNER
        delete process.env.CI
        process.argv = ['node', 'ol']
    })

    afterEach(() => {
        delete process.env.OL_SPINNER
        delete process.env.CI
        process.argv = ['node', 'ol']
    })

    async function loadIsDisabled(): Promise<() => boolean> {
        vi.resetModules()
        createSpinnerMock.mockClear()
        await import('./spinner.js')
        expect(createSpinnerMock).toHaveBeenCalledWith(
            expect.objectContaining({ isDisabled: expect.any(Function) }),
        )
        return createSpinnerMock.mock.calls[0]![0]!.isDisabled!
    }

    it('does not disable by default', async () => {
        expect((await loadIsDisabled())()).toBe(false)
    })

    it('disables when OL_SPINNER=false', async () => {
        process.env.OL_SPINNER = 'false'
        expect((await loadIsDisabled())()).toBe(true)
    })

    it('disables when CI=1', async () => {
        process.env.CI = '1'
        expect((await loadIsDisabled())()).toBe(true)
    })

    it('honours CI=false as an opt-out (does not disable)', async () => {
        process.env.CI = 'false'
        expect((await loadIsDisabled())()).toBe(false)
    })

    it('disables when --json is in argv', async () => {
        process.argv = ['node', 'ol', 'search', 'foo', '--json']
        expect((await loadIsDisabled())()).toBe(true)
    })

    it('disables when --ndjson is in argv', async () => {
        process.argv = ['node', 'ol', 'search', 'foo', '--ndjson']
        expect((await loadIsDisabled())()).toBe(true)
    })

    it('disables when --no-spinner is in argv', async () => {
        process.argv = ['node', 'ol', 'auth', 'status', '--no-spinner']
        expect((await loadIsDisabled())()).toBe(true)
    })

    it('disables when --progress-jsonl is in argv', async () => {
        process.argv = ['node', 'ol', 'search', 'foo', '--progress-jsonl']
        expect((await loadIsDisabled())()).toBe(true)
    })

    it('disables when --progress-jsonl=path is in argv', async () => {
        process.argv = ['node', 'ol', 'search', 'foo', '--progress-jsonl=/tmp/p.jsonl']
        expect((await loadIsDisabled())()).toBe(true)
    })

    it('disables when --verbose is in argv', async () => {
        process.argv = ['node', 'ol', 'search', 'foo', '--verbose']
        expect((await loadIsDisabled())()).toBe(true)
    })

    it('disables when -v short flag is in argv', async () => {
        process.argv = ['node', 'ol', 'search', 'foo', '-v']
        expect((await loadIsDisabled())()).toBe(true)
    })
})
