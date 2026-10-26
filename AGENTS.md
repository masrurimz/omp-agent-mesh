# omp-agent-mesh

An omp extension package implementing a small agent mesh: separate omp sessions register presence, message each other (waking the receiver), claim files, and read a shared feed. State is files under `~/.omp/agent/mesh/`. Sessions are grouped by git repository (worktrees share a group). Subagent sessions never register as peers and get no `mesh` tool, but their edits obey other agents' claims and are attributed to the parent's presence and the feed (`<Parent>/<subagent>`).

## Effect

This repo uses Effect 4. Before writing any Effect code, read `node_modules/effect/AGENTS.md` completely, and grep `node_modules/effect/src` for any API name it does not show. Remembered Effect 3 names (`Context.Tag`, `Effect.catchAll`, `Effect.fork`, `Effect.async`) do not compile here.

Architecture rules:

- Failures are `Schema.TaggedError` classes in `src/domain/errors.ts`, each with context and a `MESH_*` fix-hint message. Methods fail with them; never return `{ kind: "none" }`-style result objects. Tool text derives from the error.
- Services are `Context.Service` classes whose `make` captures dependencies, so methods have no requirements, plus `static layer`. `src/services/live.ts` composes them. IO lives in `Presence`, `Inbox`, `Feed` (Effect `FileSystem`); every file is decoded with Schema at the boundary and failures are `MeshIoError`. Config comes from `MeshConfig`; tests use `MeshConfig.configLayer(values)`.
- One session is one `Scope`: `MeshSession.make` registers finalizers (leave feed event, presence removal, `MainRegistry` unregister) and forks the inbox watcher plus 5s heartbeat with `Effect.forkScoped`. Never hold session resources outside that scope.
- Session state is a `SubscriptionRef` and deliveries are a `PubSub`; time is `Clock` (so `TestClock` drives tests). Lifecycle is the pure Schema tagged union in `src/lifecycle/lifecycle.ts`; invalid transitions are `InvalidTransition`.
- The `mesh` tool input, output, and failures are Schemas in `src/contract/`. `defineMeshTool` derives the omp parameters from the input Schema and decodes at the edge; never hand-write parameter schemas.
- The only `ManagedRuntime` is the process runtime in `src/omp/runtime.ts`; `runPromise` is called only in `src/omp/index.ts`, which stays thin: run, log failures, never throw. No module-level `let`. Tests never use `Effect.run*` or a `ManagedRuntime`.
- Pure rules (target resolution, groups, paths, formatting) stay plain functions in `src/domain/`.
- No `any`, no `as` casts except the documented `ASIDE_OPTIONS` seam in `src/omp/index.ts`. Host fields missing from the pinned pi types are read with Schema in `src/omp/host.ts`.
- No comments except a non-obvious why.

## Checks

Run one after another, never in parallel:

```sh
bun run lint            # oxlint
bun run fmt             # oxfmt --check
bun run typecheck       # effect-tsrs diagnostics --strict (floating effects fail)
bun run typecheck:fast  # bun check --no-script --threads 4
bun run test            # vitest run (@effect/vitest)
bun run smoke           # real omp processes; needs a configured model provider
```

On shared machines, wrap heavy runs: `systemd-run --user --scope -p MemoryMax=8G <cmd>`. Check `free -h` first; if less than 15 GB is available, wait.

The language server is tsrs (pinned as a devDependency; omp's launcher prefers the repo pin). There is no `typescript` package on purpose: both tools bundle TypeScript's lib files.

Tests assert behavior and properties (claims never block their owner and always block others, throttle delay under `TestClock`, target resolution, broadcast scope, lifecycle model, scope cleanup), not internals or wiring. Use `it.effect`, `it.layer`, `it.prop`. When adding a property, plant a bug once to confirm it fails.

## Layout

- `src/domain/` Schemas, errors, and pure rules. `src/lifecycle/` the session state machine.
- `src/services/` the services and `live.ts` composition. `src/contract/` the tool contract and `defineMeshTool`.
- `src/omp/` the host edge: `index.ts` (hooks, registration), `mesh-tool.ts`, `runtime.ts`, `git.ts`, `host.ts`.
