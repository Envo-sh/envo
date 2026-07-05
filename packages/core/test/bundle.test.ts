import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBundle, extractBundle } from "../src/bundle.ts";
import { createEnvironment } from "../src/environments.ts";
import { createPack, materializePack } from "../src/pack.ts";
import { setSecret } from "../src/secrets.ts";

const TEST_KEY = "d".repeat(64);

describe("bundle", () => {
  let machineA: string;
  let machineB: string;

  beforeEach(async () => {
    process.env.ENVO_KEY = TEST_KEY;
    machineA = await mkdtemp(join(tmpdir(), "envo-bundle-a-"));
    machineB = await mkdtemp(join(tmpdir(), "envo-bundle-b-"));
  });

  afterEach(async () => {
    delete process.env.ENVO_KEY;
    await rm(machineA, { recursive: true, force: true });
    await rm(machineB, { recursive: true, force: true });
  });

  test("pack → bundle blob → extract → materialize", async () => {
    const { environment } = await createEnvironment(machineA, { name: "dev", yes: true });
    await setSecret(machineA, "API_KEY", "test-fixture-not-a-key", environment.profile);
    const { dir } = await createPack(machineA, "dev");

    const blob = await createBundle(dir);
    expect(blob.toString("utf8")).not.toContain("test-fixture-not-a-key");
    expect(blob.toString("utf8")).not.toContain("manifest");

    const extracted = await extractBundle(blob);
    const result = await materializePack(machineB, extracted);
    expect(await readFile(result.envFile, "utf8")).toContain("API_KEY=test-fixture-not-a-key");
  });

  test("extract with wrong key fails clearly", async () => {
    const { environment } = await createEnvironment(machineA, { name: "dev", yes: true });
    await setSecret(machineA, "API_KEY", "v", environment.profile);
    const { dir } = await createPack(machineA, "dev");
    const blob = await createBundle(dir);

    process.env.ENVO_KEY = "e".repeat(64);
    await expect(extractBundle(blob)).rejects.toThrow(/ENVO_KEY/);
  });
});

describe("context binding (AAD)", () => {
  const KEY = "f".repeat(64);

  test("bundle bound to one ref cannot be served as another", async () => {
    process.env.ENVO_KEY = KEY;
    const { mkdtemp, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { bundleAad } = await import("../src/crypto.ts");
    const src = await mkdtemp(join(tmpdir(), "envo-aad-"));
    try {
      const { environment } = await createEnvironment(src, { name: "prod", yes: true });
      await setSecret(src, "PROD_KEY", "prod-secret", environment.profile);
      const { dir } = await createPack(src, "prod");

      const blob = await createBundle(dir, { aad: bundleAad("acme/prod") });
      // legitimate pull works
      await extractBundle(blob, { aad: bundleAad("acme/prod") });
      // registry serving it under a different ref fails authentication
      await expect(extractBundle(blob, { aad: bundleAad("acme/dev") })).rejects.toThrow();
      // and stripping the context entirely also fails
      await expect(extractBundle(blob)).rejects.toThrow();
    } finally {
      delete process.env.ENVO_KEY;
      await rm(src, { recursive: true, force: true });
    }
  });

  test("secrets.enc spliced between packs fails to materialize", async () => {
    process.env.ENVO_KEY = KEY;
    const { mkdtemp, rm, copyFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const src = await mkdtemp(join(tmpdir(), "envo-splice-"));
    const dst = await mkdtemp(join(tmpdir(), "envo-splice-dst-"));
    try {
      const { environment: prod } = await createEnvironment(src, { name: "prod", yes: true });
      await setSecret(src, "PROD_KEY", "prod-secret", prod.profile);
      const prodPack = await createPack(src, "prod");

      const { environment: dev } = await createEnvironment(src, { name: "dev", yes: true });
      await setSecret(src, "DEV_KEY", "dev-secret", dev.profile);
      const devPack = await createPack(src, "dev");

      // attacker splices prod secrets into the dev pack
      await copyFile(join(prodPack.dir, "secrets.enc"), join(devPack.dir, "secrets.enc"));
      await expect(materializePack(dst, devPack.dir)).rejects.toThrow();
    } finally {
      delete process.env.ENVO_KEY;
      await rm(src, { recursive: true, force: true });
      await rm(dst, { recursive: true, force: true });
    }
  });

  test("legacy v1 boxes still decrypt (backward compatibility)", async () => {
    const { encrypt, decrypt } = await import("../src/crypto.ts");
    const key = Buffer.from(KEY, "hex");
    const v1 = encrypt("legacy", key); // no aad → v1 format
    expect(v1.format).toBe("envo-secretbox-v1");
    expect(decrypt(v1, key, "any-context-ignored").toString()).toBe("legacy");
    expect(decrypt(v1, key).toString()).toBe("legacy");
  });
});
