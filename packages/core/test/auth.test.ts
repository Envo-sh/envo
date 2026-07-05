import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addAuth } from "../src/auth.ts";
import { createEnvironment } from "../src/environments.ts";
import { createPack, materializePack } from "../src/pack.ts";
import { runDoctor } from "../src/doctor.ts";
import { setSecret } from "../src/secrets.ts";

const KEY = "9".repeat(64);

describe("auth layer (spec layer 1)", () => {
  let src: string;
  let dst: string;

  beforeEach(async () => {
    process.env.ENVO_KEY = KEY;
    src = await mkdtemp(join(tmpdir(), "envo-auth-a-"));
    dst = await mkdtemp(join(tmpdir(), "envo-auth-b-"));
  });

  afterEach(async () => {
    delete process.env.ENVO_KEY;
    delete process.env.OPENROUTER_API_KEY;
    await rm(src, { recursive: true, force: true });
    await rm(dst, { recursive: true, force: true });
  });

  test("env-kind: API key captured at pack time, materialized into env file", async () => {
    process.env.OPENROUTER_API_KEY = "test-fixture-not-a-key-live";
    const { environment } = await createEnvironment(src, { name: "dev", yes: true });
    await setSecret(src, "OTHER", "x", environment.profile);
    await addAuth(src, "openrouter");
    const { manifest, dir } = await createPack(src, "dev");
    expect(manifest.auth).toEqual([
      { provider: "openrouter", kind: "env", envKey: "OPENROUTER_API_KEY", targetPath: undefined },
    ]);
    expect(existsSync(join(dir, "auth.enc"))).toBe(true);
    // the plaintext key never appears in the pack unencrypted
    expect(await readFile(join(dir, "auth.enc"), "utf8")).not.toContain("test-fixture-not-a-key-live");

    delete process.env.OPENROUTER_API_KEY; // machine B does not have it
    const result = await materializePack(dst, dir);
    expect(result.auth?.materialized.join()).toContain("openrouter");
    expect(await readFile(result.envFile, "utf8")).toContain("OPENROUTER_API_KEY=test-fixture-not-a-key-live");
  });

  test("file-kind: OAuth credential file captured and re-created with 0600", async () => {
    const credPath = join(src, "fake-home", "auth.json");
    await mkdir(join(src, "fake-home"), { recursive: true });
    await writeFile(credPath, JSON.stringify({ access_token: "oauth-secret-token" }));

    const { environment } = await createEnvironment(src, { name: "dev", yes: true });
    await setSecret(src, "K", "v", environment.profile);
    await addAuth(src, "mytool", { path: credPath });
    const { dir } = await createPack(src, "dev");
    expect(await readFile(join(dir, "auth.enc"), "utf8")).not.toContain("oauth-secret-token");

    // "machine B": the credential file does not exist yet
    await rm(credPath);
    const result = await materializePack(dst, dir);
    expect(result.auth?.materialized.some((m) => m.includes("mytool"))).toBe(true);
    expect(JSON.parse(await readFile(credPath, "utf8")).access_token).toBe("oauth-secret-token");

    // doctor sees the credential in place
    const report = await runDoctor(dst);
    expect(report.checks.find((c) => c.id === "auth")?.ok).toBe(true);

    // and names it when it disappears
    await rm(credPath);
    const report2 = await runDoctor(dst);
    const authCheck = report2.checks.find((c) => c.id === "auth");
    expect(authCheck?.ok).toBe(false);
    expect(authCheck?.message).toContain("mytool");
  });

  test("existing credential files are never overwritten", async () => {
    const credPath = join(src, "cred.json");
    await writeFile(credPath, "captured");
    const { environment } = await createEnvironment(src, { name: "dev", yes: true });
    await setSecret(src, "K", "v", environment.profile);
    await addAuth(src, "tool", { path: credPath });
    const { dir } = await createPack(src, "dev");

    await writeFile(credPath, "user-newer-token");
    const result = await materializePack(dst, dir);
    expect(result.auth?.skipped.some((s) => s.includes("tool"))).toBe(true);
    expect(await readFile(credPath, "utf8")).toBe("user-newer-token");
  });

  test("auth.enc spliced between packs fails authentication", async () => {
    process.env.OPENROUTER_API_KEY = "test-fixture-not-a-key-splice";
    const { environment: dev } = await createEnvironment(src, { name: "dev", yes: true });
    await setSecret(src, "K", "v", dev.profile);
    await addAuth(src, "openrouter", { environment: "dev" });
    const devPack = await createPack(src, "dev");

    const { environment: prod } = await createEnvironment(src, { name: "prod", yes: true });
    await setSecret(src, "K", "v", prod.profile);
    await addAuth(src, "openrouter", { environment: "prod" });
    const prodPack = await createPack(src, "prod");

    await copyFile(join(devPack.dir, "auth.enc"), join(prodPack.dir, "auth.enc"));
    await expect(materializePack(dst, prodPack.dir)).rejects.toThrow();
  });

  test("pack fails loudly when a declared credential is missing", async () => {
    const { environment } = await createEnvironment(src, { name: "dev", yes: true });
    await setSecret(src, "K", "v", environment.profile);
    await addAuth(src, "openrouter");
    delete process.env.OPENROUTER_API_KEY;
    await expect(createPack(src, "dev")).rejects.toThrow(/OPENROUTER_API_KEY/);
  });
});

describe("expired-token replacement", () => {
  test("an expired local token is replaced by a fresher captured one, with backup", async () => {
    process.env.ENVO_KEY = "9".repeat(64);
    const src2 = await mkdtemp(join(tmpdir(), "envo-fresh-a-"));
    const dst2 = await mkdtemp(join(tmpdir(), "envo-fresh-b-"));
    try {
      const credPath = join(src2, "claude-creds.json");
      const fresh = JSON.stringify({
        claudeAiOauth: { accessToken: "fresh", refreshToken: "r", expiresAt: Date.now() + 3_600_000 },
      });
      await writeFile(credPath, fresh);

      const { environment } = await createEnvironment(src2, { name: "dev", yes: true });
      await setSecret(src2, "K", "v", environment.profile);
      await addAuth(src2, "claude-code", { path: credPath });
      const { dir } = await createPack(src2, "dev");

      // machine B has the same path but an EXPIRED token
      await writeFile(
        credPath,
        JSON.stringify({ claudeAiOauth: { accessToken: "dead", refreshToken: "r", expiresAt: 1 } }),
      );
      const result = await materializePack(dst2, dir);
      expect(result.auth?.materialized.some((m) => m.includes("replaced expired"))).toBe(true);
      expect(JSON.parse(await readFile(credPath, "utf8")).claudeAiOauth.accessToken).toBe("fresh");
      expect(existsSync(`${credPath}.bak`)).toBe(true);

      // but a LIVE local token is never touched
      const live = JSON.stringify({
        claudeAiOauth: { accessToken: "mine", refreshToken: "r", expiresAt: Date.now() + 9_000_000 },
      });
      await writeFile(credPath, live);
      const dst3 = await mkdtemp(join(tmpdir(), "envo-fresh-c-"));
      const result2 = await materializePack(dst3, dir);
      expect(result2.auth?.skipped.some((s) => s.includes("claude-code"))).toBe(true);
      expect(await readFile(credPath, "utf8")).toBe(live);
      await rm(dst3, { recursive: true, force: true });
    } finally {
      delete process.env.ENVO_KEY;
      await rm(src2, { recursive: true, force: true });
      await rm(dst2, { recursive: true, force: true });
    }
  });
});
