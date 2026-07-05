import { addSkill, findProjectRoot, listSkills } from "@envo/core";
import { defineCommand } from "citty";
import { consola } from "consola";

const addCommand = defineCommand({
  meta: {
    description: "Attach an Agent Skills spec skill to an environment",
  },
  args: {
    name: {
      type: "positional",
      description: "Skill name",
      required: true,
    },
    environment: {
      type: "string",
      description: "Environment name",
    },
  },
  async run({ args }) {
    const result = await addSkill(findProjectRoot(), args.name, args.environment);
    consola.success(`skill: ${result.name}`);
    consola.info(`environment: ${result.environment}`);
    consola.log("\nNext: envo pull " + result.environment);
  },
});

const listCommand = defineCommand({
  meta: {
    description: "List skills attached to environments",
  },
  async run() {
    const skills = await listSkills(findProjectRoot());
    if (skills.length === 0) {
      consola.info("No skills attached yet. Run `envo skills add <skill-name>`.");
      return;
    }

    for (const skill of skills) {
      consola.log(`${skill.environment}\t${skill.name}`);
    }
  },
});

export const skillsCommand = defineCommand({
  meta: {
    description: "Manage Agent Skills attached to environments",
  },
  subCommands: {
    add: addCommand,
    list: listCommand,
  },
});
