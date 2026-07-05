import { mkdir, readFile, writeFile, chmod } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { globalConfigDir } from "./paths.ts";

export interface CliConfig {
  registry?: string;
  token?: string;
}

export function cliConfigPath(): string {
  return join(globalConfigDir(), "config.json");
}

export async function loadCliConfig(): Promise<CliConfig> {
  const path = cliConfigPath();
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(await readFile(path, "utf8")) as CliConfig;
  } catch {
    return {};
  }
}

export async function saveCliConfig(config: CliConfig): Promise<void> {
  await mkdir(globalConfigDir(), { recursive: true });
  const path = cliConfigPath();
  await writeFile(path, JSON.stringify(config, null, 2) + "\n");
  await chmod(path, 0o600);
}
