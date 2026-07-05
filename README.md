# envo

**The environment layer for coding agents.** One command gives any agent, on
any machine, the secrets, env vars, skills, and provider auth it needs — as
an encrypted pack the server can never read.

```sh
curl -fsSL https://envo.sh/install | sh
envo login          # pairs this machine in your browser
envo up acme/prod   # secrets, skills, and provider auth, materialized
```

Works with Claude Code, Codex, Cursor, OpenCode, and anything else that
reads an environment. Hosted sync, sandboxes, and the dashboard live at
[envo.sh](https://envo.sh).

## Why this repo is public

Envo's core claim is zero-knowledge: **your secrets are encrypted before
they leave your machine, and the server stores ciphertext it cannot
decrypt.** A claim like that from a closed-source client is just marketing.
This repository is the client — the code that runs on your machine and does
the encryption — so the claim is auditable:

- AES-256-GCM client-side encryption: [`packages/core/src/crypto.ts`](packages/core/src/crypto.ts)
- Context binding (AAD) so ciphertext can't be served for the wrong
  environment: [`packages/core/src/bundle.ts`](packages/core/src/bundle.ts)
- Fresh provider-auth capture and client-side OAuth refresh:
  [`packages/core/src/auth.ts`](packages/core/src/auth.ts),
  [`packages/core/src/refresh.ts`](packages/core/src/refresh.ts)
- The full wire format and invariants: [ENVO-PACK specification](SPEC.md)

The hosted registry and web app are closed source; they only ever see
encrypted blobs. Nothing in this repo phones home beyond the registry API
calls you can read.

## Install

```sh
curl -fsSL https://envo.sh/install | sh     # macOS (Apple Silicon) & Linux
brew install envo-sh/tap/envo               # Homebrew
```

Binaries are single-file Bun compiles, released with sha256 checksums that
the installer verifies.

## Layout

```text
packages/
  cli/    # the `envo` binary — commands, terminal UX
  core/   # connect, pack, crypto, sync, doctor — the auditable part
skills/   # agent onboarding skills
examples/ # example envo.toml
SPEC.md   # ENVO-PACK v1 — the portable agent environment format
```

## Develop

```sh
bun install
bun run envo -- doctor      # run the CLI from source
bun run typecheck
cd packages/core && bun test
```

## Security

See [SECURITY.md](SECURITY.md) for the security model and how to report
vulnerabilities privately.

## License

[Apache-2.0](LICENSE)
