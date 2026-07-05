import { mkdir } from "node:fs/promises";
import type { DoctorCheck, DoctorReport } from "./types.ts";
import { latestPackDir } from "./pack.ts";
import { envLayerDir, envoDir } from "./paths.ts";
import { loadState } from "./state.ts";
import { expandHome } from "./auth.ts";
import { describeExpiry, inspectAuthContent } from "./refresh.ts";
import type { AuthEntry } from "./types.ts";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

async function exists(path: string): Promise<boolean> {
  return Bun.file(path).exists();
}

export async function runDoctor(root: string): Promise<DoctorReport> {
  const state = await loadState(root);
  const profile = state?.profile ?? "dev";
  const checks: DoctorCheck[] = [];

  checks.push({
    id: "project",
    ok: state !== null || (await exists(`${root}/envo.toml`)),
    message: state ? "Project connected" : "No Envo project here",
    hint: "Run `envo connect`",
  });

  checks.push({
    id: "state",
    ok: state !== null,
    message: "Local Envo state present",
    hint: "Run `envo connect`",
  });

  checks.push({
    id: "profile",
    ok: Boolean(profile),
    message: `Active profile: ${profile}`,
  });

  const envFile = `${envLayerDir(root)}/${profile}.local`;
  checks.push({
    id: "secrets",
    ok: await exists(envFile),
    message: (await exists(envFile))
      ? "Materialized secrets on disk"
      : "No materialized secrets",
    hint: "Run `envo pull <environment>` or `envo secrets set <KEY>`",
  });

  const environmentName = state?.environments?.[0]?.name ?? profile;
  const packDir = latestPackDir(root, environmentName);
  checks.push({
    id: "pack",
    ok: packDir !== null || Boolean(state?.lastPull),
    message: packDir
      ? `Latest pack: ${packDir.split("/").slice(-2).join("/")}`
      : state?.lastPull
        ? `Pulled ${state.lastPull.environment} v${state.lastPull.version}`
        : "No pack for this environment",
    hint: "Run `envo pack`",
  });

  // Required keys come from the pulled pack schema, or local declarations.
  let requiredKeys: string[] = state?.environments?.[0]?.requiredKeys ?? [];
  const schemaPath = join(envoDir(root), "schema.json");
  if (await exists(schemaPath)) {
    try {
      const schema = JSON.parse(await readFile(schemaPath, "utf8")) as { requiredKeys?: string[] };
      if (schema.requiredKeys?.length) requiredKeys = schema.requiredKeys;
    } catch {
      // unreadable schema is reported via the secrets check below
    }
  }
  if (requiredKeys.length > 0) {
    const presentKeys = new Set(
      ((await exists(envFile)) ? await readFile(envFile, "utf8") : "")
        .split("\n")
        .filter((line) => line && !line.startsWith("#") && line.includes("="))
        .map((line) => line.slice(0, line.indexOf("="))),
    );
    const missing = requiredKeys.filter((key) => !presentKeys.has(key));
    checks.push({
      id: "required-keys",
      ok: missing.length === 0,
      message:
        missing.length === 0
          ? `All ${requiredKeys.length} required key(s) present`
          : `Missing required key(s): ${missing.join(", ")}`,
      hint:
        missing.length === 0
          ? undefined
          : `Set on the source machine: ${missing.map((k) => `envo secrets set ${k}`).join(" && ")} && envo push`,
    });
  }

  // Layer-1 auth: each declared provider credential must be materialized.
  let authEntries: AuthEntry[] = state?.environments?.[0]?.auth ?? [];
  if (await exists(schemaPath)) {
    try {
      const schema = JSON.parse(await readFile(schemaPath, "utf8")) as { auth?: AuthEntry[] };
      if (schema.auth?.length) authEntries = schema.auth;
    } catch {
      // reported via the secrets check
    }
  }
  if (authEntries.length > 0) {
    const envBody = (await exists(envFile)) ? await readFile(envFile, "utf8") : "";
    const missing: string[] = [];
    for (const a of authEntries) {
      if (a.kind === "env" && a.envKey) {
        if (!envBody.split("\n").some((l) => l.startsWith(`${a.envKey}=`))) missing.push(`${a.provider} (${a.envKey})`);
      } else if (a.kind === "file" && a.targetPath) {
        const dest = expandHome(a.targetPath);
        if (!(await exists(dest))) {
          missing.push(`${a.provider} (${a.targetPath})`);
        } else {
          const info = inspectAuthContent(a.provider, await readFile(dest, "utf8"));
          if (info.expired) missing.push(`${a.provider} (token ${describeExpiry(info)})`);
        }
      }
    }
    checks.push({
      id: "auth",
      ok: missing.length === 0,
      message:
        missing.length === 0
          ? `${authEntries.length} provider credential(s) in place`
          : `Missing provider auth: ${missing.join(", ")}`,
      hint: missing.length ? "Re-run `envo up <ref>` or `envo auth add` on the source machine and push" : undefined,
    });
  }

  const skills = state?.environments?.flatMap((env) => env.skills) ?? [];
  checks.push({
    id: "skills",
    ok: true,
    message: skills.length
      ? `${skills.length} skill(s) attached`
      : "No skills attached (optional)",
    hint: skills.length ? undefined : "Run `envo skills add <path>`",
  });

  await mkdir(envLayerDir(root), { recursive: true });

  return {
    ok: checks.every((c) => c.ok),
    profile,
    root,
    checks,
  };
}
