import { apiRequest } from "./api.js";

interface Document {
	id: string;
	title: string;
	url: string;
	urlId: string;
}

interface Collection {
	id: string;
	name: string;
}

/**
 * Check if the input looks like a UUID
 */
function isUuid(input: string): boolean {
	return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
		input,
	);
}

/**
 * Check if the input looks like an Outline ID (UUID or URL ID format)
 */
function looksLikeId(input: string): boolean {
	// UUID format
	if (isUuid(input)) {
		return true;
	}
	// Short alphanumeric ID (like urlId) - must be 6+ chars and no spaces
	if (/^[a-zA-Z0-9]{6,}$/.test(input) && !/\s/.test(input)) {
		return true;
	}
	return false;
}

/**
 * Extract document ID from URL or slug
 * Only extracts from slugs (e.g., "my-doc-abc123" -> "abc123")
 * Preserves full UUIDs and raw IDs
 */
function extractDocumentId(input: string): string {
	// Preserve UUIDs as-is
	if (isUuid(input)) {
		return input;
	}
	// If it looks like a URL, extract the slug suffix
	const parts = input.replace(/\/$/, "").split("/");
	const last = parts[parts.length - 1];
	// Outline URL IDs are the part after the last hyphen in the slug
	// Only extract if it's a slug with hyphen, not just a raw ID
	const match = last.match(/-([a-zA-Z0-9]+)$/);
	if (match) return match[1];
	return input;
}

/**
 * Format suggestions for error messages
 */
function formatSuggestions<T>(
	items: T[],
	getName: (item: T) => string,
	getId: (item: T) => string,
	max = 5,
): string {
	const suggestions = items.slice(0, max);
	return suggestions
		.map((item) => `  - "${getName(item)}" (${getId(item)})`)
		.join("\n");
}

/**
 * Generic fuzzy reference resolver
 */
async function resolveRef<T extends { id: string }>(
	ref: string,
	fetchById: (id: string) => Promise<T>,
	fetchAll: () => Promise<T[]>,
	getName: (item: T) => string,
	entityType: string,
): Promise<T> {
	// Try direct ID lookup first if it looks like an ID
	const extractedId = extractDocumentId(ref);
	if (looksLikeId(extractedId)) {
		try {
			return await fetchById(extractedId);
		} catch {
			// If direct ID lookup fails, fall through to name matching
		}
	}

	// Fetch all items and search by name
	const items = await fetchAll();
	const refLower = ref.toLowerCase();

	// Try exact match first (case-insensitive)
	const exactMatch = items.find(
		(item) => getName(item).toLowerCase() === refLower,
	);
	if (exactMatch) return exactMatch;

	// Try partial match
	const partialMatches = items.filter((item) =>
		getName(item).toLowerCase().includes(refLower),
	);

	if (partialMatches.length === 1) {
		return partialMatches[0];
	}

	if (partialMatches.length > 1) {
		const suggestions = formatSuggestions(
			partialMatches,
			getName,
			(item) => item.id,
		);
		throw new Error(
			`Ambiguous ${entityType} reference "${ref}". Did you mean:\n${suggestions}`,
		);
	}

	// No matches found
	throw new Error(`${entityType} not found: "${ref}"`);
}

/**
 * Resolve a document reference by ID, URL, or name
 */
export async function resolveDocumentRef(ref: string): Promise<Document> {
	return resolveRef<Document>(
		ref,
		async (id) => {
			const { data } = await apiRequest<Document>("documents.info", { id });
			return data;
		},
		async () => {
			const { data } = await apiRequest<Document[]>("documents.list", {
				limit: 100,
			});
			return data;
		},
		(doc) => doc.title,
		"Document",
	);
}

/**
 * Resolve a document reference and return just the ID
 */
export async function resolveDocumentId(ref: string): Promise<string> {
	const doc = await resolveDocumentRef(ref);
	return doc.id;
}

/**
 * Resolve a collection reference by ID or name
 */
export async function resolveCollectionRef(ref: string): Promise<Collection> {
	return resolveRef<Collection>(
		ref,
		async (id) => {
			const { data } = await apiRequest<Collection>("collections.info", { id });
			return data;
		},
		async () => {
			const { data } = await apiRequest<Collection[]>("collections.list", {
				limit: 100,
			});
			return data;
		},
		(col) => col.name,
		"Collection",
	);
}

/**
 * Resolve a collection reference and return just the ID
 */
export async function resolveCollectionId(ref: string): Promise<string> {
	const col = await resolveCollectionRef(ref);
	return col.id;
}
