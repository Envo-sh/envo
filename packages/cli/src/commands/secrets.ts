import { findProjectRoot, requireSecrets, setSecret } from "@envo/core";
import { defineCommand } from "citty";
import { consola } from "consola";
import * as readline from "node:readline/promises";

async function readSecretValue(key: string) {
  const fromEnv = process.env[key];
  if (fromEnv) return fromEnv;

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const value = await rl.question(`Value for ${key}: `);
  rl.close();
  return value;
}

const setCommand = defineCommand({
  meta: {
    description: "Set a secret for the active profile",
  },
  args: {
    key: {
      type: "positional",
      description: "Secret key",
      required: true,
    },
    value: {
      type: "string",
      description: "Secret value. Defaults to reading from env or prompting.",
    },
    profile: {
      type: "string",
      description: "Profile to write",
    },
    environment: {
      type: "string",
      description: "Environment to write",
    },
  },
  async run({ args }) {
    const root = findProjectRoot();
    const key = args.key;
    const value = args.value ?? (await readSecretValue(key));
    const result = await setSecret(root, key, value, args.profile ?? args.environment);

    consola.success(`set ${result.key}`);
    consola.info(`profile: ${result.profile}`);
    consola.info(`env:     ${result.envFile}`);
    consola.log("\nNext: envo push");
  },
});

const requireCommand = defineCommand({
  meta: {
    description: "Declare keys this environment requires (doctor fails without them)",
  },
  args: {
    keys: {
      type: "positional",
      description: "Key names, space separated",
      required: true,
    },
    environment: { type: "string", description: "Environment" },
  },
  async run({ args }) {
    const root = findProjectRoot();
    const keys = [args.keys, ...(args._ ?? [])].filter(Boolean);
    const result = await requireSecrets(root, keys, args.environment);
    consola.success(`${result.environment} requires: ${result.requiredKeys.join(", ")}`);
    consola.log("\nRe-run `envo push` to publish the requirement.");
  },
});

export const secretsCommand = defineCommand({
  meta: {
    description: "Manage project secrets",
  },
  subCommands: {
    set: setCommand,
    require: requireCommand,
  },
});
