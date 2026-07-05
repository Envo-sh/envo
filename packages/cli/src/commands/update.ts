import { createHash } from "node:crypto";
import { chmod, rename, writeFile } from "node:fs/promises";
import { registryUrl } from "@envo/core";
import { defineCommand } from "citty";
import { consola } from "consola";
import { CLI_VERSION } from "../version.ts";

interface VersionManifest {
  version: string;
  base: string;
  sha256?: Record<string, string>;
}

function currentTarget(): string {
  const os = process.platform === "darwin" ? "darwin" : process.platform === "linux" ? "linux" : null;
  const arch = process.arch === "arm64" ? "arm64" : process.arch === "x64" ? "x64" : null;
  if (!os || !arch) throw new Error(`Unsupported platform: ${process.platform}/${process.arch}`);
  return `${os}-${arch}`;
}

function newerThan(a: string, b: string): boolean {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
  }
  return false;
}

export const updateCommand = defineCommand({
  meta: {
    description: "Update envo to the latest released version",
  },
  args: {
    check: { type: "boolean", default: false, description: "Only check, don't install" },
  },
  async run({ args }) {
    // /api/cli/version lives next to the registry API
    const versionUrl = `${registryUrl()}/cli/version`;
    const res = await fetch(versionUrl);
    if (!res.ok) throw new Error(`Version check failed (${res.status}) at ${versionUrl}`);
    const manifest = (await res.json()) as VersionManifest;

    if (!newerThan(manifest.version, CLI_VERSION)) {
      consola.success(`envo ${CLI_VERSION} is up to date`);
      return;
    }

    consola.info(`update available: ${CLI_VERSION} → ${manifest.version}`);
    if (args.check) {
      consola.log("Run `envo update` to install.");
      process.exitCode = 1;
      return;
    }

    const target = currentTarget();
    const url = `${manifest.base}/envo-${target}`;
    const binPath = process.execPath;
    consola.info(`downloading ${url}`);

    const download = await fetch(url);
    if (!download.ok) throw new Error(`Download failed (${download.status})`);
    const bytes = Buffer.from(await download.arrayBuffer());
    if (bytes.length < 1024 * 1024) throw new Error("Downloaded binary looks truncated; aborting");

    const expected = manifest.sha256?.[target];
    if (expected) {
      const actual = createHash("sha256").update(bytes).digest("hex");
      if (actual !== expected) {
        throw new Error(
          `Checksum mismatch for ${target}: expected ${expected}, got ${actual}. Refusing to install.`,
        );
      }
      consola.success(`checksum verified (sha256 ${expected.slice(0, 12)}…)`);
    } else {
      consola.warn("release manifest has no checksum for this target; installing unverified");
    }

    // Write next to the current binary, then atomically swap.
    const staging = `${binPath}.update`;
    try {
      await writeFile(staging, bytes);
      await chmod(staging, 0o755);
      await rename(staging, binPath);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Could not replace ${binPath} (${message}). Re-run with write access or reinstall:\n  curl -fsSL https://envo.sh/install | sh`,
      );
    }

    consola.success(`updated envo ${CLI_VERSION} → ${manifest.version} (${binPath})`);
  },
});
