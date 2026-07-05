import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import type { AuthEntry, AuthMaterializeResult, PackManifest } from "./types.ts";
import { decrypt, encrypt, loadMasterKey, type SecretBox } from "./crypto.ts";
import { describeExpiry, inspectAuthContent, refreshAuthContent } from "./refresh.ts";
import { envLayerDir } from "./paths.ts";
import { loadState, saveState } from "./state.ts";

/**
 * Layer 1 of the ENVO-PACK spec: model provider credentials — what lets a
 * harness talk to its model. Two kinds:
 *
 *   env   — an API key materialized as an environment variable
 *   file  — an OAuth credential file materialized at the harness's own path
 *
 * Entries are declared once (`envo auth add`) and captured FRESH at pack
 * time, so refreshed OAuth tokens ride along with every push.
 */
export interface AuthProvider {
  kind: "env" | "file";
  /** env-kind: the variable name agents expect. */
  envKey?: string;
  /** file-kind: credential file location, ~-relative. */
  path?: string;
  note?: string;
}

export const AUTH_PROVIDERS: Record<string, AuthProvider> = {
  // API-key providers (env-kind)
  openai: { kind: "env", envKey: "OPENAI_API_KEY" },
  anthropic: { kind: "env", envKey: "ANTHROPIC_API_KEY" },
  openrouter: { kind: "env", envKey: "OPENROUTER_API_KEY" },
  xai: { kind: "env", envKey: "XAI_API_KEY" },
  groq: { kind: "env", envKey: "GROQ_API_KEY" },
  gemini: { kind: "env", envKey: "GEMINI_API_KEY" },

  // OAuth-token providers (file-kind, harness credential files)
  "claude-code": {
    kind: "file",
    path: "~/.claude/.credentials.json",
    note: "On macOS, Claude Code stores OAuth tokens in the Keychain; this file exists on Linux/containers.",
  },
  codex: { kind: "file", path: "~/.codex/auth.json" },
  opencode: { kind: "file", path: "~/.local/share/opencode/auth.json" },
  "gemini-cli": { kind: "file", path: "~/.gemini/oauth_creds.json" },
};

export function expandHome(path: string): string {
  return path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;
}

export function knownAuthProviders(): string[] {
  return Object.keys(AUTH_PROVIDERS);
}

export function authAad(project: string, environment: string, packVersion: number): string {
  return `envo:auth:${project}/${environment}/v${packVersion}`;
}

interface AuthPayloadEntry extends AuthEntry {
  /** env-kind: captured value. */
  value?: string;
  /** file-kind: captured file content, base64. */
  data?: string;
}

/** Declare that an environment needs a provider credential. */
export async function addAuth(
  root: string,
  provider: string,
  opts: { environment?: string; path?: string } = {},
): Promise<AuthEntry> {
  const known = AUTH_PROVIDERS[provider];
  if (!known && !opts.path) {
    throw new Error(
      `Unknown provider: ${provider}. Known: ${knownAuthProviders().join(", ")} — or pass --path for a custom credential file.`,
    );
  }

  const state = await loadState(root);
  if (!state) throw new Error("Not connected. Run `envo environment create` first.");
  const envName = opts.environment ?? state.environments?.[0]?.name ?? state.profile;
  const env = (state.environments ?? []).find((e) => e.name === envName);
  if (!env) throw new Error(`Environment not found: ${envName}`);

  const entry: AuthEntry = known
    ? {
        provider,
        kind: known.kind,
        envKey: known.envKey,
        targetPath: opts.path ?? known.path,
      }
    : { provider, kind: "file", targetPath: opts.path };

  env.auth = [...(env.auth ?? []).filter((a) => a.provider !== provider), entry];
  await saveState(root, state);
  return entry;
}

/** Capture declared credentials, fresh, into an encrypted auth payload. */
const REFRESH_MARGIN_MS = 15 * 60 * 1000;

export async function captureAuth(
  entries: AuthEntry[],
  envFileBody: string,
  aad: string,
): Promise<{ box: SecretBox; captured: AuthEntry[]; warnings: string[] } | null> {
  if (entries.length === 0) return null;
  const payload: AuthPayloadEntry[] = [];
  const warnings: string[] = [];

  for (const entry of entries) {
    if (entry.kind === "env" && entry.envKey) {
      const fromProcess = process.env[entry.envKey];
      const fromEnvFile = envFileBody
        .split("\n")
        .find((l) => l.startsWith(`${entry.envKey}=`))
        ?.slice(entry.envKey.length + 1);
      const value = fromProcess ?? fromEnvFile;
      if (!value) {
        throw new Error(
          `auth provider "${entry.provider}" needs ${entry.envKey}, which is neither in your environment nor in this environment's secrets. Set it with \`envo secrets set ${entry.envKey}\` or export it before packing.`,
        );
      }
      payload.push({ ...entry, value });
    } else if (entry.kind === "file" && entry.targetPath) {
      const source = expandHome(entry.targetPath);
      if (!existsSync(source)) {
        const note = AUTH_PROVIDERS[entry.provider]?.note;
        throw new Error(
          `auth provider "${entry.provider}": credential file not found at ${source}.${note ? ` ${note}` : ""}`,
        );
      }
      let content = await readFile(source, "utf8");
      const info = inspectAuthContent(entry.provider, content);
      const stale =
        info.expiresAt !== undefined && info.expiresAt - Date.now() < REFRESH_MARGIN_MS;
      if (stale && info.refreshable) {
        try {
          // Refresh before capture so pushes always carry a live token,
          // and keep the local credential file fresh as a side effect.
          const refreshed = await refreshAuthContent(entry.provider, content);
          await writeFile(source, refreshed.content);
          content = refreshed.content;
        } catch (error) {
          warnings.push(
            `${entry.provider}: token ${describeExpiry(info)} and refresh failed (${error instanceof Error ? error.message : error}) — capturing as-is`,
          );
        }
      } else if (stale) {
        warnings.push(`${entry.provider}: token ${describeExpiry(info)} and no refresh adapter — capturing as-is`);
      }
      payload.push({ ...entry, data: Buffer.from(content).toString("base64") });
    }
  }

  const key = await loadMasterKey();
  return {
    box: encrypt(JSON.stringify({ format: "envo-auth-v1", entries: payload }), key, aad),
    captured: entries,
    warnings,
  };
}

/** Materialize an auth payload: env-kind → env file, file-kind → harness paths. */
export async function materializeAuth(
  root: string,
  box: SecretBox,
  manifest: PackManifest,
): Promise<AuthMaterializeResult> {
  const key = await loadMasterKey();
  const payload = JSON.parse(
    decrypt(box, key, authAad(manifest.project, manifest.environment, manifest.packVersion)).toString("utf8"),
  ) as { entries: AuthPayloadEntry[] };

  const materialized: string[] = [];
  const skipped: string[] = [];

  const envFile = join(envLayerDir(root), `${manifest.environment}.local`);
  let envBody = existsSync(envFile) ? await readFile(envFile, "utf8") : "";

  for (const entry of payload.entries) {
    if (entry.kind === "env" && entry.envKey && entry.value !== undefined) {
      if (envBody.split("\n").some((l) => l.startsWith(`${entry.envKey}=`))) {
        skipped.push(`${entry.provider} (${entry.envKey} already present)`);
        continue;
      }
      envBody = `${envBody.trimEnd()}\n${entry.envKey}=${entry.value}\n`;
      await writeFile(envFile, envBody.replace(/^\n/, ""));
      materialized.push(`${entry.provider} → ${entry.envKey}`);
    } else if (entry.kind === "file" && entry.targetPath && entry.data !== undefined) {
      const dest = expandHome(entry.targetPath);
      if (!isAbsolute(dest)) {
        skipped.push(`${entry.provider} (relative path refused)`);
        continue;
      }
      if (existsSync(dest)) {
        const existing = inspectAuthContent(entry.provider, await readFile(dest, "utf8"));
        const incomingContent = Buffer.from(entry.data, "base64").toString("utf8");
        const incoming = inspectAuthContent(entry.provider, incomingContent);
        const incomingFresher =
          existing.expired &&
          !incoming.expired &&
          (incoming.expiresAt === undefined ||
            existing.expiresAt === undefined ||
            incoming.expiresAt > existing.expiresAt);
        if (!incomingFresher) {
          skipped.push(`${entry.provider} (${entry.targetPath} exists — not overwriting)`);
          continue;
        }
        // A live captured token beats a dead local one; keep a backup.
        await writeFile(`${dest}.bak`, await readFile(dest));
        await writeFile(dest, incomingContent);
        await chmod(dest, 0o600);
        materialized.push(`${entry.provider} → ${dest} (replaced expired token; backup at ${dest}.bak)`);
        continue;
      }
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(dest, Buffer.from(entry.data, "base64"));
      await chmod(dest, 0o600);
      materialized.push(`${entry.provider} → ${dest}`);
    }
  }

  return { materialized, skipped };
}
