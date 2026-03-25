import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/auth.js', () => ({
    getApiToken: () => 'test-token',
    getBaseUrl: () => 'https://test.outline.com',
}))

const mockApiRequest = vi.fn()
vi.mock('../lib/api.js', () => ({
    apiRequest: (...args: unknown[]) => mockApiRequest(...args),
}))

describe('resolveDocumentRef', () => {
    beforeEach(() => {
        vi.resetModules()
        mockApiRequest.mockReset()
    })

    afterEach(() => {
        vi.restoreAllMocks()
    })

    it('resolves document by exact ID (UUID format)', async () => {
        const mockDoc = {
            id: '550e8400-e29b-41d4-a716-446655440000',
            title: 'Test Doc',
            urlId: 'test-doc-abc',
        }
        mockApiRequest.mockResolvedValueOnce({ data: mockDoc })

        const { resolveDocumentRef } = await import('../lib/refs.js')
        const result = await resolveDocumentRef('550e8400-e29b-41d4-a716-446655440000')

        expect(result).toEqual(mockDoc)
        expect(mockApiRequest).toHaveBeenCalledWith('documents.info', {
            id: '550e8400-e29b-41d4-a716-446655440000',
        })
    })

    it('resolves document by short alphanumeric ID', async () => {
        const mockDoc = { id: 'abc123', title: 'Test Doc', urlId: 'test-doc-abc' }
        mockApiRequest.mockResolvedValueOnce({ data: mockDoc })

        const { resolveDocumentRef } = await import('../lib/refs.js')
        const result = await resolveDocumentRef('abc123')

        expect(result).toEqual(mockDoc)
        expect(mockApiRequest).toHaveBeenCalledWith('documents.info', {
            id: 'abc123',
        })
    })

    it('extracts ID from URL slug and resolves', async () => {
        const mockDoc = {
            id: 'xyz789',
            title: 'My Document',
            urlId: 'my-doc-xyz789',
        }
        mockApiRequest.mockResolvedValueOnce({ data: mockDoc })

        const { resolveDocumentRef } = await import('../lib/refs.js')
        const result = await resolveDocumentRef('my-document-xyz789')

        expect(result).toEqual(mockDoc)
        expect(mockApiRequest).toHaveBeenCalledWith('documents.info', {
            id: 'xyz789',
        })
    })

    it('resolves document by exact name match (case-insensitive)', async () => {
        const mockDocs = [
            { id: '1', title: 'Engineering Guide', urlId: 'eng-1' },
            { id: '2', title: 'Product Docs', urlId: 'prod-2' },
        ]
        // "engineering guide" has spaces, doesn't look like an ID
        mockApiRequest.mockResolvedValueOnce({ data: mockDocs })

        const { resolveDocumentRef } = await import('../lib/refs.js')
        const result = await resolveDocumentRef('engineering guide')

        expect(result).toEqual(mockDocs[0])
    })

    it('resolves document by partial name match when unique', async () => {
        const mockDocs = [
            { id: '1', title: 'Engineering Guide', urlId: 'eng-1' },
            { id: '2', title: 'Product Docs', urlId: 'prod-2' },
        ]
        // "product" is 7 chars, looks like an ID, so will try ID lookup first
        mockApiRequest
            .mockRejectedValueOnce(new Error('Not found')) // ID lookup fails
            .mockResolvedValueOnce({ data: mockDocs }) // falls back to list

        const { resolveDocumentRef } = await import('../lib/refs.js')
        const result = await resolveDocumentRef('product')

        expect(result).toEqual(mockDocs[1])
    })

    it('throws ambiguous error when multiple partial matches', async () => {
        const mockDocs = [
            { id: '1', title: 'Engineering Guide', urlId: 'eng-1' },
            { id: '2', title: 'Engineering Handbook', urlId: 'eng-2' },
        ]
        // "engineering" is 11 chars, looks like an ID
        mockApiRequest
            .mockRejectedValueOnce(new Error('Not found'))
            .mockResolvedValueOnce({ data: mockDocs })

        const { resolveDocumentRef } = await import('../lib/refs.js')
        await expect(resolveDocumentRef('engineering')).rejects.toThrow(
            /Ambiguous Document reference/,
        )
    })

    it('shows urlId in ambiguous error suggestions for documents', async () => {
        const mockDocs = [
            { id: '1', title: 'Engineering Guide', urlId: 'eng-guide-abc' },
            { id: '2', title: 'Engineering Handbook', urlId: 'eng-handbook-xyz' },
        ]
        mockApiRequest
            .mockRejectedValueOnce(new Error('Not found'))
            .mockResolvedValueOnce({ data: mockDocs })

        const { resolveDocumentRef } = await import('../lib/refs.js')
        try {
            await resolveDocumentRef('engineering')
        } catch (error) {
            const message = (error as Error).message
            expect(message).toContain('eng-guide-abc')
            expect(message).toContain('eng-handbook-xyz')
            expect(message).not.toContain('"1"') // should not show internal id
            return
        }
        expect.fail('Expected error to be thrown')
    })

    it('treats multiple exact name matches as ambiguous', async () => {
        const mockDocs = [
            { id: '1', title: 'Meeting Notes', urlId: 'meeting-notes-abc' },
            { id: '2', title: 'Meeting Notes', urlId: 'meeting-notes-xyz' },
        ]
        // "meeting notes" has spaces, doesn't look like an ID
        mockApiRequest.mockResolvedValueOnce({ data: mockDocs })

        const { resolveDocumentRef } = await import('../lib/refs.js')
        await expect(resolveDocumentRef('meeting notes')).rejects.toThrow(
            /Ambiguous Document reference.*Multiple items have this exact name/,
        )
    })

    it('throws not found error when no matches', async () => {
        const mockDocs = [{ id: '1', title: 'Engineering Guide', urlId: 'eng-1' }]
        // "nonexistent" is 11 chars, looks like an ID
        mockApiRequest
            .mockRejectedValueOnce(new Error('Not found'))
            .mockResolvedValueOnce({ data: mockDocs })

        const { resolveDocumentRef } = await import('../lib/refs.js')
        await expect(resolveDocumentRef('nonexistent')).rejects.toThrow(
            'Document not found: "nonexistent"',
        )
    })

    it('falls back to name search when ID lookup fails', async () => {
        const mockDocs = [
            { id: '1', title: 'Engineering Guide', urlId: 'eng-1' },
            { id: '2', title: 'Product Docs', urlId: 'prod-2' },
        ]
        // "abc123" looks like an ID, but fails, then falls back to name search
        mockApiRequest
            .mockRejectedValueOnce(new Error('Not found'))
            .mockResolvedValueOnce({ data: mockDocs })

        const { resolveDocumentRef } = await import('../lib/refs.js')

        // Should fall back to name search and throw "not found"
        await expect(resolveDocumentRef('abc123')).rejects.toThrow('Document not found: "abc123"')
        expect(mockApiRequest).toHaveBeenCalledTimes(2)
        expect(mockApiRequest).toHaveBeenNthCalledWith(1, 'documents.info', {
            id: 'abc123',
        })
        expect(mockApiRequest).toHaveBeenNthCalledWith(2, 'documents.list', {
            limit: 100,
            offset: 0,
        })
    })

    it('paginates to fetch all documents when workspace has >100', async () => {
        // Create 150 mock docs to simulate pagination
        const page1 = Array.from({ length: 100 }, (_, i) => ({
            id: `doc-${i}`,
            title: `Doc ${i}`,
            urlId: `doc-${i}-abc`,
        }))
        const page2 = Array.from({ length: 50 }, (_, i) => ({
            id: `doc-${100 + i}`,
            title: `Doc ${100 + i}`,
            urlId: `doc-${100 + i}-abc`,
        }))

        mockApiRequest
            .mockResolvedValueOnce({ data: page1 }) // first page (100 items)
            .mockResolvedValueOnce({ data: page2 }) // second page (50 items)

        const { resolveDocumentRef } = await import('../lib/refs.js')
        // Search for a doc that's on page 2
        const result = await resolveDocumentRef('Doc 125')

        expect(result).toEqual(page2[25])
        expect(mockApiRequest).toHaveBeenCalledTimes(2)
        expect(mockApiRequest).toHaveBeenNthCalledWith(1, 'documents.list', {
            limit: 100,
            offset: 0,
        })
        expect(mockApiRequest).toHaveBeenNthCalledWith(2, 'documents.list', {
            limit: 100,
            offset: 100,
        })
    })
})

describe('resolveCollectionRef', () => {
    beforeEach(() => {
        vi.resetModules()
        mockApiRequest.mockReset()
    })

    afterEach(() => {
        vi.restoreAllMocks()
    })

    it('resolves collection by exact ID', async () => {
        const mockCol = { id: 'col123', name: 'Engineering' }
        mockApiRequest.mockResolvedValueOnce({ data: mockCol })

        const { resolveCollectionRef } = await import('../lib/refs.js')
        const result = await resolveCollectionRef('col123')

        expect(result).toEqual(mockCol)
        expect(mockApiRequest).toHaveBeenCalledWith('collections.info', {
            id: 'col123',
        })
    })

    it('resolves collection by exact name match', async () => {
        const mockCols = [
            { id: '1', name: 'Engineering' },
            { id: '2', name: 'Product' },
        ]
        // "Engineering" is 11 chars, looks like an ID
        mockApiRequest
            .mockRejectedValueOnce(new Error('Not found'))
            .mockResolvedValueOnce({ data: mockCols })

        const { resolveCollectionRef } = await import('../lib/refs.js')
        const result = await resolveCollectionRef('Engineering')

        expect(result).toEqual(mockCols[0])
    })

    it('resolves collection by partial name match when unique', async () => {
        const mockCols = [
            { id: '1', name: 'Engineering' },
            { id: '2', name: 'Product' },
        ]
        // "prod" is 4 chars, doesn't look like an ID (needs 6+)
        mockApiRequest.mockResolvedValueOnce({ data: mockCols })

        const { resolveCollectionRef } = await import('../lib/refs.js')
        const result = await resolveCollectionRef('prod')

        expect(result).toEqual(mockCols[1])
    })

    it('throws ambiguous error when multiple partial matches', async () => {
        const mockCols = [
            { id: '1', name: 'Engineering Frontend' },
            { id: '2', name: 'Engineering Backend' },
        ]
        // "engineering" is 11 chars, looks like an ID
        mockApiRequest
            .mockRejectedValueOnce(new Error('Not found'))
            .mockResolvedValueOnce({ data: mockCols })

        const { resolveCollectionRef } = await import('../lib/refs.js')
        await expect(resolveCollectionRef('engineering')).rejects.toThrow(
            /Ambiguous Collection reference/,
        )
    })

    it('throws not found error when no matches', async () => {
        const mockCols = [{ id: '1', name: 'Engineering' }]
        // "nonexistent" is 11 chars, looks like an ID
        mockApiRequest
            .mockRejectedValueOnce(new Error('Not found'))
            .mockResolvedValueOnce({ data: mockCols })

        const { resolveCollectionRef } = await import('../lib/refs.js')
        await expect(resolveCollectionRef('nonexistent')).rejects.toThrow(
            'Collection not found: "nonexistent"',
        )
    })
})

describe('resolveDocumentId', () => {
    beforeEach(() => {
        vi.resetModules()
        mockApiRequest.mockReset()
    })

    afterEach(() => {
        vi.restoreAllMocks()
    })

    it('returns just the ID string', async () => {
        const mockDoc = { id: 'doc-id-123', title: 'Test', urlId: 'test-abc' }
        mockApiRequest.mockResolvedValueOnce({ data: mockDoc })

        const { resolveDocumentId } = await import('../lib/refs.js')
        const result = await resolveDocumentId('testabc')

        expect(result).toBe('doc-id-123')
    })
})

describe('resolveCollectionId', () => {
    beforeEach(() => {
        vi.resetModules()
        mockApiRequest.mockReset()
    })

    afterEach(() => {
        vi.restoreAllMocks()
    })

    it('returns just the ID string', async () => {
        const mockCol = { id: 'col-id-123', name: 'Engineering' }
        mockApiRequest.mockResolvedValueOnce({ data: mockCol })

        const { resolveCollectionId } = await import('../lib/refs.js')
        const result = await resolveCollectionId('colid123')

        expect(result).toBe('col-id-123')
    })
})
