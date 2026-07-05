import { homedir } from "node:os";
import { join } from "node:path";
import type { PackManifest } from "./types.ts";

/**
 * Harness adapters — layer 2 of the ENVO-PACK spec (docs/SPEC.md).
 *
 * A harness is the agent shell an environment materializes into. Each adapter
 * declares where that harness discovers skills and which startup context file
 * it reads. `.envo/skills` is always written as the canonical copy; the
 * harness target is an additional install so the agent finds its skills with
 * zero configuration. Adding a harness is a table entry, not a format change.
 */
export interface HarnessTarget {
  /** Directory skills are installed into (in addition to .envo/skills). */
  skillsDir: (workDir: string) => string | null;
  /** Startup context file the harness reads; created only if absent. */
  contextFile: string | null;
}

const HARNESSES: Record<string, HarnessTarget> = {
  "claude-code": {
    skillsDir: (workDir) => join(workDir, ".claude", "skills"),
    contextFile: "CLAUDE.md",
  },
  claude: {
    skillsDir: (workDir) => join(workDir, ".claude", "skills"),
    contextFile: "CLAUDE.md",
  },
  codex: {
    skillsDir: (workDir) => join(workDir, ".agents", "skills"),
    contextFile: "AGENTS.md",
  },
  opencode: {
    skillsDir: (workDir) => join(workDir, ".opencode", "skills"),
    contextFile: "AGENTS.md",
  },
  cursor: {
    // Cursor has no skills dir; its native context surface is rules files.
    skillsDir: () => null,
    contextFile: join(".cursor", "rules", "envo.md"),
  },
  pi: {
    skillsDir: (workDir) => join(workDir, ".pi", "skills"),
    contextFile: "AGENTS.md",
  },
  devin: {
    // Cloud harness with no local filesystem: integrates via auth + registry.
    skillsDir: () => null,
    contextFile: null,
  },
  hermes: {
    skillsDir: () => join(homedir(), ".hermes", "skills"),
    contextFile: "AGENTS.md",
  },
  shell: { skillsDir: () => null, contextFile: null },
  custom: { skillsDir: () => null, contextFile: null },
};

export function harnessTarget(harness: string): HarnessTarget {
  return HARNESSES[harness] ?? HARNESSES.shell!;
}

export function knownHarnesses(): string[] {
  return Object.keys(HARNESSES);
}

/** @deprecated spec vocabulary is "harness"; kept for compatibility. */
export const runtimeTarget = harnessTarget;
/** @deprecated spec vocabulary is "harness"; kept for compatibility. */
export const knownRuntimes = knownHarnesses;

/** The harness a manifest targets, tolerating legacy manifests. */
export function manifestHarness(manifest: PackManifest): string {
  return manifest.harness ?? manifest.runtime;
}

/**
 * Context dropped into the workspace so an agent that wakes up here knows
 * what this environment is, what it has, and how to check it.
 */
export function renderEnvironmentContext(
  manifest: PackManifest,
  opts: { envFile: string; skillDirs: string[]; harness?: string },
): string {
  const lines = [
    `# Environment: ${manifest.project}/${manifest.environment}`,
    "",
    `Provisioned by Envo (pack v${manifest.packVersion}, harness: ${opts.harness ?? manifestHarness(manifest)}).`,
    "",
    `- Env vars: ${manifest.secretKeys.join(", ") || "none"} — materialized in \`${opts.envFile}\``,
    `- Skills: ${manifest.skills.map((s) => s.name).join(", ") || "none"}`,
    ...opts.skillDirs.map((d) => `  - installed at \`${d}\``),
    "",
    "Run `envo doctor` to verify this environment. If a required key or skill",
    "is missing, doctor names it — report that to your operator rather than",
    "improvising credentials.",
    "",
  ];
  return lines.join("\n");
}
