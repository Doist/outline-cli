import { createAccessibleGate, createGlobalArgsStore, createSpinnerGate } from '@doist/cli-core'

const store = createGlobalArgsStore()

export const getGlobalArgs = store.get
export const resetGlobalArgs = store.reset

export const isAccessible = createAccessibleGate({
    envVar: 'OL_ACCESSIBLE',
    getArgs: store.get,
})

export const shouldDisableSpinner = createSpinnerGate({
    envVar: 'OL_SPINNER',
    getArgs: store.get,
})

export function isJsonMode(): boolean {
    const args = store.get()
    return args.json || args.ndjson
}
