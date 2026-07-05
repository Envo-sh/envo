/**
 * OAuth refresh for layer-1 file-kind credentials — client-side only, so the
 * zero-knowledge model holds: refresh tokens are read from the user's own
 * credential files, exchanged directly with the provider, and written back.
 * Envo's servers never participate.
 *
 * Provider adapters know three things: how to read expiry out of a credential
 * file, how to perform the refresh-token grant, and how to write the new
 * tokens back preserving everything else in the file.
 */

export interface TokenStatus {
  /** ms epoch; undefined when the format carries no expiry we can read. */
  expiresAt?: number;
  expired: boolean;
  refreshable: boolean;
}

export interface RefreshResult {
  content: string;
  expiresAt?: number;
}

interface GrantResponse {
  access_token?: string;
  refresh_token?: string;
  id_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

interface RefreshAdapter {
  inspect(content: string): TokenStatus;
  refresh(content: string, endpointOverride?: string): Promise<RefreshResult>;
}

function jwtExpiryMs(jwt: string): number | undefined {
  try {
    const payload = JSON.parse(
      Buffer.from(jwt.split(".")[1] ?? "", "base64url").toString("utf8"),
    ) as { exp?: number };
    return payload.exp ? payload.exp * 1000 : undefined;
  } catch {
    return undefined;
  }
}

function status(expiresAt: number | undefined, refreshable: boolean): TokenStatus {
  return {
    expiresAt,
    expired: expiresAt !== undefined && expiresAt <= Date.now(),
    refreshable,
  };
}

async function tokenGrant(
  endpoint: string,
  params: Record<string, string>,
): Promise<GrantResponse> {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
  const data = (await res.json().catch(() => ({}))) as GrantResponse;
  if (!res.ok || !data.access_token) {
    throw new Error(
      `refresh grant failed (${res.status}): ${data.error_description ?? data.error ?? "no access_token in response"}`,
    );
  }
  return data;
}

// Public OAuth client ids, as shipped in each harness's own distribution.
const ANTHROPIC_TOKEN_ENDPOINT = "https://console.anthropic.com/v1/oauth/token";
const ANTHROPIC_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const OPENAI_TOKEN_ENDPOINT = "https://auth.openai.com/oauth/token";
const OPENAI_CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";

/** ~/.claude/.credentials.json — { claudeAiOauth: { accessToken, refreshToken, expiresAt } } */
const claudeCode: RefreshAdapter = {
  inspect(content) {
    try {
      const o = (JSON.parse(content) as { claudeAiOauth?: { expiresAt?: number; refreshToken?: string } })
        .claudeAiOauth;
      return status(o?.expiresAt, Boolean(o?.refreshToken));
    } catch {
      return { expired: false, refreshable: false };
    }
  },
  async refresh(content, endpointOverride) {
    const doc = JSON.parse(content) as { claudeAiOauth: Record<string, unknown> };
    const grant = await tokenGrant(endpointOverride ?? ANTHROPIC_TOKEN_ENDPOINT, {
      grant_type: "refresh_token",
      refresh_token: String(doc.claudeAiOauth.refreshToken),
      client_id: ANTHROPIC_CLIENT_ID,
    });
    const expiresAt = Date.now() + (grant.expires_in ?? 3600) * 1000;
    doc.claudeAiOauth = {
      ...doc.claudeAiOauth,
      accessToken: grant.access_token,
      refreshToken: grant.refresh_token ?? doc.claudeAiOauth.refreshToken,
      expiresAt,
    };
    return { content: JSON.stringify(doc, null, 2), expiresAt };
  },
};

/** ~/.local/share/opencode/auth.json — per-provider entries; oauth ones carry access/refresh/expires. */
const opencode: RefreshAdapter = {
  inspect(content) {
    try {
      const doc = JSON.parse(content) as Record<string, { type?: string; expires?: number; refresh?: string }>;
      const oauth = Object.values(doc).filter((v) => v?.type === "oauth");
      if (!oauth.length) return { expired: false, refreshable: false };
      const soonest = Math.min(...oauth.map((v) => v.expires ?? Infinity));
      return status(Number.isFinite(soonest) ? soonest : undefined, oauth.some((v) => v.refresh));
    } catch {
      return { expired: false, refreshable: false };
    }
  },
  async refresh(content, endpointOverride) {
    const doc = JSON.parse(content) as Record<
      string,
      { type?: string; access?: string; refresh?: string; expires?: number }
    >;
    let earliest: number | undefined;
    for (const [name, entry] of Object.entries(doc)) {
      if (entry?.type !== "oauth" || !entry.refresh) continue;
      // OpenCode multiplexes providers; each refreshes against its own issuer.
      const endpoint =
        endpointOverride ??
        (name === "anthropic" ? ANTHROPIC_TOKEN_ENDPOINT : name === "openai" ? OPENAI_TOKEN_ENDPOINT : null);
      const clientId = name === "anthropic" ? ANTHROPIC_CLIENT_ID : OPENAI_CODEX_CLIENT_ID;
      if (!endpoint) continue;
      const grant = await tokenGrant(endpoint, {
        grant_type: "refresh_token",
        refresh_token: entry.refresh,
        client_id: clientId,
      });
      entry.access = grant.access_token;
      entry.refresh = grant.refresh_token ?? entry.refresh;
      entry.expires = Date.now() + (grant.expires_in ?? 3600) * 1000;
      earliest = Math.min(earliest ?? Infinity, entry.expires);
    }
    if (earliest === undefined) throw new Error("no refreshable oauth entries");
    return { content: JSON.stringify(doc, null, 2), expiresAt: earliest };
  },
};

/** ~/.codex/auth.json — { tokens: { access_token(JWT), refresh_token, id_token }, last_refresh } */
const codex: RefreshAdapter = {
  inspect(content) {
    try {
      const doc = JSON.parse(content) as { tokens?: { access_token?: string; refresh_token?: string } };
      return status(
        doc.tokens?.access_token ? jwtExpiryMs(doc.tokens.access_token) : undefined,
        Boolean(doc.tokens?.refresh_token),
      );
    } catch {
      return { expired: false, refreshable: false };
    }
  },
  async refresh(content, endpointOverride) {
    const doc = JSON.parse(content) as { tokens: Record<string, unknown>; last_refresh?: string };
    const grant = await tokenGrant(endpointOverride ?? OPENAI_TOKEN_ENDPOINT, {
      grant_type: "refresh_token",
      refresh_token: String(doc.tokens.refresh_token),
      client_id: OPENAI_CODEX_CLIENT_ID,
      scope: "openid profile email",
    });
    doc.tokens = {
      ...doc.tokens,
      access_token: grant.access_token,
      refresh_token: grant.refresh_token ?? doc.tokens.refresh_token,
      ...(grant.id_token ? { id_token: grant.id_token } : {}),
    };
    doc.last_refresh = new Date().toISOString();
    return {
      content: JSON.stringify(doc, null, 2),
      expiresAt: grant.access_token ? jwtExpiryMs(grant.access_token) : undefined,
    };
  },
};

const REFRESH_ADAPTERS: Record<string, RefreshAdapter> = {
  "claude-code": claudeCode,
  opencode,
  codex,
};

export function refreshableProviders(): string[] {
  return Object.keys(REFRESH_ADAPTERS);
}

export function inspectAuthContent(provider: string, content: string): TokenStatus {
  const adapter = REFRESH_ADAPTERS[provider];
  if (!adapter) return { expired: false, refreshable: false };
  return adapter.inspect(content);
}

export async function refreshAuthContent(
  provider: string,
  content: string,
  opts: { endpoint?: string } = {},
): Promise<RefreshResult> {
  const adapter = REFRESH_ADAPTERS[provider];
  if (!adapter) throw new Error(`no refresh adapter for provider "${provider}"`);
  return adapter.refresh(content, opts.endpoint);
}

export function describeExpiry(statusInfo: TokenStatus): string {
  if (statusInfo.expiresAt === undefined) return "expiry unknown";
  const delta = statusInfo.expiresAt - Date.now();
  const abs = Math.abs(delta);
  const human =
    abs > 86_400_000
      ? `${Math.round(abs / 86_400_000)}d`
      : abs > 3_600_000
        ? `${Math.round(abs / 3_600_000)}h`
        : `${Math.max(1, Math.round(abs / 60_000))}m`;
  return delta <= 0 ? `expired ${human} ago` : `expires in ${human}`;
}
