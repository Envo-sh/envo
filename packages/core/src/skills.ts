import type { SkillEntry } from "./types.ts";
import { writeEnvironmentConfig } from "./environments.ts";
import { findProjectRoot } from "./paths.ts";
import { loadState, saveState } from "./state.ts";

export async function addSkill(
  root: string,
  skill: string,
  environment?: string,
): Promise<SkillEntry> {
  const state = await loadState(root);
  if (!state) {
    throw new Error("Not connected. Run `envo environment create` first.");
  }

  const activeEnvironment = environment ?? state.environments?.[0]?.name ?? state.profile;
  const environments = state.environments ?? [];
  const nextEnvironments = environments.map((env) =>
    env.name === activeEnvironment
      ? {
          ...env,
          skills: env.skills.includes(skill) ? env.skills : [...env.skills, skill],
        }
      : env,
  );

  if (!nextEnvironments.some((env) => env.name === activeEnvironment)) {
    throw new Error(`Environment not found: ${activeEnvironment}`);
  }

  state.environments = nextEnvironments;
  await saveState(root, state);
  await writeEnvironmentConfig(root, state.projectName ?? activeEnvironment, nextEnvironments);

  return {
    name: skill,
    environment: activeEnvironment,
  };
}

export async function listSkills(root = findProjectRoot()): Promise<SkillEntry[]> {
  const state = await loadState(root);
  return (state?.environments ?? []).flatMap((env) =>
    env.skills.map((skill) => ({
      name: skill,
      environment: env.name,
    })),
  );
}
