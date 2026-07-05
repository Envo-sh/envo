import { mkdir, mkdtemp, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { decrypt, encrypt, loadMasterKey, type SecretBox } from "./crypto.ts";

const BUNDLE_FORMAT = "envo-bundle-v1";

interface BundlePayload {
  format: typeof BUNDLE_FORMAT;
  files: Array<{ path: string; data: string }>;
}

async function collectFiles(dir: string, base: string): Promise<Array<{ path: string; data: string }>> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: Array<{ path: string; data: string }> = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    // stat (not the dirent) so symlinked files and directories are followed
    const info = await stat(full).catch(() => null);
    if (!info) continue;
    if (info.isDirectory()) {
      files.push(...(await collectFiles(full, base)));
    } else if (info.isFile()) {
      files.push({ path: relative(base, full), data: (await readFile(full)).toString("base64") });
    }
  }
  return files;
}

/**
 * Bundle a pack directory into a single encrypted blob — the unit that moves
 * over the wire. The whole payload (manifest included) is ciphertext, so a
 * registry only ever sees an opaque blob plus the ref it was pushed under.
 */
export async function createBundle(packDir: string, opts: { aad?: string } = {}): Promise<Buffer> {
  const payload: BundlePayload = {
    format: BUNDLE_FORMAT,
    files: await collectFiles(packDir, packDir),
  };
  const key = await loadMasterKey();
  return Buffer.from(JSON.stringify(encrypt(JSON.stringify(payload), key, opts.aad)));
}

/** Decrypt a bundle blob and reconstruct the pack directory it contains. */
export async function extractBundle(blob: Buffer, opts: { destDir?: string; aad?: string } = {}): Promise<string> {
  const key = await loadMasterKey();
  const box = JSON.parse(blob.toString("utf8")) as SecretBox;

  let payload: BundlePayload;
  try {
    payload = JSON.parse(decrypt(box, key, opts.aad).toString("utf8")) as BundlePayload;
  } catch {
    throw new Error(
      "Failed to decrypt bundle. Set ENVO_KEY to the key that created it, or copy ~/.config/envo/master.key from the source machine.",
    );
  }
  if (payload.format !== BUNDLE_FORMAT) {
    throw new Error(`Unknown bundle format: ${payload.format}`);
  }

  const dir = opts.destDir ?? (await mkdtemp(join(tmpdir(), "envo-pack-")));
  for (const file of payload.files) {
    if (file.path.split("/").some((part) => part === "..")) {
      throw new Error(`Refusing to extract path outside pack dir: ${file.path}`);
    }
    const dest = join(dir, file.path);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, Buffer.from(file.data, "base64"));
  }
  return dir;
}
