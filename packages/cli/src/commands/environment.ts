import { createEnvironment, listEnvironments } from "@envo/core";
import { defineCommand } from "citty";
import { consola } from "consola";

const createCommand = defineCommand({
  meta: {
    description: "Create an environment",
  },
  args: {
    name: {
      type: "positional",
      description: "Environment name",
      default: "",
    },
    profile: {
      type: "string",
      description: "Profile name",
    },
    target: {
      type: "string",
      description: "Target runtime (local, docker, ssh, hosted)",
      default: "local",
    },
    agent: {
      type: "string",
      description: "Default agent runtime",
      default: "codex",
    },
    skills: {
      type: "string",
      description: "Comma-separated Agent Skills spec skill names",
    },
    yes: {
      type: "boolean",
      description: "Overwrite envo.toml if it already exists",
      default: false,
    },
  },
  async run({ args }) {
    const result = await createEnvironment(process.cwd(), {
      name: args.name || undefined,
      profile: args.profile,
      target: args.target,
      agent: args.agent,
      skills: args.skills?.split(",").map((skill) => skill.trim()).filter(Boolean),
      yes: args.yes,
    });

    consola.box("envo environment create");
    consola.success(`environment: ${result.environment.name}`);
    consola.info(`profile:     ${result.environment.profile}`);
    consola.info(`target:      ${result.environment.target}`);
    consola.info(`config:      ${result.configPath}`);
    consola.log("");
    consola.log("Next:");
    consola.log(`  envo skills add repo-bootstrap --environment ${result.environment.name}`);
    consola.log(`  envo secrets set OPENAI_API_KEY --environment ${result.environment.name}`);
    consola.log(`  envo pull ${result.environment.name}`);
    consola.log("  envo doctor");
  },
});

const listCommand = defineCommand({
  meta: {
    description: "List environments",
  },
  async run() {
    const environments = await listEnvironments(process.cwd());
    if (environments.length === 0) {
      consola.info("No environments yet. Run `envo environment create <project>`.");
      return;
    }

    for (const env of environments) {
      consola.log(`${env.name}\t${env.profile}\t${env.target}\t${env.agent}`);
    }
  },
});

export const environmentCommand = defineCommand({
  meta: {
    description: "Manage environments",
  },
  subCommands: {
    create: createCommand,
    list: listCommand,
  },
});
