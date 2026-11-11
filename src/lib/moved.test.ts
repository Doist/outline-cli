import { describe, expect, it, vi } from 'vitest'
import { MOVED_NOTICE, printMovedNotice } from './moved.js'

function fakeStream(isTTY: boolean) {
    return { isTTY, write: vi.fn() }
}

describe('printMovedNotice', () => {
    it('writes one line to an interactive stderr', () => {
        const stream = fakeStream(true)

        printMovedNotice(['document', 'list'], stream)

        expect(stream.write).toHaveBeenCalledTimes(1)
        const written = stream.write.mock.calls[0]![0] as string
        expect(written).toContain(MOVED_NOTICE)
        expect(written.endsWith('\n')).toBe(true)
        expect(MOVED_NOTICE).toBe(
            'ol has moved to @todoist/outline-cli. Run "ol update" to switch.',
        )
    })

    it('prints for bare `ol` and `ol --help`', () => {
        const stream = fakeStream(true)

        printMovedNotice([], stream)
        printMovedNotice(['--help'], stream)

        expect(stream.write).toHaveBeenCalledTimes(2)
    })

    it('stays silent when stderr is not a TTY', () => {
        const stream = fakeStream(false)

        printMovedNotice(['document', 'list', '--json'], stream)

        expect(stream.write).not.toHaveBeenCalled()
    })

    it('stays silent for `ol update`, which explains the move itself', () => {
        const stream = fakeStream(true)

        printMovedNotice(['update'], stream)
        printMovedNotice(['update', '--check'], stream)
        printMovedNotice(['--no-spinner', 'update'], stream)
        printMovedNotice(['--user', 'scott@example.com', 'update'], stream)

        expect(stream.write).not.toHaveBeenCalled()
    })
})
