import { captureConsole, createTestProgram } from '@todoist/cli-core/testing'
import { type MockInstance, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { lines, mockOutlineAuthModule } from '../_fixtures/testing.js'

vi.mock('../lib/auth.js', () => mockOutlineAuthModule())

vi.mock('../lib/api.js', () => ({
    apiRequest: vi.fn(),
}))

vi.mock('../lib/refs.js', () => ({
    resolveDocumentRef: vi.fn(async () => ({
        id: 'doc-1',
        title: 'Spec',
        url: '/doc/spec-abc123',
        urlId: 'abc123',
    })),
}))

vi.mock('../lib/attachments.js', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../lib/attachments.js')>()),
    uploadAttachment: vi.fn(),
    downloadAttachment: vi.fn(),
}))

const ID = '3e7bbd8c-907b-4b10-9160-9b820d5ce255'

const uploaded = {
    id: ID,
    name: 'plan.pdf',
    contentType: 'application/pdf',
    size: 2048,
    documentId: 'doc-1',
    url: `/api/files.get?key=uploads/${ID}/plan.pdf`,
}

async function mocks() {
    const { apiRequest } = await import('../lib/api.js')
    const attachments = await import('../lib/attachments.js')
    return {
        apiRequest: apiRequest as ReturnType<typeof vi.fn>,
        uploadAttachment: attachments.uploadAttachment as ReturnType<typeof vi.fn>,
        downloadAttachment: attachments.downloadAttachment as ReturnType<typeof vi.fn>,
    }
}

async function run(...args: string[]) {
    const { registerAttachmentCommand } = await import('./attachment.js')
    const program = createTestProgram(registerAttachmentCommand)
    await program.parseAsync(['node', 'ol', ...args])
}

describe('attachment commands', () => {
    let log: MockInstance

    beforeEach(() => {
        log = captureConsole()
    })

    afterEach(() => {
        vi.clearAllMocks()
        vi.restoreAllMocks()
    })

    it('upload passes the file and options and prints the markdown link', async () => {
        const { uploadAttachment, apiRequest } = await mocks()
        uploadAttachment.mockResolvedValue(uploaded)

        await run(
            'attachment',
            'upload',
            './plan.pdf',
            '--doc',
            'spec',
            '--name',
            'plan.pdf',
            '--content-type',
            'application/pdf',
        )

        expect(uploadAttachment).toHaveBeenCalledWith({
            filePath: './plan.pdf',
            documentId: 'doc-1',
            name: 'plan.pdf',
            contentType: 'application/pdf',
        })
        expect(apiRequest).not.toHaveBeenCalled()
        const out = lines(log).join('\n')
        expect(out).toContain('Uploaded: plan.pdf')
        expect(out).toContain(`[plan.pdf 2048](/api/attachments.redirect?id=${ID})`)
    })

    it('upload --append appends the link with the version-safe append flag', async () => {
        const { uploadAttachment, apiRequest } = await mocks()
        uploadAttachment.mockResolvedValue({ ...uploaded, contentType: 'image/png', name: 'a.png' })
        apiRequest.mockResolvedValue({ data: {} })

        await run('attach', 'upload', 'a.png', '--doc', 'spec', '--append')

        expect(apiRequest).toHaveBeenCalledWith('documents.update', {
            id: 'doc-1',
            text: `\n\n![a.png](/api/attachments.redirect?id=${ID})`,
            append: true,
        })
        expect(lines(log).join('\n')).toContain('Appended to: Spec')
    })

    it('upload --json prints the attachment with its redirect URL and markdown', async () => {
        const { uploadAttachment } = await mocks()
        uploadAttachment.mockResolvedValue(uploaded)

        await run('attachment', 'upload', 'plan.pdf', '--doc', 'spec', '--json')

        expect(JSON.parse(lines(log)[0])).toEqual({
            ...uploaded,
            url: `/api/attachments.redirect?id=${ID}`,
            markdown: `[plan.pdf 2048](/api/attachments.redirect?id=${ID})`,
        })
    })

    it('download passes output and force through', async () => {
        const { downloadAttachment } = await mocks()
        downloadAttachment.mockResolvedValue({ id: ID, name: 'a.pdf', path: 'out/a.pdf', size: 10 })

        await run('attachment', 'download', ID, '--output', 'out', '--force')

        expect(downloadAttachment).toHaveBeenCalledWith(ID, { output: 'out', force: true })
        expect(lines(log)[0]).toContain('Downloaded: out/a.pdf')
    })

    it('download --output - prints nothing besides the file content', async () => {
        const { downloadAttachment } = await mocks()
        downloadAttachment.mockResolvedValue({ id: ID, name: 'a.pdf', path: '-', size: 10 })

        await run('attachment', 'download', ID, '--output', '-')

        expect(downloadAttachment).toHaveBeenCalledWith(ID, { output: '-' })
        expect(log).not.toHaveBeenCalled()
    })

    it('list reads attachment links from the document text', async () => {
        const { apiRequest } = await mocks()
        apiRequest.mockResolvedValue({
            data: {
                id: 'doc-1',
                text: `See [plan.pdf 2048](/api/attachments.redirect?id=${ID})`,
            },
        })

        await run('attachment', 'list', '--doc', 'spec', '--json')

        expect(apiRequest).toHaveBeenCalledWith('documents.info', { id: 'doc-1' })
        expect(JSON.parse(lines(log)[0])).toEqual([
            {
                id: ID,
                name: 'plan.pdf',
                size: 2048,
                type: 'file',
                url: `/api/attachments.redirect?id=${ID}`,
            },
        ])
    })

    it('list says so when a document has no attachments', async () => {
        const { apiRequest } = await mocks()
        apiRequest.mockResolvedValue({ data: { id: 'doc-1', text: 'Plain text' } })

        await run('attachment', 'list', '--doc', 'spec')

        expect(lines(log).join('\n')).toContain('No attachments found.')
    })

    it('delete requires --confirm', async () => {
        const { apiRequest } = await mocks()
        await expect(run('attachment', 'delete', ID)).rejects.toThrow(
            'Delete operation requires confirmation.',
        )
        expect(apiRequest).not.toHaveBeenCalled()
    })

    it('delete accepts a link and deletes by ID', async () => {
        const { apiRequest } = await mocks()
        apiRequest.mockResolvedValue({ data: undefined })

        await run('attachment', 'delete', `/api/attachments.redirect?id=${ID}`, '--confirm')

        expect(apiRequest).toHaveBeenCalledWith('attachments.delete', { id: ID })
        expect(lines(log)[0]).toBe('Deleted.')
    })
})
