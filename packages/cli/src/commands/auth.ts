import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import {
  addAuth,
  AUTH_PROVIDERS,
  describeExpiry,
  expandHome,
  findProjectRoot,
  inspectAuthContent,
  knownAuthProviders,
  loadState,
  refreshableProviders,
  refreshAuthContent,
} from "@envo/core";
import { defineCommand } from "citty";
import { consola } from "consola";

const addCmd = defineCommand({
  meta: {
    description: "Attach a model-provider credential to this environment",
  },
  args: {
    provider: {
      type: "positional",
      description: `Provider: ${knownAuthProviders().join(", ")} (or any name with --path)`,
      required: true,
    },
    environment: { type: "string", description: "Environment" },
    path: { type: "string", description: "Custom credential file path (file-kind providers)" },
  },
  async run({ args }) {
    const root = findProjectRoot();
    const entry = await addAuth(root, args.provider, {
      environment: args.environment,
      path: args.path,
    });
    if (entry.kind === "env") {
      consola.success(`${entry.provider}: will carry ${entry.envKey}`);
      consola.info(`Captured fresh at pack time from your environment or secrets.`);
    } else {
      consola.success(`${entry.provider}: will carry ${entry.targetPath}`);
      consola.info(`The current token is captured fresh at each \`envo push\` — refreshed OAuth tokens ride along.`);
    }
    consola.log("\nNext: envo push");
  },
});

const listCmd = defineCommand({
  meta: { description: "Show this environment's provider credentials" },
  args: {
    environment: { type: "string", description: "Environment" },
  },
  async run({ args }) {
    const root = findProjectRoot();
    const state = await loadState(root);
    const envName = args.environment ?? state?.environments?.[0]?.name;
    const env = state?.environments?.find((e) => e.name === envName);
    const entries = env?.auth ?? [];
    if (!entries.length) {
      consola.info("No provider auth attached. Add one: envo auth add <provider>");
      consola.log(`Providers: ${knownAuthProviders().join(", ")}`);
      return;
    }
    for (const a of entries) {
      consola.log(
        `${a.provider.padEnd(14)} ${a.kind.padEnd(5)} ${a.kind === "env" ? a.envKey : a.targetPath}`,
      );
    }
  },
});

const providersCmd = defineCommand({
  meta: { description: "List known providers and how each materializes" },
  async run() {
    for (const [name, p] of Object.entries(AUTH_PROVIDERS)) {
      consola.log(`${name.padEnd(14)} ${p.kind.padEnd(5)} ${p.kind === "env" ? p.envKey : p.path}`);
    }
  },
});

const statusCmd = defineCommand({
  meta: { description: "Show token expiry for this environment's provider credentials" },
  args: { environment: { type: "string", description: "Environment" } },
  async run({ args }) {
    const root = findProjectRoot();
    const state = await loadState(root);
    const envName = args.environment ?? state?.environments?.[0]?.name;
    const env = state?.environments?.find((e) => e.name === envName);
    const entries = env?.auth ?? [];
    if (!entries.length) {
      consola.info("No provider auth attached. Add one: envo auth add <provider>");
      return;
    }
    let anyExpired = false;
    for (const a of entries) {
      if (a.kind === "env") {
        consola.log(`${a.provider.padEnd(14)} env   ${a.envKey} (API keys don't expire)`);
        continue;
      }
      const dest = expandHome(a.targetPath ?? "");
      if (!existsSync(dest)) {
        consola.warn(`${a.provider.padEnd(14)} file  missing: ${a.targetPath}`);
        anyExpired = true;
        continue;
      }
      const info = inspectAuthContent(a.provider, await readFile(dest, "utf8"));
      const line = `${a.provider.padEnd(14)} file  ${describeExpiry(info)}${info.refreshable ? "" : " (no refresh adapter)"}`;
      if (info.expired) {
        consola.warn(line);
        anyExpired = true;
      } else {
        consola.log(line);
      }
    }
    if (anyExpired) {
      consola.log("\nRefresh: envo auth refresh && envo push");
      process.exitCode = 1;
    }
  },
});

const refreshCmd = defineCommand({
  meta: {
    description: "Refresh OAuth tokens in place (client-side, straight to the provider)",
  },
  args: {
    provider: { type: "positional", description: "Provider (default: all refreshable)", required: false },
    environment: { type: "string", description: "Environment" },
  },
  async run({ args }) {
    const root = findProjectRoot();
    const state = await loadState(root);
    const envName = args.environment ?? state?.environments?.[0]?.name;
    const env = state?.environments?.find((e) => e.name === envName);
    const entries = (env?.auth ?? []).filter(
      (a) =>
        a.kind === "file" &&
        refreshableProviders().includes(a.provider) &&
        (!args.provider || a.provider === args.provider),
    );
    if (!entries.length) {
      consola.info(
        args.provider
          ? `No refreshable credential for "${args.provider}" here. Refreshable providers: ${refreshableProviders().join(", ")}`
          : "No refreshable provider credentials attached.",
      );
      return;
    }
    for (const a of entries) {
      const dest = expandHome(a.targetPath ?? "");
      if (!existsSync(dest)) {
        consola.warn(`${a.provider}: credential file missing at ${a.targetPath}`);
        continue;
      }
      try {
        const refreshed = await refreshAuthContent(a.provider, await readFile(dest, "utf8"));
        await writeFile(dest, refreshed.content);
        consola.success(
          `${a.provider}: refreshed (${describeExpiry({ expiresAt: refreshed.expiresAt, expired: false, refreshable: true })})`,
        );
      } catch (error) {
        consola.error(`${a.provider}: ${error instanceof Error ? error.message : error}`);
        process.exitCode = 1;
      }
    }
    consola.log("\nNext: envo push (carries the fresh tokens)");
  },
});

export const authCommand = defineCommand({
  meta: {
    description: "Model-provider credentials: API keys and OAuth token files",
  },
  subCommands: {
    add: addCmd,
    list: listCmd,
    ls: listCmd,
    status: statusCmd,
    refresh: refreshCmd,
    providers: providersCmd,
  },
});
