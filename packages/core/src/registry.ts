import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { globalConfigDir } from "./paths.ts";

export interface PushResult {
  ref: string;
  version: number;
}

const DEFAULT_REGISTRY = "https://envo.sh/api";

function configValue(key: "registry" | "token"): string | undefined {
  const path = join(globalConfigDir(), "config.json");
  if (!existsSync(path)) return undefined;
  try {
    const config = JSON.parse(readFileSync(path, "utf8")) as Record<string, string>;
    return config[key];
  } catch {
    return undefined;
  }
}

export function registryUrl(override?: string): string {
  return (
    override ??
    process.env.ENVO_REGISTRY ??
    configValue("registry") ??
    DEFAULT_REGISTRY
  ).replace(/\/$/, "");
}

export function authHeaders(token?: string): Record<string, string> {
  const resolved = token ?? process.env.ENVO_TOKEN ?? configValue("token");
  return resolved ? { authorization: `Bearer ${resolved}` } : {};
}

const MAX_PUSH_BYTES = 4 * 1024 * 1024;

export async function pushPack(
  ref: string,
  blob: Buffer,
  opts: { registry?: string; token?: string } = {},
): Promise<PushResult> {
  if (blob.length > MAX_PUSH_BYTES) {
    throw new Error(
      `Pack is ${(blob.length / 1024 / 1024).toFixed(1)}MB; the hosted registry accepts up to 4MB. ` +
        "Trim large files from bundled skills, or keep big bundles as local packs.",
    );
  }
  const res = await fetch(`${registryUrl(opts.registry)}/v1/packs/${ref}`, {
    method: "PUT",
    headers: { "content-type": "application/octet-stream", ...authHeaders(opts.token) },
    body: new Uint8Array(blob),
  });
  if (!res.ok) {
    throw new Error(`Push failed (${res.status}): ${await res.text()}`);
  }
  return (await res.json()) as PushResult;
}

export async function fetchPack(
  ref: string,
  opts: { registry?: string; token?: string } = {},
): Promise<Buffer> {
  const res = await fetch(`${registryUrl(opts.registry)}/v1/packs/${ref}/latest`, {
    headers: authHeaders(opts.token),
  });
  if (res.status === 404) {
    throw new Error(`No pack published at ${ref}`);
  }
  if (!res.ok) {
    throw new Error(`Pull failed (${res.status}): ${await res.text()}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

export async function whoami(
  opts: { registry?: string; token?: string } = {},
): Promise<{ kind: string; name?: string; scope?: string; email?: string }> {
  const res = await fetch(`${registryUrl(opts.registry)}/v1/whoami`, {
    headers: authHeaders(opts.token),
  });
  if (!res.ok) {
    throw new Error(`Not authenticated (${res.status}). Run \`envo login\`.`);
  }
  return (await res.json()) as { kind: string; name?: string; scope?: string };
}
