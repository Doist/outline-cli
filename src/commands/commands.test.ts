import { captureConsole, createTestProgram } from '@doist/cli-core/testing'
import { type MockInstance, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/auth.js', () => ({
    getApiToken: async () => 'test-token',
    getBaseUrl: async () => 'https://test.outline.com',
    getOAuthClientId: async () => undefined,
    getTokenSource: async () => 'config' as const,
    clearConfig: vi.fn(),
}))

vi.mock('../lib/api.js', () => ({
    apiRequest: vi.fn(),
}))

/** Read a `captureConsole` spy's recorded calls as joined lines. */
function lines(spy: MockInstance): string[] {
    return spy.mock.calls.map((args) => args.join(' '))
}

describe('search command', () => {
    let log: MockInstance

    beforeEach(() => {
        log = captureConsole()
    })

    afterEach(() => {
        vi.restoreAllMocks()
    })

    it('calls documents.search with query and options', async () => {
        const { apiRequest } = await import('../lib/api.js')
        ;(apiRequest as ReturnType<typeof vi.fn>).mockResolvedValue({
            data: [
                {
                    document: {
                        id: '1',
                        title: 'Test Doc',
                        urlId: 'test-doc-abc',
                        collectionId: 'c1',
                    },
                    context: 'Some <b>context</b> here',
                    ranking: 0.9,
                },
            ],
            pagination: { offset: 0, limit: 25 },
        })

        const { registerSearchCommand } = await import('./search.js')
        const program = createTestProgram(registerSearchCommand)

        await program.parseAsync(['node', 'ol', 'search', 'test query', '--limit', '10'])

        expect(apiRequest).toHaveBeenCalledWith('documents.search', {
            query: 'test query',
            limit: 10,
        })
    })

    it('outputs JSON when --json flag used', async () => {
        const { apiRequest } = await import('../lib/api.js')
        ;(apiRequest as ReturnType<typeof vi.fn>).mockResolvedValue({
            data: [
                {
                    document: {
                        id: '1',
                        title: 'Test',
                        urlId: 'test-abc',
                        collectionId: 'c1',
                    },
                    context: 'snippet',
                    ranking: 0.9,
                },
            ],
        })

        const { registerSearchCommand } = await import('./search.js')
        const program = createTestProgram(registerSearchCommand)

        await program.parseAsync(['node', 'ol', 'search', 'test', '--json'])

        const parsed = JSON.parse(lines(log)[0])
        expect(parsed[0].document.title).toBe('Test')
    })
})

describe('document commands', () => {
    let log: MockInstance

    beforeEach(() => {
        log = captureConsole()
    })

    afterEach(() => {
        vi.restoreAllMocks()
    })

    it('document get resolves URL ID', async () => {
        const { apiRequest } = await import('../lib/api.js')
        ;(apiRequest as ReturnType<typeof vi.fn>).mockResolvedValue({
            data: {
                id: 'full-id',
                title: 'My Doc',
                urlId: 'my-doc-abc123',
                text: 'Hello world',
                collectionId: 'c1',
                updatedAt: '2024-01-01T00:00:00Z',
            },
        })

        const { registerDocumentCommand } = await import('./document.js')
        const program = createTestProgram(registerDocumentCommand)

        await program.parseAsync(['node', 'ol', 'document', 'get', 'my-doc-abc123'])

        expect(apiRequest).toHaveBeenCalledWith('documents.info', { id: 'abc123' })
        expect(lines(log)[0]).toContain('My Doc')
        expect(lines(log)[0]).toContain('Hello world')
    })

    it('document list passes pagination options', async () => {
        const { apiRequest } = await import('../lib/api.js')
        ;(apiRequest as ReturnType<typeof vi.fn>).mockResolvedValue({
            data: [],
            pagination: { offset: 0, limit: 10 },
        })

        const { registerDocumentCommand } = await import('./document.js')
        const program = createTestProgram(registerDocumentCommand)

        await program.parseAsync([
            'node',
            'ol',
            'document',
            'list',
            '--limit',
            '10',
            '--offset',
            '5',
        ])

        expect(apiRequest).toHaveBeenCalledWith('documents.list', {
            limit: 10,
            offset: 5,
            sort: 'updatedAt',
            direction: 'DESC',
        })
    })

    it('document create with --parent infers collectionId from parent', async () => {
        const { apiRequest } = await import('../lib/api.js')
        const mockApiRequest = apiRequest as ReturnType<typeof vi.fn>
        mockApiRequest.mockImplementation((endpoint: string, body: Record<string, unknown>) => {
            if (endpoint === 'documents.info') {
                return Promise.resolve({
                    data: {
                        id: body.id,
                        title: 'Parent',
                        urlId: 'parent-abc',
                        url: '/doc/parent',
                        collectionId: 'inferred-col',
                    },
                })
            }
            if (endpoint === 'documents.create') {
                return Promise.resolve({
                    data: {
                        id: 'new-id',
                        title: 'Child',
                        urlId: 'child-xyz',
                        collectionId: 'inferred-col',
                        updatedAt: '2024-01-01T00:00:00Z',
                    },
                })
            }
            return Promise.reject(new Error(`Unexpected endpoint: ${endpoint}`))
        })

        const { registerDocumentCommand } = await import('./document.js')
        const program = createTestProgram(registerDocumentCommand)

        await program.parseAsync([
            'node',
            'ol',
            'document',
            'create',
            '--title',
            'Child',
            '--parent',
            'parentA1',
        ])

        expect(mockApiRequest).toHaveBeenCalledWith('documents.create', {
            title: 'Child',
            collectionId: 'inferred-col',
            parentDocumentId: 'parentA1',
        })
    })

    it('document create with both --collection and --parent errors', async () => {
        const mockExit = vi.spyOn(process, 'exit').mockImplementation((code) => {
            throw new Error(`process.exit(${code})`)
        })
        const errorSpy = captureConsole('error')

        const { registerDocumentCommand } = await import('./document.js')
        const program = createTestProgram(registerDocumentCommand)

        await expect(
            program.parseAsync([
                'node',
                'ol',
                'document',
                'create',
                '--title',
                'Test',
                '--collection',
                'colABC1',
                '--parent',
                'parentA1',
            ]),
        ).rejects.toThrow('process.exit(1)')

        expect(lines(errorSpy).join(' ')).toContain('mutually exclusive')
        mockExit.mockRestore()
    })

    it('document move with --parent infers collectionId from parent', async () => {
        const { apiRequest } = await import('../lib/api.js')
        const mockApiRequest = apiRequest as ReturnType<typeof vi.fn>
        mockApiRequest.mockImplementation((endpoint: string, body: Record<string, unknown>) => {
            if (endpoint === 'documents.info') {
                return Promise.resolve({
                    data: {
                        id: body.id,
                        title: 'Doc',
                        urlId: 'doc-abc',
                        url: '/doc',
                        collectionId: 'parent-col',
                    },
                })
            }
            if (endpoint === 'documents.move') {
                return Promise.resolve({ data: {} })
            }
            return Promise.reject(new Error(`Unexpected endpoint: ${endpoint}`))
        })

        const { registerDocumentCommand } = await import('./document.js')
        const program = createTestProgram(registerDocumentCommand)

        await program.parseAsync([
            'node',
            'ol',
            'document',
            'move',
            'docABC1',
            '--parent',
            'parentA1',
        ])

        expect(mockApiRequest).toHaveBeenCalledWith('documents.move', {
            id: 'docABC1',
            collectionId: 'parent-col',
            parentDocumentId: 'parentA1',
        })
    })

    it('document move with both --collection and --parent errors', async () => {
        const mockExit = vi.spyOn(process, 'exit').mockImplementation((code) => {
            throw new Error(`process.exit(${code})`)
        })
        const errorSpy = captureConsole('error')

        const { registerDocumentCommand } = await import('./document.js')
        const program = createTestProgram(registerDocumentCommand)

        await expect(
            program.parseAsync([
                'node',
                'ol',
                'document',
                'move',
                'docABC1',
                '--collection',
                'colABC1',
                '--parent',
                'parentA1',
            ]),
        ).rejects.toThrow('process.exit(1)')

        expect(lines(errorSpy).join(' ')).toContain('mutually exclusive')
        mockExit.mockRestore()
    })

    it('document move without --collection or --parent errors', async () => {
        const mockExit = vi.spyOn(process, 'exit').mockImplementation((code) => {
            throw new Error(`process.exit(${code})`)
        })
        const errorSpy = captureConsole('error')

        const { registerDocumentCommand } = await import('./document.js')
        const program = createTestProgram(registerDocumentCommand)

        await expect(
            program.parseAsync(['node', 'ol', 'document', 'move', 'docABC1']),
        ).rejects.toThrow('process.exit(1)')

        expect(lines(errorSpy).join(' ')).toContain('--collection')
        expect(lines(errorSpy).join(' ')).toContain('--parent')
        mockExit.mockRestore()
    })

    it('document move with --parent pointing to itself errors', async () => {
        const { apiRequest } = await import('../lib/api.js')
        const mockApiRequest = apiRequest as ReturnType<typeof vi.fn>
        mockApiRequest.mockImplementation((endpoint: string) => {
            if (endpoint === 'documents.info') {
                return Promise.resolve({
                    data: {
                        id: 'sameDoc1',
                        title: 'Doc',
                        urlId: 'doc-abc',
                        url: '/doc',
                        collectionId: 'col-1',
                    },
                })
            }
            return Promise.reject(new Error(`Unexpected endpoint: ${endpoint}`))
        })

        const mockExit = vi.spyOn(process, 'exit').mockImplementation((code) => {
            throw new Error(`process.exit(${code})`)
        })
        const errorSpy = captureConsole('error')

        const { registerDocumentCommand } = await import('./document.js')
        const program = createTestProgram(registerDocumentCommand)

        await expect(
            program.parseAsync([
                'node',
                'ol',
                'document',
                'move',
                'sameDoc1',
                '--parent',
                'sameDoc1',
            ]),
        ).rejects.toThrow('process.exit(1)')

        expect(lines(errorSpy).join(' ')).toContain('cannot be its own parent')
        mockExit.mockRestore()
    })
})

describe('collection commands', () => {
    beforeEach(() => {
        captureConsole()
    })

    afterEach(() => {
        vi.restoreAllMocks()
    })

    it('collection list calls API correctly', async () => {
        const { apiRequest } = await import('../lib/api.js')
        ;(apiRequest as ReturnType<typeof vi.fn>).mockResolvedValue({
            data: [{ id: 'c1', name: 'Engineering', documentCount: 42 }],
        })

        const { registerCollectionCommand } = await import('./collection.js')
        const program = createTestProgram(registerCollectionCommand)

        await program.parseAsync(['node', 'ol', 'collection', 'list'])

        expect(apiRequest).toHaveBeenCalledWith('collections.list', {
            limit: 25,
            offset: 0,
        })
    })
})
