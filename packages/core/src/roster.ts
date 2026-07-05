import { registryUrl } from "./registry.ts";
import { loadCliConfig } from "./config.ts";

export interface RosterAgent {
  id: string;
  name: string;
  slug: string;
  status: string;
  created_at: string;
  retired_at: string | null;
  environment_slug: string | null;
  project_slug: string | null;
  token_prefix: string | null;
  last_used_at: string | null;
  pulls: number;
}

export interface HireResult {
  agent: { id: string; name: string; slug: string; environment: string };
  token: string;
  tokenPrefix: string;
  bootstrap: string;
}

async function rosterFetch(
  path: string,
  init: RequestInit,
  opts: { registry?: string; token?: string },
): Promise<Response> {
  const token = opts.token ?? process.env.ENVO_TOKEN ?? (await loadCliConfig()).token;
  if (!token) throw new Error("No agent token. Run `envo login` or set ENVO_TOKEN.");
  const res = await fetch(`${registryUrl(opts.registry)}/v1/agents${path}`, {
    ...init,
    headers: { ...(init.headers as Record<string, string>), authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Roster API error (${res.status})`);
  }
  return res;
}

export async function hireAgent(
  name: string,
  ref: string,
  opts: { registry?: string; token?: string } = {},
): Promise<HireResult> {
  const res = await rosterFetch(
    "",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, ref }),
    },
    opts,
  );
  return (await res.json()) as HireResult;
}

export async function listAgents(
  opts: { registry?: string; token?: string } = {},
): Promise<RosterAgent[]> {
  const res = await rosterFetch("", { method: "GET" }, opts);
  return ((await res.json()) as { agents: RosterAgent[] }).agents;
}

export async function retireAgent(
  idOrSlug: string,
  opts: { registry?: string; token?: string } = {},
): Promise<void> {
  await rosterFetch(`/${encodeURIComponent(idOrSlug)}`, { method: "DELETE" }, opts);
}
