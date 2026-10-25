# omp-agent-mesh

An omp extension package. It wraps `pi-messenger` so separate omp sessions can see and message each other, and adds a startup peer summary. Subagent sessions are kept off the mesh; they use omp's built-in IRC.

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

- `src/gate.ts` keeps subagent sessions from joining the mesh, and absolutizes edit/reserve paths so pi-messenger's exact-string reservation matching works with relative paths.
- `src/registry.ts` reads pi-messenger's registry with Effect Schema at the boundary.
- `src/brief.ts` formats the peer summary. Pure; no Effect.
- `src/index.ts` is the omp entry point and the only place omp callbacks meet the Effect runtime.
