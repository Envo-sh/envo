import { afterAll, describe, expect, test } from "bun:test";
import { describeExpiry, inspectAuthContent, refreshAuthContent } from "../src/refresh.ts";

// Mock OAuth token endpoint: validates the grant and returns fresh tokens.
const server = Bun.serve({
  port: 0,
  async fetch(req) {
    const body = new URLSearchParams(await req.text());
    if (body.get("grant_type") !== "refresh_token") {
      return Response.json({ error: "unsupported_grant_type" }, { status: 400 });
    }
    if (body.get("refresh_token") === "revoked-token") {
      return Response.json({ error: "invalid_grant", error_description: "revoked" }, { status: 400 });
    }
    return Response.json({
      access_token: "fresh-access",
      refresh_token: "fresh-refresh",
      expires_in: 3600,
    });
  },
});
const endpoint = `http://localhost:${server.port}/token`;
afterAll(() => server.stop());

function jwtWithExp(expSecs: number): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "none" })}.${b64({ exp: expSecs })}.sig`;
}

describe("token inspection", () => {
  test("claude-code expiry parsed from credentials file", () => {
    const past = JSON.stringify({ claudeAiOauth: { accessToken: "a", refreshToken: "r", expiresAt: Date.now() - 1000 } });
    const future = JSON.stringify({ claudeAiOauth: { accessToken: "a", refreshToken: "r", expiresAt: Date.now() + 3_600_000 } });
    expect(inspectAuthContent("claude-code", past).expired).toBe(true);
    expect(inspectAuthContent("claude-code", future).expired).toBe(false);
    expect(inspectAuthContent("claude-code", future).refreshable).toBe(true);
  });

  test("codex expiry decoded from the access-token JWT", () => {
    const expired = JSON.stringify({ tokens: { access_token: jwtWithExp(1), refresh_token: "r" } });
    const live = JSON.stringify({ tokens: { access_token: jwtWithExp(Math.floor(Date.now() / 1000) + 3600), refresh_token: "r" } });
    expect(inspectAuthContent("codex", expired).expired).toBe(true);
    expect(inspectAuthContent("codex", live).expired).toBe(false);
  });

  test("opencode reports the soonest oauth expiry across entries", () => {
    const doc = JSON.stringify({
      openai: { type: "oauth", access: "a", refresh: "r", expires: Date.now() - 5000 },
      anthropic: { type: "api", key: "test-fixture-not-a-key" },
    });
    const info = inspectAuthContent("opencode", doc);
    expect(info.expired).toBe(true);
    expect(info.refreshable).toBe(true);
  });

  test("unknown providers are not refreshable and never block", () => {
    expect(inspectAuthContent("mystery", "not json").expired).toBe(false);
    expect(inspectAuthContent("mystery", "not json").refreshable).toBe(false);
  });

  test("describeExpiry is human", () => {
    expect(describeExpiry({ expiresAt: Date.now() + 7_200_000, expired: false, refreshable: true })).toContain("expires in 2h");
    expect(describeExpiry({ expiresAt: Date.now() - 7_200_000, expired: true, refreshable: true })).toContain("expired 2h ago");
  });
});

describe("refresh grant", () => {
  test("claude-code refresh updates tokens and preserves the rest of the file", async () => {
    const content = JSON.stringify({
      claudeAiOauth: { accessToken: "old", refreshToken: "old-refresh", expiresAt: 1, scopes: ["user:inference"] },
      otherSetting: true,
    });
    const result = await refreshAuthContent("claude-code", content, { endpoint });
    const doc = JSON.parse(result.content);
    expect(doc.claudeAiOauth.accessToken).toBe("fresh-access");
    expect(doc.claudeAiOauth.refreshToken).toBe("fresh-refresh");
    expect(doc.claudeAiOauth.scopes).toEqual(["user:inference"]);
    expect(doc.otherSetting).toBe(true);
    expect(result.expiresAt).toBeGreaterThan(Date.now());
  });

  test("codex refresh rewrites tokens and stamps last_refresh", async () => {
    const content = JSON.stringify({
      OPENAI_API_KEY: null,
      auth_mode: "chatgpt",
      tokens: { access_token: jwtWithExp(1), refresh_token: "old", id_token: "old-id", account_id: "acct_1" },
      last_refresh: "2020-01-01T00:00:00Z",
    });
    const result = await refreshAuthContent("codex", content, { endpoint });
    const doc = JSON.parse(result.content);
    expect(doc.tokens.access_token).toBe("fresh-access");
    expect(doc.tokens.account_id).toBe("acct_1");
    expect(doc.auth_mode).toBe("chatgpt");
    expect(new Date(doc.last_refresh).getTime()).toBeGreaterThan(Date.now() - 10_000);
  });

  test("a revoked refresh token surfaces the provider's error", async () => {
    const content = JSON.stringify({
      claudeAiOauth: { accessToken: "old", refreshToken: "revoked-token", expiresAt: 1 },
    });
    await expect(refreshAuthContent("claude-code", content, { endpoint })).rejects.toThrow(/revoked/);
  });
});
