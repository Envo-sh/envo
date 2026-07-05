import { registryUrl } from "./registry.ts";
import { loadCliConfig } from "./config.ts";
import { loadMasterKey } from "./crypto.ts";

export interface SandboxInfo {
  id: string;
  name: string;
  slug: string;
  status: string;
  url: string | null;
  error: string | null;
  created_at: string;
  environment_slug: string | null;
  project_slug: string | null;
}

async function authHeader(token?: string): Promise<Record<string, string>> {
  const resolved = token ?? process.env.ENVO_TOKEN ?? (await loadCliConfig()).token;
  if (!resolved) throw new Error("No agent token. Run `envo login` or set ENVO_TOKEN.");
  return { authorization: `Bearer ${resolved}` };
}

async function sandboxFetch(
  path: string,
  init: RequestInit,
  opts: { registry?: string; token?: string },
): Promise<Response> {
  const res = await fetch(`${registryUrl(opts.registry)}/v1/sandboxes${path}`, {
    ...init,
    headers: { ...(init.headers as Record<string, string>), ...(await authHeader(opts.token)) },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Sandbox API error (${res.status})`);
  }
  return res;
}

/**
 * Deploy a hosted sandbox for an environment. The local master key is
 * forwarded so the edge worker can decrypt packs; the server stores it only
 * as a Cloudflare secret binding on the worker itself.
 */
export async function createSandbox(
  ref: string,
  opts: { name?: string; registry?: string; token?: string } = {},
): Promise<{ id: string; slug: string; url: string; status: string }> {
  const key = await loadMasterKey();
  const res = await sandboxFetch(
    "",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ref, name: opts.name, envoKey: key.toString("hex") }),
    },
    opts,
  );
  return (await res.json()) as { id: string; slug: string; url: string; status: string };
}

export async function listSandboxes(
  opts: { registry?: string; token?: string } = {},
): Promise<{ sandboxes: SandboxInfo[]; enabled: boolean }> {
  const res = await sandboxFetch("", { method: "GET" }, opts);
  return (await res.json()) as { sandboxes: SandboxInfo[]; enabled: boolean };
}

export async function deleteSandbox(
  idOrSlug: string,
  opts: { registry?: string; token?: string } = {},
): Promise<void> {
  await sandboxFetch(`/${encodeURIComponent(idOrSlug)}`, { method: "DELETE" }, opts);
}
