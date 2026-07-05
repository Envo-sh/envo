import { mkdir } from "node:fs/promises";
import type { EnvoState } from "./types.ts";
import { envoDir, statePath } from "./paths.ts";

const DEFAULT_API_BASE = "https://api.envo.sh";

export function defaultState(profile = "dev"): EnvoState {
  return {
    version: 1,
    profile,
    accounts: [],
    agents: [],
    apiBase: process.env.ENVO_API_BASE ?? DEFAULT_API_BASE,
  };
}

export async function loadState(root: string): Promise<EnvoState | null> {
  const path = statePath(root);
  const file = Bun.file(path);
  if (!(await file.exists())) return null;
  return (await file.json()) as EnvoState;
}

export async function saveState(root: string, state: EnvoState): Promise<void> {
  const dir = envoDir(root);
  await mkdir(dir, { recursive: true });
  await Bun.write(statePath(root), JSON.stringify(state, null, 2) + "\n");
}

export async function ensureState(root: string, profile?: string): Promise<EnvoState> {
  const existing = await loadState(root);
  if (existing) return existing;
  const state = defaultState(profile);
  await saveState(root, state);
  return state;
}
