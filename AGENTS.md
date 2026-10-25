# omp-agent-mesh

An omp extension package implementing a small agent mesh: separate omp sessions register presence, message each other (waking the receiver), claim files, and read a shared feed. State is files under `~/.omp/agent/mesh/`. Subagent sessions are kept off the mesh; they use omp's built-in IRC.

## Effect

This repo uses Effect 4. Before writing any Effect code, read `node_modules/effect/AGENTS.md` completely, and grep `node_modules/effect/src` for any API name it does not show. Remembered Effect 3 names (`Context.Tag`, `Effect.catchAll`, `Effect.fork`, `Effect.async`) do not compile here.

## Checks

Run one after another, never in parallel:

```sh
bun run lint        # oxlint
bun run fmt         # oxfmt --check
bun run typecheck   # bun check --no-script --threads 4
bun run test        # bun test test/
bun run smoke       # real omp processes; needs a configured model provider
```

On shared machines, wrap heavy runs: `systemd-run --user --scope -p MemoryMax=8G <cmd>`. Check `free -h` first; if less than 15 GB is available, wait.

Type checking is `bun check`. The language server is tsrs (pinned as a devDependency; omp's launcher prefers the repo pin). There is no `typescript` package on purpose: both tools bundle TypeScript's lib files.

## Layout

- `src/index.ts` is the omp entry point and the engine (tool, lifecycle hooks, inbox delivery, claim blocking).
- `src/store.ts` owns the filesystem state and the send throttle.
- `src/registry.ts` reads presence with Effect Schema at the boundary (brief, `peers`).
- `src/paths.ts` holds path matching rules. `src/brief.ts` formats the peer summary (pure).
