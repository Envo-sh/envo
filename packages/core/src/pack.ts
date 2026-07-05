import { cp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import type {
  EnvoEnvironment,
  MaterializeResult,
  PackManifest,
  PackResult,
  PackSkill,
} from "./types.ts";
import { decrypt, encrypt, loadMasterKey, packAad, type SecretBox } from "./crypto.ts";
import { authAad, captureAuth, materializeAuth } from "./auth.ts";
import { harnessTarget, manifestHarness, renderEnvironmentContext } from "./runtime.ts";
import { envLayerDir, envoDir } from "./paths.ts";
import { loadState, saveState } from "./state.ts";

export function packsDir(root: string): string {
  return join(envoDir(root), "packs");
}

export function skillsDir(root: string): string {
  return join(envoDir(root), "skills");
}

function parseEnvKeys(envBody: string): string[] {
  return envBody
    .split("\n")
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .map((line) => line.slice(0, line.indexOf("=")))
    .filter(Boolean);
}

function resolveEnvironment(
  environments: EnvoEnvironment[],
  name?: string,
): EnvoEnvironment {
  const env = name
    ? environments.find((e) => e.name === name)
    : environments[0];
  if (!env) {
    throw new Error(
      name
        ? `Environment not found: ${name}`
        : "No environments defined. Run `envo environment create` first.",
    );
  }
  return env;
}

/**
 * Snapshot one environment into an immutable encrypted pack directory:
 *
 *   .envo/packs/<env>/v<N>/
 *     manifest.json   project, environment, runtime, secret key names, skills
 *     secrets.enc     encrypted env file body (AES-256-GCM, local master key)
 *     skills/<name>/  bundled copies of path-based skills
 *
 * The pack directory is the portable artifact: copy it (plus the key, or
 * ENVO_KEY) to any machine and `envo pull <dir>` materializes it.
 */
export async function createPack(root: string, environment?: string): Promise<PackResult> {
  const state = await loadState(root);
  if (!state) {
    throw new Error("Not connected. Run `envo environment create` first.");
  }

  const env = resolveEnvironment(state.environments ?? [], environment);
  const envFile = join(root, env.envFile);
  const envBody = existsSync(envFile) ? await readFile(envFile, "utf8") : "";
  if (!envBody.trim() && env.skills.length === 0) {
    throw new Error(
      `Nothing to pack for ${env.name}: no secrets in ${env.envFile} and no skills attached.`,
    );
  }

  const envPacksDir = join(packsDir(root), env.name);
  await mkdir(envPacksDir, { recursive: true });
  const existing = await readdir(envPacksDir);
  const version =
    existing
      .map((name) => Number(name.replace(/^v/, "")))
      .filter((n) => Number.isInteger(n) && n > 0)
      .reduce((a, b) => Math.max(a, b), 0) + 1;
  const packDir = join(envPacksDir, `v${version}`);
  await mkdir(join(packDir, "skills"), { recursive: true });

  const skills: PackSkill[] = [];
  for (const skill of env.skills) {
    const source = isAbsolute(skill) ? skill : resolve(root, skill);
    if (existsSync(source) && statSync(source).isDirectory()) {
      const name = basename(source);
      // dereference: skill dirs are often symlinks (e.g. Hermes skill trees)
      await cp(source, join(packDir, "skills", name), { recursive: true, dereference: true });
      skills.push({ name, kind: "bundled" });
    } else {
      skills.push({ name: skill, kind: "ref" });
    }
  }

  const key = await loadMasterKey();
  const project = state.projectName ?? env.name;
  await writeFile(
    join(packDir, "secrets.enc"),
    JSON.stringify(encrypt(envBody, key, packAad(project, env.name, version)), null, 2),
  );

  const auth = await captureAuth(env.auth ?? [], envBody, authAad(project, env.name, version));
  if (auth) {
    await writeFile(join(packDir, "auth.enc"), JSON.stringify(auth.box, null, 2));
  }
  const warnings = auth?.warnings ?? [];

  const manifest: PackManifest = {
    version: 1,
    packVersion: version,
    project,
    environment: env.name,
    profile: env.profile,
    harness: env.agent,
    runtime: env.agent,
    target: env.target,
    secretKeys: parseEnvKeys(envBody),
    requiredKeys: env.requiredKeys ?? [],
    skills,
    auth: (env.auth ?? []).map(({ provider, kind, envKey, targetPath }) => ({ provider, kind, envKey, targetPath })),
    createdAt: new Date().toISOString(),
  };
  await writeFile(join(packDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

  state.lastPack = { environment: env.name, version, dir: packDir, createdAt: manifest.createdAt };
  await saveState(root, state);

  return { manifest, dir: packDir, warnings };
}

export async function readManifest(packDir: string): Promise<PackManifest> {
  const path = join(packDir, "manifest.json");
  if (!existsSync(path)) {
    throw new Error(`Not a pack: missing ${path}`);
  }
  return JSON.parse(await readFile(path, "utf8")) as PackManifest;
}

export function latestPackDir(root: string, environment: string): string | null {
  const envPacksDir = join(packsDir(root), environment);
  if (!existsSync(envPacksDir)) return null;
  const versions = readdirSync(envPacksDir)
    .map((name) => Number(name.replace(/^v/, "")))
    .filter((n) => Number.isInteger(n) && n > 0)
    .sort((a, b) => b - a);
  return versions.length ? join(envPacksDir, `v${versions[0]}`) : null;
}

/**
 * Materialize a pack into a project root:
 *   secrets  → .env.d/<environment>.local
 *   skills   → .envo/skills/<name>/ plus the runtime's native skills dir
 *   context  → .envo/ENVIRONMENT.md, and CLAUDE.md/AGENTS.md if absent
 *   state    → .envo/state.json records environment + pack version
 */
export async function materializePack(
  root: string,
  packDir: string,
  opts: { harness?: string; runtime?: string } = {},
): Promise<MaterializeResult> {
  const manifest = await readManifest(packDir);
  const key = await loadMasterKey();
  const box = JSON.parse(await readFile(join(packDir, "secrets.enc"), "utf8")) as SecretBox;

  let envBody: string;
  try {
    envBody = decrypt(box, key, packAad(manifest.project, manifest.environment, manifest.packVersion)).toString("utf8");
  } catch {
    throw new Error(
      "Failed to decrypt pack secrets. Set ENVO_KEY to the key that created this pack, or copy ~/.config/envo/master.key from the source machine.",
    );
  }

  await mkdir(envLayerDir(root), { recursive: true });
  const envFile = join(envLayerDir(root), `${manifest.environment}.local`);
  await writeFile(envFile, envBody.endsWith("\n") || !envBody ? envBody : `${envBody}\n`);

  const harness = opts.harness ?? opts.runtime ?? manifestHarness(manifest);
  const target = harnessTarget(harness);
  const harnessSkillsDir = target.skillsDir(root);

  const materializedSkills: string[] = [];
  for (const skill of manifest.skills) {
    if (skill.kind !== "bundled") continue;
    const source = join(packDir, "skills", skill.name);
    const dest = join(skillsDir(root), skill.name);
    await mkdir(skillsDir(root), { recursive: true });
    await cp(source, dest, { recursive: true, force: true });
    materializedSkills.push(dest);
    if (harnessSkillsDir) {
      const harnessDest = join(harnessSkillsDir, skill.name);
      await mkdir(harnessSkillsDir, { recursive: true });
      await cp(source, harnessDest, { recursive: true, force: true });
      materializedSkills.push(harnessDest);
    }
  }

  const contextBody = renderEnvironmentContext(manifest, {
    envFile: join(envLayerDir(root), `${manifest.environment}.local`).replace(`${root}/`, ""),
    skillDirs: materializedSkills,
    harness,
  });
  const contextFiles: string[] = [];
  await mkdir(envoDir(root), { recursive: true });
  await writeFile(
    join(envoDir(root), "schema.json"),
    JSON.stringify(
      {
        environment: manifest.environment,
        packVersion: manifest.packVersion,
        requiredKeys: manifest.requiredKeys ?? [],
        secretKeys: manifest.secretKeys,
        auth: manifest.auth ?? [],
      },
      null,
      2,
    ) + "\n",
  );
  await writeFile(join(envoDir(root), "ENVIRONMENT.md"), contextBody);
  contextFiles.push(join(envoDir(root), "ENVIRONMENT.md"));
  if (target.contextFile) {
    const harnessContext = join(root, target.contextFile);
    if (!existsSync(harnessContext)) {
      await mkdir(dirname(harnessContext), { recursive: true });
      await writeFile(harnessContext, contextBody);
      contextFiles.push(harnessContext);
    }
  }

  let authResult;
  const authPath = join(packDir, "auth.enc");
  if (existsSync(authPath)) {
    const authBox = JSON.parse(await readFile(authPath, "utf8")) as SecretBox;
    authResult = await materializeAuth(root, authBox, manifest);
  }

  const state = (await loadState(root)) ?? {
    version: 1 as const,
    profile: manifest.profile,
    accounts: [],
    agents: [],
    apiBase: process.env.ENVO_API_BASE ?? "https://api.envo.sh",
  };
  state.projectName ??= manifest.project;
  state.profile = manifest.profile;
  const environments = state.environments ?? [];
  if (!environments.some((e) => e.name === manifest.environment)) {
    environments.push({
      id: `env-${crypto.randomUUID().slice(0, 8)}`,
      name: manifest.environment,
      profile: manifest.profile,
      target: manifest.target,
      agent: manifest.runtime,
      skills: manifest.skills.map((s) => s.name),
      envFile: `.env.d/${manifest.environment}.local`,
      createdAt: manifest.createdAt,
    });
    state.environments = environments;
  }
  state.lastPull = {
    environment: manifest.environment,
    version: manifest.packVersion,
    dir: packDir,
    pulledAt: new Date().toISOString(),
  };
  await saveState(root, state);

  return {
    manifest,
    envFile,
    skills: materializedSkills,
    refSkills: manifest.skills.filter((s) => s.kind === "ref").map((s) => s.name),
    runtime: harness,
    contextFiles,
    auth: authResult,
  };
}
