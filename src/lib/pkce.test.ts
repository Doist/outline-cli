import { describe, expect, it } from "vitest";
import {
	generateCodeChallenge,
	generateCodeVerifier,
	generateState,
} from "./pkce.js";

describe("PKCE utilities", () => {
	describe("generateCodeVerifier", () => {
		it("returns a string of correct length", () => {
			const verifier = generateCodeVerifier();
			// 64 bytes base64url encoded = 86 chars (no padding)
			expect(verifier).toHaveLength(86);
		});

		it("returns base64url-safe characters only", () => {
			const verifier = generateCodeVerifier();
			expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
		});

		it("generates unique values", () => {
			const verifiers = new Set(
				Array.from({ length: 10 }, () => generateCodeVerifier()),
			);
			expect(verifiers.size).toBe(10);
		});

		it("meets PKCE length requirements (43-128 chars)", () => {
			const verifier = generateCodeVerifier();
			expect(verifier.length).toBeGreaterThanOrEqual(43);
			expect(verifier.length).toBeLessThanOrEqual(128);
		});
	});

	describe("generateCodeChallenge", () => {
		it("returns a string of correct length", () => {
			const verifier = generateCodeVerifier();
			const challenge = generateCodeChallenge(verifier);
			// SHA256 = 32 bytes, base64url encoded = 43 chars (no padding)
			expect(challenge).toHaveLength(43);
		});

		it("returns base64url-safe characters only", () => {
			const verifier = generateCodeVerifier();
			const challenge = generateCodeChallenge(verifier);
			expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
		});

		it("produces consistent output for same input", () => {
			const verifier = "test-verifier-string";
			const challenge1 = generateCodeChallenge(verifier);
			const challenge2 = generateCodeChallenge(verifier);
			expect(challenge1).toBe(challenge2);
		});

		it("produces different output for different inputs", () => {
			const challenge1 = generateCodeChallenge("verifier-one");
			const challenge2 = generateCodeChallenge("verifier-two");
			expect(challenge1).not.toBe(challenge2);
		});

		it("produces known output for known input", () => {
			// RFC 7636 Appendix B test vector
			// code_verifier: dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk
			// code_challenge: E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM
			const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
			const expectedChallenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
			expect(generateCodeChallenge(verifier)).toBe(expectedChallenge);
		});
	});

	describe("generateState", () => {
		it("returns a string of correct length", () => {
			const state = generateState();
			// 32 bytes base64url encoded = 43 chars (no padding)
			expect(state).toHaveLength(43);
		});

		it("returns base64url-safe characters only", () => {
			const state = generateState();
			expect(state).toMatch(/^[A-Za-z0-9_-]+$/);
		});

		it("generates unique values", () => {
			const states = new Set(Array.from({ length: 10 }, () => generateState()));
			expect(states.size).toBe(10);
		});
	});
});
