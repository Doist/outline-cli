import { getApiToken, getBaseUrl } from "./auth.js";
import { type SpinnerOptions, withSpinner } from "./spinner.js";

/**
 * Spinner configuration mapping API paths to spinner options.
 * Blue for read operations, green for creates, yellow for updates/deletes.
 */
const API_SPINNER_CONFIG: Record<string, SpinnerOptions> = {
	"auth.info": { text: "Checking authentication...", color: "blue" },
	"documents.search": { text: "Searching documents...", color: "blue" },
	"documents.list": { text: "Loading documents...", color: "blue" },
	"documents.info": { text: "Loading document...", color: "blue" },
	"documents.create": { text: "Creating document...", color: "green" },
	"documents.update": { text: "Updating document...", color: "yellow" },
	"documents.delete": { text: "Deleting document...", color: "yellow" },
	"documents.move": { text: "Moving document...", color: "yellow" },
	"documents.archive": { text: "Archiving document...", color: "yellow" },
	"documents.unarchive": { text: "Unarchiving document...", color: "yellow" },
	"collections.list": { text: "Loading collections...", color: "blue" },
	"collections.info": { text: "Loading collection...", color: "blue" },
	"collections.create": { text: "Creating collection...", color: "green" },
	"collections.update": { text: "Updating collection...", color: "yellow" },
	"collections.delete": { text: "Deleting collection...", color: "yellow" },
};

export interface Pagination {
	offset: number;
	limit: number;
	nextPath?: string;
}

interface ApiResponse<T> {
	data: T;
	pagination?: Pagination;
	status?: number;
	ok?: boolean;
}

interface ApiError {
	error: string;
	message: string;
}

export interface PaginatedResult<T> {
	data: T;
	pagination?: Pagination;
}

/**
 * Core API request function without spinner wrapping.
 * Used internally by the Proxy-wrapped API client.
 */
async function rawApiRequest<T>(
	path: string,
	body: object = {},
): Promise<PaginatedResult<T>> {
	const baseUrl = getBaseUrl();
	const token = getApiToken();

	const res = await fetch(`${baseUrl}/api/${path}`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${token}`,
		},
		body: JSON.stringify(body),
	});

	if (!res.ok) {
		let message = `API error: ${res.status} ${res.statusText}`;
		try {
			const err = (await res.json()) as ApiError;
			if (err.message) message = `API error: ${err.message}`;
		} catch {}
		throw new Error(message);
	}

	const json = (await res.json()) as ApiResponse<T>;
	return { data: json.data, pagination: json.pagination };
}

/**
 * API client interface with a request method.
 */
interface ApiClient {
	request: <T>(path: string, body?: object) => Promise<PaginatedResult<T>>;
}

/**
 * Creates a Proxy-wrapped API client that automatically applies spinners
 * to API calls based on the API_SPINNER_CONFIG mapping.
 */
function createSpinnerWrappedApi(): ApiClient {
	const baseClient: ApiClient = {
		request: rawApiRequest,
	};

	return new Proxy(baseClient, {
		get(target, property, receiver) {
			const originalMethod = Reflect.get(target, property, receiver);

			if (property === "request" && typeof originalMethod === "function") {
				return <T>(
					path: string,
					body: object = {},
				): Promise<PaginatedResult<T>> => {
					const spinnerConfig = API_SPINNER_CONFIG[path];

					if (spinnerConfig) {
						return withSpinner(spinnerConfig, () =>
							rawApiRequest<T>(path, body),
						);
					}

					// No spinner config, pass through with default spinner
					return withSpinner({ text: "Loading...", color: "blue" }, () =>
						rawApiRequest<T>(path, body),
					);
				};
			}

			return originalMethod;
		},
	});
}

// Cached API client instance
let apiClient: ApiClient | null = null;

/**
 * Returns the singleton Proxy-wrapped API client.
 */
function getApi(): ApiClient {
	if (!apiClient) {
		apiClient = createSpinnerWrappedApi();
	}
	return apiClient;
}

/**
 * Public API request function that uses the Proxy-wrapped client.
 * Maintains backward compatibility with existing code.
 */
export async function apiRequest<T>(
	path: string,
	body: object = {},
): Promise<PaginatedResult<T>> {
	return getApi().request<T>(path, body);
}
