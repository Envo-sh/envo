import { createSandbox, deleteSandbox, listSandboxes } from "@envo/core";
import { defineCommand } from "citty";
import { consola } from "consola";

const createCmd = defineCommand({
  meta: {
    description: "Deploy an environment as a hosted edge sandbox ($0.05, then metered usage)",
  },
  args: {
    ref: {
      type: "positional",
      description: "Environment ref: <project>/<environment>",
      required: true,
    },
    name: { type: "string", description: "Sandbox name (defaults to the environment name)" },
    registry: { type: "string", description: "Registry URL" },
    json: { type: "boolean", default: false },
  },
  async run({ args }) {
    const sandbox = await createSandbox(args.ref, { name: args.name, registry: args.registry });
    if (args.json) {
      console.log(JSON.stringify(sandbox, null, 2));
      return;
    }
    consola.success(`sandbox ${sandbox.slug} is ${sandbox.status}`);
    consola.info(`url: ${sandbox.url}`);
    consola.log(`\nTry it:\n  curl ${sandbox.url}/env`);
    consola.log(`\nNote: your master key was installed as a Cloudflare secret on this`);
    consola.log(`worker so it can decrypt packs at the edge. Envo does not store it.`);
  },
});

const listCmd = defineCommand({
  meta: { description: "List hosted sandboxes" },
  args: {
    registry: { type: "string", description: "Registry URL" },
    json: { type: "boolean", default: false },
  },
  async run({ args }) {
    const { sandboxes, enabled } = await listSandboxes({ registry: args.registry });
    if (args.json) {
      console.log(JSON.stringify({ sandboxes, enabled }, null, 2));
      return;
    }
    if (!enabled) consola.warn("Hosted sandboxes are not enabled on this deployment.");
    if (!sandboxes.length) {
      consola.info("No sandboxes. Create one: envo sandbox create <project>/<environment>");
      return;
    }
    for (const s of sandboxes) {
      const ref = s.project_slug ? `${s.project_slug}/${s.environment_slug}` : "-";
      consola.log(`${s.status.padEnd(12)} ${s.slug.padEnd(28)} ${ref.padEnd(28)} ${s.url ?? s.error ?? ""}`);
    }
  },
});

const deleteCmd = defineCommand({
  meta: { description: "Delete a hosted sandbox (removes the worker and revokes its token)" },
  args: {
    sandbox: {
      type: "positional",
      description: "Sandbox slug or id",
      required: true,
    },
    registry: { type: "string", description: "Registry URL" },
  },
  async run({ args }) {
    await deleteSandbox(args.sandbox, { registry: args.registry });
    consola.success(`deleted ${args.sandbox}`);
  },
});

export const sandboxCommand = defineCommand({
  meta: {
    description: "Hosted edge sandboxes: create, list, delete",
  },
  subCommands: {
    create: createCmd,
    list: listCmd,
    ls: listCmd,
    delete: deleteCmd,
    rm: deleteCmd,
  },
});
