# Contributing

Thanks for looking under the hood — that is the point of this repo.

## Development

```sh
bun install
bun run envo -- doctor        # run the CLI from source
bun run typecheck
cd packages/core && bun test
```

## What we take

- Bug fixes, harness adapters (new agent runtimes in `packages/core/src/runtime.ts`),
  provider auth adapters (`packages/core/src/refresh.ts`), and spec clarifications.
- For anything larger, open an issue first — the hosted registry is closed
  source, so changes that assume server behavior need discussion.

## Ground rules

- `bun run typecheck` and the core test suite must pass.
- Security issues go through [SECURITY.md](SECURITY.md), never public issues.
- Secrets must never transit argv, and existing user credential files are
  never overwritten — these are spec invariants (see SPEC.md), not style.
