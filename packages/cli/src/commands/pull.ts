import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { findProjectRoot, latestPackDir, materializePack } from "@envo/core";
import { defineCommand } from "citty";
import { consola } from "consola";

export const pullCommand = defineCommand({
  meta: {
    description: "Materialize a pack: secrets → .env.d, skills → .envo/skills",
  },
  args: {
    source: {
      type: "positional",
      description: "Pack directory, or an environment name to pull its latest local pack",
      required: false,
    },
  },
  async run({ args }) {
    const root = findProjectRoot();

    let packDir: string | null = null;
    if (args.source) {
      const asPath = resolve(args.source);
      packDir = existsSync(`${asPath}/manifest.json`)
        ? asPath
        : latestPackDir(root, args.source);
      if (!packDir) {
        throw new Error(
          `No pack found for "${args.source}" — pass a pack directory or an environment with local packs.`,
        );
      }
    } else {
      throw new Error("Usage: envo pull <pack-dir | environment>");
    }

    const result = await materializePack(root, packDir);

    consola.success(
      `pulled ${result.manifest.environment} v${result.manifest.packVersion} (${result.manifest.project})`,
    );
    consola.info(`secrets → ${result.envFile} (${result.manifest.secretKeys.length} key(s))`);
    for (const skill of result.skills) consola.info(`skill   → ${skill}`);
    if (result.refSkills.length) {
      consola.warn(`skill refs to resolve manually: ${result.refSkills.join(", ")}`);
    }
    consola.log("\nNext: envo doctor");
  },
});
