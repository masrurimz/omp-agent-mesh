# omp-agent-mesh

An omp extension package implementing a small agent mesh: separate omp sessions register presence, message each other (waking the receiver), claim files, and read a shared feed. State is files under `~/.omp/agent/mesh/`. Sessions are grouped by git repository (worktrees share a group). Subagent sessions never register as peers and get no `mesh` tool, but their edits obey other agents' claims and are attributed to the parent's presence and the feed (`<Parent>/<subagent>`).

## Effect

This repo uses Effect 4. Before writing any Effect code, read `node_modules/effect/AGENTS.md` completely, and grep `node_modules/effect/src` for any API name it does not show. Remembered Effect 3 names (`Context.Tag`, `Effect.catchAll`, `Effect.fork`, `Effect.async`) do not compile here.

Architecture rules:

- Failures are `Schema.TaggedError` classes, one per file in `src/domain/` (`not-joined.ts`, `claim-conflict.ts`, ...), each with context and a `MESH_*` fix-hint message. Methods fail with them; never return `{ kind: "none" }`-style result objects. Tool text derives from the error. Schemas are named `*Schema` with a same-named type (`PeerSchema` and `Peer`).
- Services are `Context.Service` classes whose `make` captures dependencies, so methods have no requirements, plus `static layer`. `src/services/live.ts` composes them. IO lives in `Presence`, `Inbox`, `Feed` (Effect `FileSystem`); every file is decoded with Schema at the boundary and failures are `MeshIoError`. Config comes from `MeshConfig`; tests use `MeshConfig.configLayer(values)`.
- One session is one `Scope`: `MeshSession.make` registers finalizers (`LEAVE` to the lifecycle machine, which records the leave and removes presence; `MainRegistry` unregister) and forks the inbox watcher plus 5s heartbeat with `Effect.forkScoped`. Never hold session resources outside that scope.
- Session state is a `SubscriptionRef` inside the per-session `SessionState` service, and deliveries are a `PubSub`; time is `Clock` (so `TestClock` drives tests). The lifecycle is one XState machine in `src/lifecycle/session-machine.ts`, hosted by `@xstate/effect` (rat-stack convention): it starts only under `createEffectActor` in the `MeshSession` scope, never `createActor`; every side effect (join announce, presence status persist, leave cleanup) lives in a declared `createEffectLogic` actor registered through `setupEffect`, never inline; closing the scope sends `LEAVE` and waits for `left`. Unknown events are ignored by the machine; there is no invalid-transition error.
- The `mesh` tool input, output, and failures are Schemas in `src/contract/`. `defineMeshTool` derives the omp parameters from the input Schema and decodes at the edge; never hand-write parameter schemas.
- The only `ManagedRuntime` is the process runtime in `src/omp/runtime.ts`; `runPromise` is called only in `src/omp/index.ts`, which stays thin: run, log failures, never throw. No module-level `let`. Tests never use `Effect.run*` or a `ManagedRuntime`.
- Pure rules (target resolution, groups, paths, formatting) stay plain functions in `src/domain/`.
- No `any`, no `as` casts except the documented `ASIDE_DELIVERY` seam in `src/omp/index.ts`, which carries a `SAFETY:` line. Host fields missing from the pinned pi types are read with Schema in `src/omp/host.ts`.
- No comments (enforced, see Fence). Knowledge goes in names, tests, or the commit message.

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

Tests assert behavior and properties (claims never block their owner and always block others, throttle delay under `TestClock`, target resolution, broadcast scope, the lifecycle machine replayed over generated event sequences, scope cleanup), not internals or wiring. Use `it.effect`, `it.layer`, `it.prop`, `it.live.prop`. When adding a property, plant a bug once to confirm it fails.

## Layout

- `src/domain/` Schemas, errors, and pure rules. `src/lifecycle/` the XState session machine.
- `src/services/` the services and `live.ts` composition. `src/contract/` the tool contract and `defineMeshTool`.
- `src/omp/` the host edge: `index.ts` (hooks, registration), `mesh-tool.ts`, `runtime.ts`, `git.ts`, `host.ts`.

## Fence

Ported from rat-stack (https://ratstack.sh/AGENTS.md); credits in `PROVENANCE.md`. `oxlint.config.ts` extends `ultracite/oxlint/core` (typeAware) and adds:

- `no-comments/no-comments`: bans comments except tool directives with a `-- reason` and a one-line `SAFETY:` above a type assertion.
- `anti-slop/*` and `anti-slop-effect/*` (vendored in `tools/oxlint/anti-slop/`, see `UPSTREAM.md`): all enabled at error, including `require-safety-comment-for-type-assertion`, `no-unknown-parameters`, `no-manual-tag-comparison`, `prefer-effect-match`.
- `xstate-effect/no-inline-effect`: effects in machines are declared `createEffectLogic`, never inline.
- `rat-stack-patterns/no-module-level-mutable-state` (src only) and `rat-stack-patterns/acquire-release-constructs-in-acquire-body`.
- `effect-tests/no-manual-effect-runtime-in-tests`: `Effect.run*` and `ManagedRuntime.make` in test files are errors.
- Effect language-service severities in `tsconfig.json` are rat-stack's map, enforced by `effect-tsrs --strict`; `allowedUnstableApis` stays pinned.
- `.omp/extensions/vcs-policy.ts` (policy in `scripts/vcs-command-policy.ts`) blocks agent `bash` commands that pass `--no-verify` to git, and makes git/jj non-interactive.

Skipped rat-stack rules, for surfaces this repo does not have: Foldkit rules and `rat-stack-boundaries/*` (browser/server, capability projections, devtools, cloud), `rat-stack-patterns/{contract-binding-matches-name,flag-removal-date,learn-snippet-idiom,no-shared-pending-cache,shared-waiters,watch-effect-actors}`, and the debt-ledger plugin.

Gardener rule: the baseline is zero violations and only shrinks. Fix code rather than disable a rule. A targeted `oxlint-disable` or `@effect-diagnostics` directive needs `-- reason` and a true boundary (node builtins in `src/` where the Effect `Path` service would leak a requirement, native Promise edges in `src/omp/` and `scripts/smoke.ts`).
