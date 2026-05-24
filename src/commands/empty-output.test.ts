import { createTestProgram, describeEmptyMachineOutput } from '@doist/cli-core/testing'
import { vi } from 'vitest'
import { mockOutlineAuthModule } from '../_fixtures/testing.js'

vi.mock('../lib/auth.js', () => mockOutlineAuthModule())

vi.mock('../lib/api.js', () => ({
    apiRequest: vi.fn().mockResolvedValue({ data: [], pagination: undefined }),
}))

describeEmptyMachineOutput('ol document list', {
    setup: () => {},
    run: async (extraArgs) => {
        const { registerDocumentCommand } = await import('./document.js')
        const program = createTestProgram(registerDocumentCommand)
        await program.parseAsync(['node', 'ol', 'document', 'list', ...extraArgs])
    },
    humanMessage: 'No documents found.',
})
