import { getApiToken, getBaseUrl } from "./auth.js";

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

export async function apiRequest<T>(
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
