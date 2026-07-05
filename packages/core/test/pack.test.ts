import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decrypt, encrypt } from "../src/crypto.ts";
import { createEnvironment } from "../src/environments.ts";
import { createPack, materializePack } from "../src/pack.ts";
import { runDoctor } from "../src/doctor.ts";
import { setSecret } from "../src/secrets.ts";
import { addSkill } from "../src/skills.ts";

const TEST_KEY = "a".repeat(64);

describe("crypto", () => {
  test("encrypt/decrypt roundtrip", () => {
    const key = Buffer.from(TEST_KEY, "hex");
    const box = encrypt("OPENAI_API_KEY=test-key-fixture\n", key);
    expect(box.data).not.toContain("test-key-fixture");
    expect(decrypt(box, key).toString("utf8")).toBe("OPENAI_API_KEY=test-key-fixture\n");
  });

  test("decrypt fails with wrong key", () => {
    const box = encrypt("secret", Buffer.from(TEST_KEY, "hex"));
    expect(() => decrypt(box, Buffer.from("b".repeat(64), "hex"))).toThrow();
  });
});

describe("pack golden path", () => {
  let machineA: string;
  let machineB: string;

  beforeEach(async () => {
    process.env.ENVO_KEY = TEST_KEY;
    machineA = await mkdtemp(join(tmpdir(), "envo-a-"));
    machineB = await mkdtemp(join(tmpdir(), "envo-b-"));
  });

  afterEach(async () => {
    delete process.env.ENVO_KEY;
    await rm(machineA, { recursive: true, force: true });
    await rm(machineB, { recursive: true, force: true });
  });

  test("pack on machine A, pull on machine B", async () => {
    // Machine A: environment + secret + skill
    const { environment } = await createEnvironment(machineA, {
      name: "atlas-worker",
      yes: true,
    });
    await setSecret(machineA, "OPENAI_API_KEY", "test-key-golden", environment.profile);

    const skillDir = join(machineA, "my-skill");
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), "# My Skill\n");
    await addSkill(machineA, skillDir, "atlas-worker");

    const { manifest, dir } = await createPack(machineA, "atlas-worker");
    expect(manifest.secretKeys).toEqual(["OPENAI_API_KEY"]);
    expect(manifest.skills).toEqual([{ name: "my-skill", kind: "bundled" }]);

    // Pack blob must not contain the plaintext secret
    const blob = await readFile(join(dir, "secrets.enc"), "utf8");
    expect(blob).not.toContain("test-key-golden");

    // Machine B: pull the pack directory
    const result = await materializePack(machineB, dir);
    const envBody = await readFile(result.envFile, "utf8");
    expect(envBody).toContain("OPENAI_API_KEY=test-key-golden");
    expect(await readFile(join(machineB, ".envo/skills/my-skill/SKILL.md"), "utf8")).toBe(
      "# My Skill\n",
    );

    const report = await runDoctor(machineB);
    expect(report.checks.find((c) => c.id === "secrets")?.ok).toBe(true);
    expect(report.ok).toBe(true);
  });

  test("pack versions are monotonic", async () => {
    const { environment } = await createEnvironment(machineA, { name: "dev", yes: true });
    await setSecret(machineA, "KEY", "v", environment.profile);
    const first = await createPack(machineA, "dev");
    const second = await createPack(machineA, "dev");
    expect(first.manifest.packVersion).toBe(1);
    expect(second.manifest.packVersion).toBe(2);
  });

  test("pull with wrong key gives a clear error", async () => {
    const { environment } = await createEnvironment(machineA, { name: "dev", yes: true });
    await setSecret(machineA, "KEY", "value", environment.profile);
    const { dir } = await createPack(machineA, "dev");

    process.env.ENVO_KEY = "b".repeat(64);
    await expect(materializePack(machineB, dir)).rejects.toThrow(/ENVO_KEY/);
  });
});

describe("symlinked skills", () => {
  test("pack bundles skill dirs that are symlinks", async () => {
    process.env.ENVO_KEY = "a".repeat(64);
    const { mkdtemp, mkdir, writeFile, symlink, rm, readFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const root = await mkdtemp(join(tmpdir(), "envo-sym-"));
    try {
      const real = join(root, "real-skill");
      await mkdir(real, { recursive: true });
      await writeFile(join(real, "SKILL.md"), "# linked\n");
      const link = join(root, "linked-skill");
      await symlink(real, link);

      const { environment } = await createEnvironment(root, { name: "dev", yes: true });
      await setSecret(root, "K", "v", environment.profile);
      await addSkill(root, link, "dev");
      const { dir } = await createPack(root, "dev");
      const content = await readFile(join(dir, "skills/linked-skill/SKILL.md"), "utf8");
      expect(content).toBe("# linked\n");
    } finally {
      delete process.env.ENVO_KEY;
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("runtime adapters", () => {
  test("claude-code runtime installs skills to .claude/skills and writes CLAUDE.md", async () => {
    process.env.ENVO_KEY = "a".repeat(64);
    const { mkdtemp, mkdir, writeFile, rm, readFile: rf } = await import("node:fs/promises");
    const { existsSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const src = await mkdtemp(join(tmpdir(), "envo-rt-a-"));
    const dst = await mkdtemp(join(tmpdir(), "envo-rt-b-"));
    try {
      const skill = join(src, "sk");
      await mkdir(skill, { recursive: true });
      await writeFile(join(skill, "SKILL.md"), "# rt\n");
      const { environment } = await createEnvironment(src, { name: "dev", agent: "claude-code", yes: true });
      await setSecret(src, "K", "v", environment.profile);
      await addSkill(src, skill, "dev");
      const { dir } = await createPack(src, "dev");

      const result = await materializePack(dst, dir);
      expect(result.runtime).toBe("claude-code");
      expect(existsSync(join(dst, ".claude/skills/sk/SKILL.md"))).toBe(true);
      expect(existsSync(join(dst, ".envo/skills/sk/SKILL.md"))).toBe(true);
      expect(await rf(join(dst, "CLAUDE.md"), "utf8")).toContain("envo doctor");
      expect(existsSync(join(dst, ".envo/ENVIRONMENT.md"))).toBe(true);
    } finally {
      delete process.env.ENVO_KEY;
      await rm(src, { recursive: true, force: true });
      await rm(dst, { recursive: true, force: true });
    }
  });

  test("existing CLAUDE.md is never overwritten", async () => {
    process.env.ENVO_KEY = "a".repeat(64);
    const { mkdtemp, mkdir, writeFile, rm, readFile: rf } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const src = await mkdtemp(join(tmpdir(), "envo-rt-c-"));
    const dst = await mkdtemp(join(tmpdir(), "envo-rt-d-"));
    try {
      await writeFile(join(dst, "CLAUDE.md"), "user content\n");
      const { environment } = await createEnvironment(src, { name: "dev", agent: "claude-code", yes: true });
      await setSecret(src, "K", "v", environment.profile);
      const { dir } = await createPack(src, "dev");
      await materializePack(dst, dir);
      expect(await rf(join(dst, "CLAUDE.md"), "utf8")).toBe("user content\n");
    } finally {
      delete process.env.ENVO_KEY;
      await rm(src, { recursive: true, force: true });
      await rm(dst, { recursive: true, force: true });
    }
  });
});

describe("harness adapters (spec layer 2)", () => {
  test("cursor harness writes nested .cursor/rules/envo.md context", async () => {
    process.env.ENVO_KEY = "a".repeat(64);
    const { mkdtemp, rm, readFile: rf } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const src = await mkdtemp(join(tmpdir(), "envo-hx-a-"));
    const dst = await mkdtemp(join(tmpdir(), "envo-hx-b-"));
    try {
      const { environment } = await createEnvironment(src, { name: "dev", agent: "cursor", yes: true });
      await setSecret(src, "K", "v", environment.profile);
      const { manifest, dir } = await createPack(src, "dev");
      expect(manifest.harness).toBe("cursor");
      expect(manifest.runtime).toBe("cursor"); // legacy readers keep working

      await materializePack(dst, dir);
      expect(await rf(join(dst, ".cursor/rules/envo.md"), "utf8")).toContain("harness: cursor");
    } finally {
      delete process.env.ENVO_KEY;
      await rm(src, { recursive: true, force: true });
      await rm(dst, { recursive: true, force: true });
    }
  });

  test("--harness override beats the manifest harness", async () => {
    process.env.ENVO_KEY = "a".repeat(64);
    const { mkdtemp, mkdir, writeFile, rm } = await import("node:fs/promises");
    const { existsSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const src = await mkdtemp(join(tmpdir(), "envo-hx-c-"));
    const dst = await mkdtemp(join(tmpdir(), "envo-hx-d-"));
    try {
      const skill = join(src, "sk");
      await mkdir(skill, { recursive: true });
      await writeFile(join(skill, "SKILL.md"), "# s\n");
      const { environment } = await createEnvironment(src, { name: "dev", agent: "shell", yes: true });
      await setSecret(src, "K", "v", environment.profile);
      await addSkill(src, skill, "dev");
      const { dir } = await createPack(src, "dev");

      const result = await materializePack(dst, dir, { harness: "opencode" });
      expect(result.runtime).toBe("opencode");
      expect(existsSync(join(dst, ".opencode/skills/sk/SKILL.md"))).toBe(true);
    } finally {
      delete process.env.ENVO_KEY;
      await rm(src, { recursive: true, force: true });
      await rm(dst, { recursive: true, force: true });
    }
  });
});
