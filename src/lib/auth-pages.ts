function escapeHtml(text: string): string {
    return text
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;')
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
</html>`
}

export function renderSuccess(): string {
    return renderPage(
        'Login complete',
        'Outline CLI is now authenticated.',
        '<div class="message success">You can close this tab now.</div>',
    )
}

export function renderError(message: string): string {
    return renderPage(
        'Authentication failed',
        'Outline CLI could not finish OAuth login.',
        `<div class="message error">${escapeHtml(message)}</div>`,
    )
}
