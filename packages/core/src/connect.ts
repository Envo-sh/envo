import type { EnvoState } from "./types.ts";
import { findProjectRoot } from "./paths.ts";
import { defaultState, loadState, saveState } from "./state.ts";

export interface ConnectOptions {
  profile?: string;
  projectName?: string;
  account?: string;
}

export interface ConnectResult {
  root: string;
  state: EnvoState;
  created: boolean;
}

export async function connect(cwd: string, opts: ConnectOptions = {}): Promise<ConnectResult> {
  const root = findProjectRoot(cwd);
  const existing = await loadState(root);
  const created = existing === null;

  const state: EnvoState = existing ?? defaultState(opts.profile ?? "dev");

  if (opts.profile) state.profile = opts.profile;
  if (opts.projectName) state.projectName = opts.projectName;
  if (!state.projectId) {
    state.projectId = `local-${crypto.randomUUID().slice(0, 8)}`;
  }
  if (!state.connectedAt) {
    state.connectedAt = new Date().toISOString();
  }

  if (opts.account) {
    const id = `${opts.account}-${crypto.randomUUID().slice(0, 6)}`;
    if (!state.accounts.some((a) => a.provider === opts.account)) {
      state.accounts.push({
        id,
        kind: "oauth",
        label: opts.account,
        provider: opts.account,
      });
    }
  }

  await saveState(root, state);

  return { root, state, created };
}
