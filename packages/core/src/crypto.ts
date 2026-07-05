import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { join } from "node:path";
import { globalConfigDir } from "./paths.ts";

const KEY_FILE = "master.key";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const FORMAT_V1 = "envo-secretbox-v1";
const FORMAT_V2 = "envo-secretbox-v2";

export interface SecretBox {
  format: typeof FORMAT_V1 | typeof FORMAT_V2;
  iv: string;
  tag: string;
  data: string;
}

export function masterKeyPath(): string {
  return join(globalConfigDir(), KEY_FILE);
}

/**
 * Load the local master key, creating one on first use.
 * ENVO_KEY (64 hex chars) overrides the keyfile — that is how agents and
 * second machines decrypt packs without copying ~/.config/envo around.
 */
export async function loadMasterKey(): Promise<Buffer> {
  const fromEnv = process.env.ENVO_KEY;
  if (fromEnv) {
    const key = Buffer.from(fromEnv.trim(), "hex");
    if (key.length !== KEY_BYTES) {
      throw new Error("ENVO_KEY must be 64 hex characters (32 bytes)");
    }
    return key;
  }

  const path = masterKeyPath();
  if (existsSync(path)) {
    const key = Buffer.from((await readFile(path, "utf8")).trim(), "hex");
    if (key.length !== KEY_BYTES) {
      throw new Error(`Corrupt master key at ${path}`);
    }
    return key;
  }

  const key = randomBytes(KEY_BYTES);
  await mkdir(globalConfigDir(), { recursive: true });
  await writeFile(path, key.toString("hex") + "\n");
  await chmod(path, 0o600);
  return key;
}

/**
 * AES-256-GCM. When `aad` is given, the ciphertext is bound to that context
 * string as additional authenticated data — decrypting with a different (or
 * missing) context fails authentication. This is what prevents an attacker
 * with registry access from splicing ciphertext between environments: a
 * pack encrypted for `acme/prod` cannot be served as `acme/dev`.
 */
export function encrypt(plaintext: string | Buffer, key: Buffer, aad?: string): SecretBox {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  if (aad) cipher.setAAD(Buffer.from(aad, "utf8"));
  const data = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    format: aad ? FORMAT_V2 : FORMAT_V1,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: data.toString("base64"),
  };
}

export function decrypt(box: SecretBox, key: Buffer, aad?: string): Buffer {
  if (box.format !== FORMAT_V1 && box.format !== FORMAT_V2) {
    throw new Error(`Unknown secretbox format: ${box.format}`);
  }
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(box.iv, "base64"));
  if (box.format === FORMAT_V2) {
    if (!aad) throw new Error("This ciphertext is context-bound; decryption context is required");
    decipher.setAAD(Buffer.from(aad, "utf8"));
  }
  decipher.setAuthTag(Buffer.from(box.tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(box.data, "base64")), decipher.final()]);
}

/** Canonical AAD for a pack's secrets: bound to project, environment, version. */
export function packAad(project: string, environment: string, packVersion: number): string {
  return `envo:pack:${project}/${environment}/v${packVersion}`;
}

/** Canonical AAD for a bundle blob: bound to the registry ref it was pushed under. */
export function bundleAad(ref: string): string {
  return `envo:bundle:${ref}`;
}
