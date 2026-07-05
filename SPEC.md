# ENVO-PACK v1 — Portable Agent Environment Specification

Status: v1, implemented by envo ≥ 0.6.0
Format stability: additive changes only within v1; breaking changes bump the
manifest `version`.

## Purpose

An agent is productive when four things are true on the machine where it wakes
up. This spec defines the portable, encrypted artifact — the **pack** — that
makes all four true in one materialization step, on any machine, container,
edge worker, or CI runner, for any agent harness.

## The four layers

Every pack, and every conforming implementation, is organized around exactly
these four concerns:

### 1. Auth — how the agent talks to its model provider

The credential that connects a harness to its brain. Without it the other
three layers materialize a body with no model behind it. Two kinds:

| Kind | Examples | Materializes as |
|---|---|---|
| `env` | `OPENAI_API_KEY`, `OPENROUTER_API_KEY`, `ANTHROPIC_API_KEY`, `XAI_API_KEY`, `GROQ_API_KEY` | environment variable in the env file |
| `file` | Claude Code OAuth (`~/.claude/.credentials.json`), Codex OAuth (`~/.codex/auth.json`), OpenCode (`~/.local/share/opencode/auth.json`), Gemini CLI (`~/.gemini/oauth_creds.json`) | credential file written at the harness's own path, mode 0600 |

Normative behavior:

- Auth entries are **declared** on an environment (`envo auth add <provider>`)
  and **captured fresh at pack time** — so refreshed OAuth tokens ride along
  with every push, and a stale pack is one `envo push` from current.
- Captured credentials are encrypted into `auth.enc` with AAD
  `envo:auth:<project>/<environment>/v<packVersion>` — spliced auth fails
  authentication like any other layer.
- Materialization writes env-kind entries into the env file and file-kind
  entries to their target paths, creating parent directories, mode 0600.
  **Existing credential files are never overwritten** — a live token on the
  target machine beats a captured one.
- `doctor` MUST verify every declared credential is in place and name the
  missing provider otherwise.
- The provider table is open, like the harness registry: unknown providers
  are supported via an explicit credential path.
- Packing MUST fail loudly when a declared credential cannot be captured.
- **Refresh.** Implementations SHOULD refresh OAuth credentials client-side
  before capture when a token is expired or near expiry (refresh-token grant
  against the provider's own endpoint, using the harness's public client id),
  writing the result back to the source file. Refresh never involves the
  registry: the zero-knowledge model holds. When a captured token is live and
  the target machine's copy is expired, materialization SHOULD replace the
  expired copy (keeping a backup); a live local token always wins.
- Edge/serverless materializations merge env-kind entries into the runtime
  environment; file-kind entries require a filesystem and are skipped.

### 2. Harness — which agent shell the context materializes into

A **harness** is the agent runtime the environment targets: `claude-code`,
`codex`, `opencode`, `cursor`, `pi`, `devin`, `hermes`, `shell`, `custom`, …

The manifest names a default harness; materialization MAY be overridden
(`--harness`). A conforming **harness adapter** defines:

| Contract item | Meaning |
|---|---|
| `skillsDir(workDir)` | where this harness discovers skills (e.g. `.claude/skills`, `.agents/skills`, `~/.hermes/skills`) — `null` if not applicable |
| `contextFile` | the startup context file the harness reads (`CLAUDE.md`, `AGENTS.md`, `.cursor/rules/envo.md`, …) — created only if absent, never overwritten |

Implementations MUST always materialize the canonical copies
(`.envo/skills/`, `.envo/ENVIRONMENT.md`, `.envo/schema.json`) in addition to
the harness-native locations, so tooling has a harness-independent view.
Cloud-hosted harnesses with no local filesystem (e.g. `devin`) map to a no-op
adapter; their integration point is layer-1 auth + the registry API.

The adapter registry is intentionally open: adding a harness is a table entry,
not a format change. This is the layer that keeps the format neutral across
vendors.

### 3. Skills — what the agent knows how to do

- Skills are **directories of files** (conventionally containing `SKILL.md`),
  bundled into the pack by value (`kind: "bundled"`) or referenced by name
  (`kind: "ref"`).
- Packing MUST dereference symlinks (skill trees are frequently symlink
  farms).
- Materialization copies each bundled skill into the canonical dir and the
  harness `skillsDir`.
- The pack does not interpret skill contents; skills are opaque to the format.

### 4. Env / Secrets — what the agent is allowed to touch

- Secrets are environment variables, stored as one env-file body, encrypted
  client-side with **AES-256-GCM**. The server, registry, and network path
  never see plaintext or keys.
- Keys: a 32-byte key from `ENVO_KEY` (hex) or `~/.config/envo/master.key`
  (0600). v1 uses one key per principal; per-environment wrapped keys are the
  v2 direction.
- **Context binding (AAD).** Ciphertext is bound to its identity as GCM
  additional authenticated data, so blobs cannot be spliced or mis-served:
  - secrets: `envo:pack:<project>/<environment>/v<packVersion>`
  - registry bundle: `envo:bundle:<ref>`
  A box carrying AAD uses format `envo-secretbox-v2`; `-v1` (no AAD) remains
  readable for legacy packs.
- **Requirements schema.** `requiredKeys` in the manifest names env vars the
  environment needs. `doctor` MUST fail, naming the missing keys, when a
  required key is absent after materialization. This is the agent's
  self-diagnosis contract.

## Wire format

### Pack directory (local, canonical)

```text
<env>/v<N>/
  manifest.json    # see below
  secrets.enc      # SecretBox JSON (AES-256-GCM, AAD-bound)
  auth.enc         # layer-1 provider credentials (present iff declared)
  skills/<name>/   # bundled skill trees
```

### manifest.json

```jsonc
{
  "version": 1,                 // format version
  "packVersion": 3,             // monotonic per environment
  "project": "acme",
  "environment": "fleet-agent",
  "profile": "fleet-agent",
  "harness": "claude-code",     // layer 2 (alias: "runtime", legacy)
  "target": "local",            // deployment hint: local|docker|ssh|edge|…
  "secretKeys": ["OPENAI_API_KEY"],   // names only — never values
  "requiredKeys": ["OPENAI_API_KEY"], // doctor contract
  "skills": [{ "name": "agents-debug", "kind": "bundled" }],
  "auth": [                            // layer 1 — metadata only, no values
    { "provider": "openrouter", "kind": "env", "envKey": "OPENROUTER_API_KEY" },
    { "provider": "codex", "kind": "file", "targetPath": "~/.codex/auth.json" }
  ],
  "createdAt": "2026-07-04T00:00:00.000Z"
}
```

### SecretBox

```jsonc
{
  "format": "envo-secretbox-v2",  // v2 = AAD-bound; v1 = legacy, no AAD
  "iv": "<base64, 12 bytes>",
  "tag": "<base64, 16 bytes>",
  "data": "<base64 ciphertext>"
}
```

### Bundle (registry transport)

The entire pack directory, serialized as
`{format: "envo-bundle-v1", files: [{path, data(base64)}]}`, encrypted as one
SecretBox with AAD `envo:bundle:<ref>`. The registry stores this single opaque
blob per version. Extraction MUST reject paths containing `..`.

## Registry API (minimal conforming surface)

```text
PUT  /v1/packs/<project>/<environment>          # push (scope: push|admin)
GET  /v1/packs/<project>/<environment>/latest    # pull (any valid token)
GET  /v1/whoami                                  # token introspection
```

**Transport auth** (distinct from layer-1 provider auth): agents authenticate
to a registry with bearer tokens (`envo_` prefix) — scoped
(`pull`|`push`|`admin`, optionally per-project/environment), expiring,
revocable, hashed at rest, shown once at mint. A transport token grants
access to *ciphertext only*; decryption additionally requires the pack key,
which never transits the registry. Servers MUST enforce token scope, SHOULD
rate-limit per token, and MUST treat blobs as opaque.

## Materialization contract

Given a pack and a work directory, a conforming implementation produces:

```text
.env.d/<environment>.local     # decrypted env file
.envo/skills/<name>/           # canonical skills
<harness skillsDir>/<name>/    # harness-native skills (layer 2)
.envo/ENVIRONMENT.md           # self-description for the agent
<harness contextFile>          # created only if absent
.envo/schema.json              # requiredKeys for doctor
.envo/state.json               # environment + pack version provenance
```

then runs the doctor contract: green, or exit non-zero naming exactly what is
missing.

## Security invariants (normative)

1. Plaintext secrets never leave the client. Registries hold ciphertext only.
2. Decryption requires key **and** matching context (AAD) for v2 boxes.
3. Tokens are scoped, expiring, revocable, hashed at rest.
4. Secrets transit process boundaries via stdin or env — never argv.
5. Existing user files (`CLAUDE.md`, `AGENTS.md`, …) are never overwritten.
6. Release artifacts are integrity-checked (sha256 manifest) before install.

## Non-goals of v1

Team key wrapping (v2), org hierarchy (v2), signed packs (author signatures —
v2), harness process supervision, and any interpretation of skill contents.
