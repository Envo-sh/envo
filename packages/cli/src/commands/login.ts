import {
  loadCliConfig,
  pollDeviceToken,
  registryUrl,
  saveCliConfig,
  startDeviceAuthorization,
  whoami,
} from "@envo/core";
import { defineCommand } from "citty";
import { consola } from "consola";
import { spawn } from "node:child_process";
import { hostname } from "node:os";

function openBrowser(url: string): void {
  const command = process.platform === "darwin" ? "open" : process.platform === "linux" ? "xdg-open" : undefined;
  if (!command) return;

  try {
    const child = spawn(command, [url], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
  } catch {
    // Best-effort convenience only. The URL is always printed for manual use.
  }
}

function describeIdentity(identity: { kind: string; name?: string; scope?: string; email?: string }): string {
  if (identity.kind === "agent-token") {
    return `token "${identity.name}" (scope: ${identity.scope})`;
  }
  if (identity.kind === "cli-token") {
    return `CLI token "${identity.name}" (scope: ${identity.scope})`;
  }
  return `session: ${identity.email}`;
}

export const loginCommand = defineCommand({
  meta: {
    description: "Log in to Envo from this machine",
  },
  args: {
    token: {
      type: "string",
      description: "Agent token (create one at https://envo.sh/dashboard/tokens)",
    },
    registry: {
      type: "string",
      description: "Registry URL (defaults to the hosted Envo registry)",
    },
  },
  async run({ args }) {
    const registry = args.registry ?? registryUrl();

    if (args.token) {
      const token = args.token;
      const identity = await whoami({ registry, token });

      const config = await loadCliConfig();
      config.token = token;
      if (args.registry) config.registry = args.registry;
      await saveCliConfig(config);

      consola.success(`logged in as ${describeIdentity(identity)}`);
      consola.info(`registry: ${registry}`);
      return;
    }

    const authorization = await startDeviceAuthorization({
      registry,
      hostname: hostname(),
    });

    consola.info("Pairing code:");
    consola.box(authorization.userCode);
    consola.info(`Open this URL to approve login: ${authorization.verificationUrl}`);
    openBrowser(authorization.verificationUrl);
    consola.info("Waiting for browser approval...");

    const token = await pollDeviceToken({
      registry,
      deviceCode: authorization.deviceCode,
      intervalSeconds: authorization.interval,
      expiresInSeconds: authorization.expiresIn,
    });
    const identity = await whoami({ registry, token });

    const config = await loadCliConfig();
    config.token = token;
    if (args.registry) config.registry = args.registry;
    await saveCliConfig(config);

    consola.success(`logged in as ${describeIdentity(identity)}`);
    consola.info(`registry: ${registry}`);
  },
});

export const whoamiCommand = defineCommand({
  meta: { description: "Show the identity behind the saved or ambient token" },
  async run() {
    const identity = await whoami({});
    consola.info(`registry: ${registryUrl()}`);
    consola.success(describeIdentity(identity));
  },
});
