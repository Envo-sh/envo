#!/usr/bin/env bun
import { defineCommand, runMain } from "citty";
import { doctorCommand } from "./commands/doctor.ts";
import { environmentCommand } from "./commands/environment.ts";
import { secretsCommand } from "./commands/secrets.ts";
import { skillsCommand } from "./commands/skills.ts";
import { packCommand } from "./commands/pack.ts";
import { pullCommand } from "./commands/pull.ts";
import { pushCommand } from "./commands/push.ts";
import { upCommand } from "./commands/up.ts";
import { loginCommand, whoamiCommand } from "./commands/login.ts";
import { logoutCommand } from "./commands/logout.ts";
import { sshCommand } from "./commands/ssh.ts";
import { sandboxCommand } from "./commands/sandbox.ts";
import { authCommand } from "./commands/auth.ts";
import { mcpCommand } from "./commands/mcp.ts";
import { agentCommand } from "./commands/agent.ts";
import { updateCommand } from "./commands/update.ts";
import { CLI_VERSION } from "./version.ts";

const main = defineCommand({
  meta: {
    name: "envo",
    version: CLI_VERSION,
    description: "Portable encrypted environments for agents: push once, run anywhere",
  },
  subCommands: {
    login: loginCommand,
    logout: logoutCommand,
    agent: agentCommand,
    auth: authCommand,
    whoami: whoamiCommand,
    environment: environmentCommand,
    env: environmentCommand,
    secrets: secretsCommand,
    skills: skillsCommand,
    pack: packCommand,
    pull: pullCommand,
    ssh: sshCommand,
    sandbox: sandboxCommand,
    sbx: sandboxCommand,
    push: pushCommand,
    up: upCommand,
    doctor: doctorCommand,
    mcp: mcpCommand,
    update: updateCommand,
  },
});

runMain(main);
