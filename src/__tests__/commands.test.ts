import { Command } from 'commander'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/auth.js', () => ({
    getApiToken: () => 'test-token',
    getBaseUrl: () => 'https://test.outline.com',
    getTokenSource: () => 'config' as const,
    saveConfig: vi.fn(),
    clearConfig: vi.fn(),
}))

vi.mock('../lib/api.js', () => ({
    apiRequest: vi.fn(),
}))

describe('search command', () => {
    let logs: string[]

    beforeEach(() => {
        logs = []
        vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
            logs.push(args.join(' '))
        })
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

        const { registerSearchCommand } = await import('../commands/search.js')
        const program = new Command()
        program.exitOverride()
        registerSearchCommand(program)

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

        const { registerSearchCommand } = await import('../commands/search.js')
        const program = new Command()
        program.exitOverride()
        registerSearchCommand(program)

        await program.parseAsync(['node', 'ol', 'search', 'test', '--json'])

        const parsed = JSON.parse(logs[0])
        expect(parsed[0].document.title).toBe('Test')
    })
})

describe('document commands', () => {
    let logs: string[]

    beforeEach(() => {
        logs = []
        vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
            logs.push(args.join(' '))
        })
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

        const { registerDocumentCommand } = await import('../commands/document.js')
        const program = new Command()
        program.exitOverride()
        registerDocumentCommand(program)

        await program.parseAsync(['node', 'ol', 'document', 'get', 'my-doc-abc123'])

        expect(apiRequest).toHaveBeenCalledWith('documents.info', { id: 'abc123' })
        expect(logs[0]).toContain('# My Doc')
    })

    it('document list passes pagination options', async () => {
        const { apiRequest } = await import('../lib/api.js')
        ;(apiRequest as ReturnType<typeof vi.fn>).mockResolvedValue({
            data: [],
            pagination: { offset: 0, limit: 10 },
        })

        const { registerDocumentCommand } = await import('../commands/document.js')
        const program = new Command()
        program.exitOverride()
        registerDocumentCommand(program)

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

    it('document create with --parent includes parentDocumentId', async () => {
        const { apiRequest } = await import('../lib/api.js')
        const mockApiRequest = apiRequest as ReturnType<typeof vi.fn>
        mockApiRequest.mockImplementation((endpoint: string, body: Record<string, unknown>) => {
            if (endpoint === 'collections.info') {
                return Promise.resolve({
                    data: { id: body.id, name: 'Test Collection' },
                })
            }
            if (endpoint === 'documents.info') {
                return Promise.resolve({
                    data: {
                        id: body.id,
                        title: 'Parent',
                        urlId: 'parent-abc',
                        url: '/doc/parent',
                    },
                })
            }
            if (endpoint === 'documents.create') {
                return Promise.resolve({
                    data: {
                        id: 'new-id',
                        title: 'Child',
                        urlId: 'child-xyz',
                        collectionId: 'colABC1',
                        updatedAt: '2024-01-01T00:00:00Z',
                    },
                })
            }
            return Promise.reject(new Error(`Unexpected endpoint: ${endpoint}`))
        })

        const { registerDocumentCommand } = await import('../commands/document.js')
        const program = new Command()
        program.exitOverride()
        registerDocumentCommand(program)

        await program.parseAsync([
            'node',
            'ol',
            'document',
            'create',
            '--title',
            'Child',
            '--collection',
            'colABC1',
            '--parent',
            'parentA1',
        ])

        expect(mockApiRequest).toHaveBeenCalledWith('documents.create', {
            title: 'Child',
            collectionId: 'colABC1',
            parentDocumentId: 'parentA1',
        })
    })

    it('document move with --parent only sends parentDocumentId without collectionId', async () => {
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
                    },
                })
            }
            if (endpoint === 'documents.move') {
                return Promise.resolve({ data: {} })
            }
            return Promise.reject(new Error(`Unexpected endpoint: ${endpoint}`))
        })

        const { registerDocumentCommand } = await import('../commands/document.js')
        const program = new Command()
        program.exitOverride()
        registerDocumentCommand(program)

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
            parentDocumentId: 'parentA1',
        })
    })

    it('document move with --collection and --parent sends both', async () => {
        const { apiRequest } = await import('../lib/api.js')
        const mockApiRequest = apiRequest as ReturnType<typeof vi.fn>
        mockApiRequest.mockImplementation((endpoint: string, body: Record<string, unknown>) => {
            if (endpoint === 'collections.info') {
                return Promise.resolve({
                    data: { id: body.id, name: 'Target' },
                })
            }
            if (endpoint === 'documents.info') {
                return Promise.resolve({
                    data: {
                        id: body.id,
                        title: 'Doc',
                        urlId: 'doc-abc',
                        url: '/doc',
                    },
                })
            }
            if (endpoint === 'documents.move') {
                return Promise.resolve({ data: {} })
            }
            return Promise.reject(new Error(`Unexpected endpoint: ${endpoint}`))
        })

        const { registerDocumentCommand } = await import('../commands/document.js')
        const program = new Command()
        program.exitOverride()
        registerDocumentCommand(program)

        await program.parseAsync([
            'node',
            'ol',
            'document',
            'move',
            'docABC1',
            '--collection',
            'colABC1',
            '--parent',
            'parentA1',
        ])

        expect(mockApiRequest).toHaveBeenCalledWith('documents.move', {
            id: 'docABC1',
            collectionId: 'colABC1',
            parentDocumentId: 'parentA1',
        })
    })

    it('document move without --collection or --parent errors', async () => {
        const mockExit = vi.spyOn(process, 'exit').mockImplementation((code) => {
            throw new Error(`process.exit(${code})`)
        })
        const errors: string[] = []
        vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
            errors.push(args.join(' '))
        })

        const { registerDocumentCommand } = await import('../commands/document.js')
        const program = new Command()
        program.exitOverride()
        registerDocumentCommand(program)

        await expect(
            program.parseAsync(['node', 'ol', 'document', 'move', 'docABC1']),
        ).rejects.toThrow('process.exit(1)')

        expect(errors.join(' ')).toContain('--collection')
        expect(errors.join(' ')).toContain('--parent')
        mockExit.mockRestore()
    })
})

describe('collection commands', () => {
    let logs: string[]

    beforeEach(() => {
        logs = []
        vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
            logs.push(args.join(' '))
        })
    })

    afterEach(() => {
        vi.restoreAllMocks()
    })

    it('collection list calls API correctly', async () => {
        const { apiRequest } = await import('../lib/api.js')
        ;(apiRequest as ReturnType<typeof vi.fn>).mockResolvedValue({
            data: [{ id: 'c1', name: 'Engineering', documentCount: 42 }],
        })

        const { registerCollectionCommand } = await import('../commands/collection.js')
        const program = new Command()
        program.exitOverride()
        registerCollectionCommand(program)

        await program.parseAsync(['node', 'ol', 'collection', 'list'])

        expect(apiRequest).toHaveBeenCalledWith('collections.list', {
            limit: 25,
            offset: 0,
        })
    })
})
