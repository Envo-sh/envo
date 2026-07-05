import { hireAgent, listAgents, retireAgent } from "@envo/core";
import { defineCommand } from "citty";
import { consola } from "consola";

const createCmd = defineCommand({
  meta: {
    description: "Create an agent: mints its identity and prints its onboarding command",
  },
  args: {
    name: { type: "positional", description: "Agent name (e.g. atlas)", required: true },
    env: { type: "string", description: "Environment ref: <project>/<environment>", required: true },
    registry: { type: "string", description: "Registry URL" },
    json: { type: "boolean", default: false },
  },
  async run({ args }) {
    const hired = await hireAgent(args.name, args.env, { registry: args.registry });
    if (args.json) {
      console.log(JSON.stringify(hired, null, 2));
      return;
    }
    consola.success(`hired ${hired.agent.slug} → ${hired.agent.environment}`);
    consola.info(`identity: ${hired.tokenPrefix}… (pull-only, scoped to its environment — shown once)`);
    consola.log("\nOnboard it anywhere — container, CI, VM, sandbox:\n");
    consola.log(`  ${hired.bootstrap}\n`);
    consola.log("Retire it (revokes the identity instantly): envo agent retire " + hired.agent.slug);
  },
});

const listCmd = defineCommand({
  meta: { description: "Your roster" },
  args: {
    registry: { type: "string", description: "Registry URL" },
    json: { type: "boolean", default: false },
  },
  async run({ args }) {
    const agents = await listAgents({ registry: args.registry });
    if (args.json) {
      console.log(JSON.stringify(agents, null, 2));
      return;
    }
    if (!agents.length) {
      consola.info("No agents yet. Hire one: envo agent create <name> --env <project>/<environment>");
      return;
    }
    for (const a of agents) {
      const ref = a.project_slug ? `${a.project_slug}/${a.environment_slug}` : "-";
      const active = a.last_used_at ? `active ${a.last_used_at.slice(0, 16).replace("T", " ")}` : "never active";
      const line = `${a.slug.padEnd(18)} ${ref.padEnd(28)} ${String(a.pulls).padStart(4)} pulls  ${active}`;
      if (a.status === "retired") consola.log(`${line}  (retired)`);
      else consola.log(line);
    }
  },
});

const retireCmd = defineCommand({
  meta: { description: "Retire an agent and revoke its identity" },
  args: {
    agent: { type: "positional", description: "Agent slug or id", required: true },
    registry: { type: "string", description: "Registry URL" },
  },
  async run({ args }) {
    await retireAgent(args.agent, { registry: args.registry });
    consola.success(`retired ${args.agent} — its identity token is revoked`);
  },
});

export const agentCommand = defineCommand({
  meta: {
    description: "Your agent roster: hire, list, retire",
  },
  subCommands: {
    create: createCmd,
    hire: createCmd,
    list: listCmd,
    ls: listCmd,
    retire: retireCmd,
    rm: retireCmd,
  },
});
