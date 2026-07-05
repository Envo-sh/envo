import {
  bundleAad,
  createBundle,
  createPack,
  findProjectRoot,
  latestPackDir,
  loadState,
  pushPack,
} from "@envo/core";
import { defineCommand } from "citty";
import { consola } from "consola";

export const pushCommand = defineCommand({
  meta: {
    description: "Bundle the latest pack and publish it to a registry",
  },
  args: {
    environment: {
      type: "string",
      description: "Environment to push (defaults to the first environment)",
    },
    ref: {
      type: "string",
      description: "Registry ref (defaults to <project>/<environment>)",
    },
    registry: {
      type: "string",
      description: "Registry URL (or ENVO_REGISTRY)",
    },
    pack: {
      type: "boolean",
      default: true,
      description: "Create a fresh pack before pushing (--no-pack to reuse latest)",
    },
  },
  async run({ args }) {
    const root = findProjectRoot();
    const state = await loadState(root);
    if (!state) {
      throw new Error("Not connected. Run `envo environment create` first.");
    }

    const envName = args.environment ?? state.environments?.[0]?.name ?? state.profile;
    let packDir: string | null;
    if (args.pack) {
      const packed = await createPack(root, envName);
      for (const w of packed.warnings ?? []) consola.warn(w);
      packDir = packed.dir;
    } else {
      packDir = latestPackDir(root, envName);
    }
    if (!packDir) {
      throw new Error(`No pack for ${envName}. Run \`envo pack\` first.`);
    }

    const ref = args.ref ?? `${state.projectName ?? "project"}/${envName}`;
    const blob = await createBundle(packDir, { aad: bundleAad(ref) });
    const result = await pushPack(ref, blob, { registry: args.registry });

    consola.success(`pushed ${result.ref} v${result.version} (${blob.length} bytes, encrypted)`);
    consola.log(`\nOn any machine:\n  ENVO_KEY=<your key> envo up ${result.ref}`);
  },
});
