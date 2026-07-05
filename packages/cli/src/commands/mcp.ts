import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  bundleAad,
  describeExpiry,
  expandHome,
  extractBundle,
  fetchPack,
  inspectAuthContent,
  loadState,
  materializePack,
  runDoctor,
} from "@envo/core";
import { defineCommand } from "citty";
import { CLI_VERSION } from "../version.ts";

/**
 * MCP server over stdio — agents provision their own environment.
 *
 *   { "mcpServers": { "envo": { "command": "envo", "args": ["mcp"] } } }
 *
 * Auth comes from ENVO_TOKEN/ENVO_KEY in the harness's environment or the
 * local envo config, exactly like the CLI.
 */

const TOOLS = [
  {
    name: "envo_up",
    description:
      "Materialize an Envo environment into a directory: decrypted env vars, agent skills, provider auth, and context files. Use when you need credentials, secrets, or skills that are missing from this machine. Returns a doctor report of what is now present.",
    inputSchema: {
      type: "object",
      properties: {
        ref: { type: "string", description: "Environment ref: <project>/<environment>" },
        dir: { type: "string", description: "Directory to materialize into (default: cwd)" },
        harness: {
          type: "string",
          description: "Harness override for skill placement (claude-code, codex, opencode, cursor, ...)",
        },
      },
      required: ["ref"],
      additionalProperties: false,
    },
  },
  {
    name: "envo_doctor",
    description:
      "Verify the Envo environment in a directory: required env keys, provider credentials (including OAuth expiry), and skills. Returns exactly what is missing and how to fix it.",
    inputSchema: {
      type: "object",
      properties: {
        dir: { type: "string", description: "Directory to check (default: cwd)" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "envo_auth_status",
    description:
      "Report model-provider credential status for the environment in a directory: which providers are attached and when OAuth tokens expire.",
    inputSchema: {
      type: "object",
      properties: {
        dir: { type: "string", description: "Directory to check (default: cwd)" },
      },
      additionalProperties: false,
    },
  },
];

type Json = Record<string, unknown>;

function textResult(id: unknown, text: string, isError = false): Json {
  return {
    jsonrpc: "2.0",
    id,
    result: { content: [{ type: "text", text }], isError },
  };
}

async function callTool(name: string, args: Json): Promise<string> {
  if (name === "envo_up") {
    const ref = String(args.ref ?? "");
    if (!/^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/.test(ref)) {
      throw new Error(`invalid ref: ${ref} (expected <project>/<environment>)`);
    }
    const dir = resolve(String(args.dir ?? "."));
    const blob = await fetchPack(ref, {});
    const packDir = await extractBundle(blob, { aad: bundleAad(ref) });
    const result = await materializePack(dir, packDir, {
      harness: args.harness ? String(args.harness) : undefined,
    });
    const report = await runDoctor(dir);
    return JSON.stringify(
      {
        ref,
        dir,
        environment: result.manifest.environment,
        packVersion: result.manifest.packVersion,
        envFile: result.envFile,
        secretKeys: result.manifest.secretKeys,
        skills: result.skills,
        contextFiles: result.contextFiles,
        auth: result.auth,
        doctor: { ok: report.ok, checks: report.checks },
      },
      null,
      2,
    );
  }

  if (name === "envo_doctor") {
    const dir = resolve(String(args.dir ?? "."));
    const report = await runDoctor(dir);
    return JSON.stringify({ ok: report.ok, checks: report.checks }, null, 2);
  }

  if (name === "envo_auth_status") {
    const dir = resolve(String(args.dir ?? "."));
    const state = await loadState(dir);
    const entries = state?.environments?.[0]?.auth ?? [];
    const rows = [];
    for (const a of entries) {
      if (a.kind === "env") {
        rows.push({ provider: a.provider, kind: "env", envKey: a.envKey });
      } else {
        const dest = expandHome(a.targetPath ?? "");
        if (!existsSync(dest)) {
          rows.push({ provider: a.provider, kind: "file", status: "missing", path: a.targetPath });
        } else {
          const info = inspectAuthContent(a.provider, await readFile(dest, "utf8"));
          rows.push({
            provider: a.provider,
            kind: "file",
            status: info.expired ? "expired" : "ok",
            expiry: describeExpiry(info),
            refreshable: info.refreshable,
          });
        }
      }
    }
    return JSON.stringify({ auth: rows }, null, 2);
  }

  throw new Error(`unknown tool: ${name}`);
}

async function handle(message: Json): Promise<Json | null> {
  const { id, method, params } = message as { id?: unknown; method?: string; params?: Json };
  if (id === undefined && method?.startsWith("notifications/")) return null;

  switch (method) {
    case "initialize":
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: (params?.protocolVersion as string) ?? "2025-06-18",
          capabilities: { tools: {} },
          serverInfo: { name: "envo", version: CLI_VERSION },
        },
      };
    case "ping":
      return { jsonrpc: "2.0", id, result: {} };
    case "tools/list":
      return { jsonrpc: "2.0", id, result: { tools: TOOLS } };
    case "tools/call": {
      const name = String((params as Json)?.name ?? "");
      const args = ((params as Json)?.arguments ?? {}) as Json;
      try {
        return textResult(id, await callTool(name, args));
      } catch (error) {
        return textResult(id, error instanceof Error ? error.message : String(error), true);
      }
    }
    default:
      if (id === undefined) return null;
      return {
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: `method not found: ${method}` },
      };
  }
}

export const mcpCommand = defineCommand({
  meta: {
    description: "Run an MCP server over stdio so agents can provision their own environment",
  },
  async run() {
    const writer = Bun.stdout.writer();
    let buffer = "";
    for await (const chunk of Bun.stdin.stream()) {
      buffer += new TextDecoder().decode(chunk);
      let newline: number;
      while ((newline = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        let message: Json;
        try {
          message = JSON.parse(line) as Json;
        } catch {
          continue;
        }
        const response = await handle(message);
        if (response) {
          writer.write(JSON.stringify(response) + "\n");
          await writer.flush();
        }
      }
    }
  },
});
