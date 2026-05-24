import { type MockInstance, vi } from 'vitest'

/**
 * A `captureConsole`/`captureStream` spy's recorded calls as one string per
 * call (space-joined args, matching how chalk's styled fragments arrive).
 */
export function lines(spy: MockInstance): string[] {
    return spy.mock.calls.map((args) => args.join(' '))
}

/** Same as {@link lines} but newline-joined into a single string. */
export function linesText(spy: MockInstance): string {
    return lines(spy).join('\n')
}

/**
 * Spy on `process.exit` so it throws `process.exit(<code>)` instead of killing
 * the test runner. Pair with `.rejects.toThrow('process.exit(1)')`.
 */
export function mockProcessExit(): MockInstance {
    return vi.spyOn(process, 'exit').mockImplementation((code) => {
        throw new Error(`process.exit(${code})`)
    })
}
