import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import {
  bundleAad,
  extractBundle,
  fetchPack,
  materializePack,
  runDoctor,
  type MaterializeResult,
} from "@envo/core";
import { defineCommand } from "citty";
import { consola } from "consola";

/** Parse a materialized env file into a vars map for the launched process. */
function parseEnvFile(body: string): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const line of body.split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq);
    const raw = line.slice(eq + 1);
    vars[key] = raw.startsWith('"') ? (JSON.parse(raw) as string) : raw;
  }
  return vars;
}

export const upCommand = defineCommand({
  meta: {
    description:
      "One command to a working agent: fetch a pack, materialize it, verify, and launch",
  },
  args: {
    ref: {
      type: "positional",
      description: "Registry ref (project/environment) or a local .envopack file",
      required: true,
    },
    dir: {
      type: "string",
      description: "Directory to materialize into (defaults to current directory)",
    },
    registry: {
      type: "string",
      description: "Registry URL (or ENVO_REGISTRY)",
    },
    run: {
      type: "string",
      description: "Command to launch once the environment is ready",
    },
    harness: {
      type: "string",
      description:
        "Override the pack's harness for skill placement (claude-code, codex, opencode, cursor, pi, hermes, shell)",
    },
    runtime: {
      type: "string",
      description: "Deprecated alias for --harness",
    },
    json: {
      type: "boolean",
      default: false,
      description: "Machine-readable output",
    },
  },
  async run({ args }) {
    const dir = resolve(args.dir ?? ".");

    const fromFile = existsSync(args.ref);
    const blob = fromFile
      ? await readFile(args.ref)
      : await fetchPack(args.ref, { registry: args.registry });

    // Registry blobs are cryptographically bound to their ref: a swapped or
    // mis-served blob fails authentication instead of materializing.
    const packDir = await extractBundle(blob, fromFile ? {} : { aad: bundleAad(args.ref) });
    let result: MaterializeResult;
    try {
      result = await materializePack(dir, packDir, { harness: args.harness ?? args.runtime });
    } finally {
      await rm(packDir, { recursive: true, force: true });
    }

    const report = await runDoctor(dir);

    if (args.json) {
      console.log(
        JSON.stringify(
          {
            ref: args.ref,
            environment: result.manifest.environment,
            version: result.manifest.packVersion,
            dir,
            envFile: result.envFile,
            secretKeys: result.manifest.secretKeys,
            skills: result.skills,
            refSkills: result.refSkills,
            runtime: result.runtime,
            contextFiles: result.contextFiles,
            doctor: report,
          },
          null,
          2,
        ),
      );
    } else {
      consola.success(
        `up: ${result.manifest.environment} v${result.manifest.packVersion} → ${dir}`,
      );
      consola.info(`secrets → ${result.envFile} (${result.manifest.secretKeys.join(", ")})`);
      for (const skill of result.skills) consola.info(`skill   → ${skill}`);
      for (const ctx of result.contextFiles) consola.info(`context → ${ctx}`);
      for (const a of result.auth?.materialized ?? []) consola.info(`auth    → ${a}`);
      for (const a of result.auth?.skipped ?? []) consola.warn(`auth skipped: ${a}`);
      for (const check of report.checks) {
        (check.ok ? consola.success : consola.warn)(check.message);
      }
    }

    if (!report.ok && !args.run) {
      process.exitCode = 1;
      return;
    }

    if (args.run) {
      const envVars = parseEnvFile(await readFile(result.envFile, "utf8"));
      consola.info(`launching: ${args.run}`);
      const proc = Bun.spawn(["sh", "-c", args.run], {
        cwd: dir,
        env: { ...process.env, ...envVars },
        stdio: ["inherit", "inherit", "inherit"],
      });
      process.exitCode = await proc.exited;
    }
  },
});
