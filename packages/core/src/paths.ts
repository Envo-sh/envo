import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const ENVO_DIR = ".envo";
export const STATE_FILE = "state.json";
export const LOCK_FILE = "lock.json";
export const ENV_LAYER_DIR = ".env.d";

export function findProjectRoot(start = process.cwd()): string {
  let dir = start;
  for (;;) {
    if (existsSync(join(dir, "envo.toml"))) return dir;
    if (existsSync(join(dir, ENVO_DIR, STATE_FILE))) return dir;
    const parent = join(dir, "..");
    if (parent === dir) return start;
    dir = parent;
  }
}

export function envoDir(root: string): string {
  return join(root, ENVO_DIR);
}

export function statePath(root: string): string {
  return join(envoDir(root), STATE_FILE);
}

export function lockPath(root: string): string {
  return join(envoDir(root), LOCK_FILE);
}

export function envLayerDir(root: string): string {
  return join(root, ENV_LAYER_DIR);
}

export function globalConfigDir(): string {
  return join(homedir(), ".config", "envo");
}
