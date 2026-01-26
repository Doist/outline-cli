import { createHash, randomBytes } from "node:crypto";

function base64UrlEncode(buffer: Buffer): string {
	return buffer
		.toString("base64")
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
}

export function generateCodeVerifier(): string {
	// 64 bytes => 86 chars, within 43-128 requirement.
	return base64UrlEncode(randomBytes(64));
}

export function generateCodeChallenge(codeVerifier: string): string {
	const hash = createHash("sha256").update(codeVerifier).digest();
	return base64UrlEncode(hash);
}

export function generateState(): string {
	return base64UrlEncode(randomBytes(32));
}
