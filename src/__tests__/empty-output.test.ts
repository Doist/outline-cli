import { describeEmptyMachineOutput } from '@doist/cli-core/testing'
import { Command } from 'commander'
import { vi } from 'vitest'

vi.mock('../lib/auth.js', () => ({
    getApiToken: async () => 'test-token',
    getBaseUrl: async () => 'https://test.outline.com',
    getOAuthClientId: async () => undefined,
    getTokenSource: async () => 'config' as const,
    clearConfig: vi.fn(),
}))

vi.mock('../lib/api.js', () => ({
    apiRequest: vi.fn().mockResolvedValue({ data: [], pagination: undefined }),
}))

describeEmptyMachineOutput('ol document list', {
    setup: () => {},
    run: async (extraArgs) => {
        const { registerDocumentCommand } = await import('../commands/document.js')
        const program = new Command()
        program.exitOverride()
        registerDocumentCommand(program)
        await program.parseAsync(['node', 'ol', 'document', 'list', ...extraArgs])
    },
    humanMessage: 'No documents found.',
})
