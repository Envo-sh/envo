import { existsSync, readFileSync } from "node:fs";
import { loadCliConfig, masterKeyPath, registryUrl } from "@envo/core";
import { defineCommand } from "citty";
import { consola } from "consola";

const INSTALL_URL = "https://envo.sh/install";

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * One command from your laptop to a working agent on a remote box:
 * installs envo if missing, forwards the token and master key over stdin
 * (never argv, never the remote shell history), and runs `envo up` there.
 */
export const sshCommand = defineCommand({
  meta: {
    description: "Bootstrap an environment on a remote machine over SSH",
  },
  args: {
    host: {
      type: "positional",
      description: "SSH host (user@host or an ssh config alias)",
      required: true,
    },
    ref: {
      type: "positional",
      description: "Environment ref: <project>/<environment>",
      required: true,
    },
    dir: {
      type: "string",
      description: "Remote directory to materialize into (default: ~/envo/<environment>)",
    },
    run: {
      type: "string",
      description: "Command to launch on the remote once the environment is ready",
    },
    harness: {
      type: "string",
      description: "Override harness for skill placement",
    },
    runtime: {
      type: "string",
      description: "Deprecated alias for --harness",
    },
    registry: {
      type: "string",
      description: "Registry URL (defaults to the local config/default)",
    },
  },
  async run({ args }) {
    if (!/^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/.test(args.ref)) {
      throw new Error(`Invalid ref: ${args.ref} (expected <project>/<environment>)`);
    }

    const config = await loadCliConfig();
    const token = process.env.ENVO_TOKEN ?? config.token;
    if (!token) {
      throw new Error("No agent token. Run `envo login` or set ENVO_TOKEN.");
    }
    const key =
      process.env.ENVO_KEY ??
      (existsSync(masterKeyPath()) ? readFileSync(masterKeyPath(), "utf8").trim() : null);
    if (!key) {
      throw new Error("No master key. Set ENVO_KEY or create one with `envo pack`.");
    }

    const registry = registryUrl(args.registry);
    const envName = args.ref.split("/")[1]!;
    const remoteDir = args.dir ?? `$HOME/envo/${envName}`;

    const upArgs = [
      `up ${shellQuote(args.ref)}`,
      `--dir ${args.dir ? shellQuote(args.dir) : `"${remoteDir}"`}`,
      args.harness ?? args.runtime ? `--harness ${shellQuote(args.harness ?? args.runtime!)}` : "",
      args.run ? `--run ${shellQuote(args.run)}` : "",
    ]
      .filter(Boolean)
      .join(" ");

    // Secrets travel on stdin; the script on argv contains none of them.
    const remoteScript = [
      `set -e`,
      `IFS= read -r ENVO_TOKEN`,
      `IFS= read -r ENVO_KEY`,
      `export ENVO_TOKEN ENVO_KEY`,
      `export ENVO_REGISTRY=${shellQuote(registry)}`,
      `export PATH="$HOME/.local/bin:/usr/local/bin:$PATH"`,
      `if ! command -v envo >/dev/null 2>&1; then`,
      `  echo "[envo ssh] installing envo..."`,
      `  curl -fsSL ${INSTALL_URL} | sh >/dev/null`,
      `fi`,
      `mkdir -p "${remoteDir.startsWith("$") ? remoteDir : remoteDir}"`,
      `envo ${upArgs}`,
    ].join("\n");

    consola.info(`bootstrapping ${args.ref} on ${args.host} ...`);
    const proc = Bun.spawn(["ssh", args.host, remoteScript], {
      stdin: "pipe",
      stdout: "inherit",
      stderr: "inherit",
    });
    proc.stdin.write(`${token}\n${key}\n`);
    await proc.stdin.end();
    const code = await proc.exited;
    if (code === 0) {
      consola.success(`${args.ref} is live on ${args.host}`);
    }
    process.exitCode = code;
  },
});
