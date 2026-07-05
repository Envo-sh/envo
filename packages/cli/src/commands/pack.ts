import { createPack, findProjectRoot } from "@envo/core";
import { defineCommand } from "citty";
import { consola } from "consola";

export const packCommand = defineCommand({
  meta: {
    description: "Snapshot an environment into an immutable encrypted pack",
  },
  args: {
    environment: {
      type: "string",
      description: "Environment to pack (defaults to the first environment)",
    },
  },
  async run({ args }) {
    const root = findProjectRoot();
    const { manifest, dir } = await createPack(root, args.environment);

    consola.success(`packed ${manifest.environment} v${manifest.packVersion}`);
    consola.info(`pack:    ${dir}`);
    consola.info(`secrets: ${manifest.secretKeys.length} key(s) encrypted`);
    const bundled = manifest.skills.filter((s) => s.kind === "bundled");
    const refs = manifest.skills.filter((s) => s.kind === "ref");
    if (bundled.length) consola.info(`skills:  ${bundled.map((s) => s.name).join(", ")}`);
    if (refs.length) consola.warn(`skill refs not bundled: ${refs.map((s) => s.name).join(", ")}`);
    consola.log("\nNext: envo pull (on any machine with this pack + your key)");
  },
});
