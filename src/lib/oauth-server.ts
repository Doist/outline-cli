import http from "node:http";
import type { AddressInfo } from "node:net";

interface OAuthServerOptions {
	state: string;
	timeoutMs?: number;
}

export interface OAuthCallbackServer {
	port: number;
	redirectUri: string;
	waitForCode: Promise<string>;
	close: () => void;
}

export async function startOAuthCallbackServer(
	options: OAuthServerOptions,
): Promise<OAuthCallbackServer> {
	const { state, timeoutMs = 3 * 60 * 1000 } = options;
	let origin = "http://localhost";
	let resolved = false;
	let resolveCode: (code: string) => void;
	let rejectCode: (error: Error) => void;

	const waitForCode = new Promise<string>((resolve, reject) => {
		resolveCode = resolve;
		rejectCode = reject;
	});

	const server = http.createServer((req, res) => {
		if (resolved) {
			res.writeHead(409);
			res.end("Authorization already received.");
			return;
		}

		if (req.method !== "GET" || !req.url) {
			res.writeHead(405);
			res.end("Method not allowed.");
			return;
		}

		const url = new URL(req.url, origin);
		if (url.pathname !== "/callback") {
			res.writeHead(404);
			res.end("Not found.");
			return;
		}

		const code = url.searchParams.get("code");
		const returnedState = url.searchParams.get("state");

		if (!code || !returnedState) {
			res.writeHead(400);
			res.end("Missing OAuth parameters.");
			rejectCode(new Error("Missing OAuth authorization code."));
			resolved = true;
			return;
		}

		if (returnedState !== state) {
			res.writeHead(400);
			res.end("Invalid OAuth state.");
			rejectCode(new Error("OAuth state mismatch."));
			resolved = true;
			return;
		}

		res.writeHead(200, { "Content-Type": "text/html" });
		res.end(
			"<html><body><h1>Login complete</h1><p>You can close this window.</p></body></html>",
		);
		resolved = true;
		resolveCode(code);
	});

	server.on("error", (err) => {
		rejectCode(err as Error);
	});

	await new Promise<void>((resolve) => {
		server.listen(0, "127.0.0.1", resolve);
	});

	const { port } = server.address() as AddressInfo;
	origin = `http://localhost:${port}`;
	const redirectUri = `${origin}/callback`;

	const timeout = setTimeout(() => {
		if (resolved) return;
		resolved = true;
		rejectCode(new Error("Timed out waiting for OAuth callback."));
		server.close();
	}, timeoutMs);

	const close = () => {
		clearTimeout(timeout);
		server.close();
	};

	waitForCode.finally(() => {
		clearTimeout(timeout);
		server.close();
	});

	return { port, redirectUri, waitForCode, close };
}
