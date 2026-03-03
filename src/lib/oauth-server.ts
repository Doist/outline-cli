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

function escapeHtml(text: string): string {
	return text
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}

function renderPage(title: string, subtitle: string, body: string): string {
	return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} - Outline CLI</title>
  <style>
    :root {
      --bg: #f5f7fb;
      --surface: #ffffff;
      --border: #e6e9f0;
      --text: #1e2430;
      --muted: #586178;
      --ok: #15803d;
      --ok-soft: #dcfce7;
      --err: #b91c1c;
      --err-soft: #fee2e2;
      --radius: 14px;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: radial-gradient(1200px 500px at 50% -10%, #dbeafe 0%, var(--bg) 60%);
      color: var(--text);
      line-height: 1.5;
      padding: 20px;
    }
    .card {
      width: min(560px, 100%);
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 24px;
      box-shadow: 0 16px 40px rgba(15, 23, 42, 0.08);
    }
    h1 {
      margin: 0 0 8px;
      font-size: 24px;
      letter-spacing: -0.01em;
    }
    .subtitle {
      margin: 0 0 16px;
      color: var(--muted);
      font-size: 15px;
    }
    .message {
      border-radius: 12px;
      padding: 14px 16px;
      font-size: 14px;
    }
    .success {
      background: var(--ok-soft);
      color: #14532d;
    }
    .error {
      background: var(--err-soft);
      color: #7f1d1d;
    }
    .hint {
      margin-top: 14px;
      color: var(--muted);
      font-size: 13px;
    }
    code {
      font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
      background: #eef2ff;
      border-radius: 6px;
      padding: 2px 6px;
    }
  </style>
</head>
<body>
  <main class="card">
    <h1>${escapeHtml(title)}</h1>
    <p class="subtitle">${escapeHtml(subtitle)}</p>
    ${body}
    <p class="hint">Return to your terminal and continue with <code>ol</code> commands.</p>
  </main>
</body>
</html>`;
}

function renderSuccessPage(): string {
	return renderPage(
		"Login complete",
		"Outline CLI is now authenticated.",
		'<div class="message success">You can close this tab now.</div>',
	);
}

function renderErrorPage(message: string): string {
	return renderPage(
		"Authentication failed",
		"Outline CLI could not finish OAuth login.",
		`<div class="message error">${escapeHtml(message)}</div>`,
	);
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
			res.writeHead(409, { "Content-Type": "text/html; charset=utf-8" });
			res.end(renderErrorPage("Authorization was already received."));
			return;
		}

		if (req.method !== "GET" || !req.url) {
			res.writeHead(405, { "Content-Type": "text/html; charset=utf-8" });
			res.end(renderErrorPage("Invalid callback request method."));
			return;
		}

		const url = new URL(req.url, origin);
		if (url.pathname !== "/callback") {
			res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
			res.end(renderErrorPage("Unknown callback path."));
			return;
		}

		// Check for OAuth error response first
		const error = url.searchParams.get("error");
		if (error) {
			const errorDescription =
				url.searchParams.get("error_description") || error;
			res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
			res.end(renderErrorPage(`Authorization failed: ${errorDescription}`));
			rejectCode(new Error(`OAuth authorization denied: ${errorDescription}`));
			resolved = true;
			return;
		}

		const code = url.searchParams.get("code");
		const returnedState = url.searchParams.get("state");

		if (!code || !returnedState) {
			res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
			res.end(renderErrorPage("Missing OAuth code or state parameter."));
			rejectCode(new Error("Missing OAuth authorization code."));
			resolved = true;
			return;
		}

		if (returnedState !== state) {
			res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
			res.end(renderErrorPage("Invalid OAuth state parameter."));
			rejectCode(new Error("OAuth state mismatch."));
			resolved = true;
			return;
		}

		res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
		res.end(renderSuccessPage());
		resolved = true;
		resolveCode(code);
	});

	server.on("error", (err) => {
		if (resolved) return;
		resolved = true;
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

	waitForCode.then(
		() => {
			clearTimeout(timeout);
			server.close();
		},
		() => {
			clearTimeout(timeout);
			server.close();
		},
	);

	return { port, redirectUri, waitForCode, close };
}
