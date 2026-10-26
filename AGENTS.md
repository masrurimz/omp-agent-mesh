# omp-agent-mesh

An omp extension package implementing a small agent mesh: separate omp sessions register presence, message each other (waking the receiver), claim files, and read a shared feed. State is files under `~/.omp/agent/mesh/`. Sessions are grouped by git repository (worktrees share a group). Subagent sessions never register as peers and get no `mesh` tool, but their edits obey other agents' claims and are attributed to the parent's presence and the feed (`<Parent>/<subagent>`).

## Effect

This repo uses Effect 4. Before writing any Effect code, read `node_modules/effect/AGENTS.md` completely, and grep `node_modules/effect/src` for any API name it does not show. Remembered Effect 3 names (`Context.Tag`, `Effect.catchAll`, `Effect.fork`, `Effect.async`) do not compile here.

Architecture rules:

- IO lives in the `MeshStore` service (Effect `FileSystem`); every file is decoded with Schema at the boundary and failures are the tagged `MeshIoError`.
- One session is one `Scope`: `joinMesh` registers finalizers (leave feed event, presence removal, `MainRegistry` unregister) and forks the inbox watcher plus 5s heartbeat with `Effect.forkScoped`. Never hold session resources outside that scope.
- State is a `Ref`, time is `Clock` (so `TestClock` drives tests). Presence writes are serialized by a semaphore.
- The runtime and `MainRegistry` are module-level: omp rebinds the factory per session but shares module state, which is how a subagent session reaches its parent. Callbacks in `src/index.ts` stay thin: `runtime.runPromise`, log failures, never throw.
- Pure rules (target resolution, groups, paths, formatting) stay plain functions in `peers.ts`, `paths.ts`, `brief.ts`.
- No `any`, no `as` casts except the documented `ASIDE_OPTIONS` seam in `src/index.ts`. Host fields missing from the pinned pi types are read with Schema in `src/host.ts`.

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

Tests assert behavior (store round-trips, scope cleanup, throttle under `TestClock`, subagent attribution), not internals.

## Layout

- `src/index.ts` is the omp entry point (tool, lifecycle hooks, claim blocking for main and subagent sessions).
- `src/session.ts` is `joinMesh` and the `MeshSession` operations. `src/mesh-store.ts` is the store. `src/main-registry.ts` links subagents to the main session.
- `src/throttle.ts`, `src/git.ts`, `src/config.ts`, `src/host.ts`, `src/runtime.ts` are the supporting Effects and boundaries.
- `src/peer.ts`, `src/message.ts`, `src/errors.ts` hold the Schemas and the error.
- `src/peers.ts`, `src/paths.ts`, `src/brief.ts` hold the pure rules and formatters.
