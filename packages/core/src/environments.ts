import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { EnvoEnvironment } from "./types.ts";
import { connect } from "./connect.ts";
import { envLayerDir, findProjectRoot } from "./paths.ts";
import { loadState, saveState } from "./state.ts";

export interface EnvironmentCreateOptions {
  name?: string;
  profile?: string;
  target?: string;
  agent?: string;
  skills?: string[];
  yes?: boolean;
}

export interface EnvironmentCreateResult {
  root: string;
  projectName: string;
  environment: EnvoEnvironment;
  configPath: string;
}

export async function createEnvironment(
  cwd: string,
  opts: EnvironmentCreateOptions = {},
): Promise<EnvironmentCreateResult> {
  const root = findProjectRoot(cwd);
  const target = opts.target ?? "local";
  const agent = opts.agent ?? "codex";
  const projectName = root.split("/").filter(Boolean).at(-1) ?? "envo-project";
  const name = opts.name ?? projectName;
  const profile = opts.profile ?? name;
  const connected = await connect(root, { profile, projectName });
  const state = connected.state;

  const environment: EnvoEnvironment = {
    id: `env-${crypto.randomUUID().slice(0, 8)}`,
    name,
    profile,
    target,
    agent,
    skills: opts.skills ?? [],
    envFile: `${envLayerDir(connected.root).replace(`${connected.root}/`, "")}/${profile}.local`,
    createdAt: new Date().toISOString(),
  };

  const environments = state.environments ?? [];
  const existingIndex = environments.findIndex((env) => env.name === name);
  state.environments =
    existingIndex >= 0
      ? environments.map((env, index) => (index === existingIndex ? environment : env))
      : [...environments, environment];
  state.profile = profile;
  await saveState(connected.root, state);

  const configPath = join(connected.root, "envo.toml");
  if (opts.yes || !(await Bun.file(configPath).exists())) {
    await writeEnvironmentConfig(connected.root, state.projectName ?? projectName, state.environments);
  }

  return {
    root: connected.root,
    projectName: state.projectName ?? projectName,
    environment,
    configPath,
  };
}

export async function listEnvironments(cwd: string): Promise<EnvoEnvironment[]> {
  const root = findProjectRoot(cwd);
  const state = await loadState(root);
  return state?.environments ?? [];
}

export async function writeEnvironmentConfig(
  root: string,
  projectName: string,
  environments: EnvoEnvironment[],
): Promise<void> {
  await writeFile(join(root, "envo.toml"), renderConfig(projectName, environments));
}

function renderConfig(projectName: string, environments: EnvoEnvironment[]): string {
  const defaultEnvironment = environments[0]?.name ?? projectName;
  const lines = [
    `name = "${projectName}"`,
    `default_environment = "${defaultEnvironment}"`,
    "",
  ];

  for (const env of environments) {
    lines.push(`[environments.${env.name}]`);
    lines.push(`profile = "${env.profile}"`);
    lines.push(`target = "${env.target}"`);
    lines.push(`agent = "${env.agent}"`);
    lines.push(`skills = [${env.skills.map((skill) => `"${skill}"`).join(", ")}]`);
    lines.push(`env_file = "${env.envFile}"`);
    lines.push("");
  }

  lines.push("[secrets]");
  lines.push(`# OPENAI_API_KEY = { environment = "${defaultEnvironment}" }`);
  lines.push(`# GITHUB_TOKEN = { environment = "${defaultEnvironment}" }`);
  lines.push("");

  return lines.join("\n");
}
