# omp-agent-mesh

An [omp](https://omp.sh) extension that lets **separate omp sessions** see each other, message each other, and avoid stepping on each other's work.

Each main session joins a mesh on startup: it can list live peers, send messages that wake the receiver mid-run, broadcast, claim files so other agents' edits to them are blocked, and leave a status note. Subagent sessions never join as peers and get no `mesh` tool, but they are visible and accountable: their edits respect other agents' claims, and the parent's presence shows how many subagents are running and what they last edited.

There is no daemon and no server. Agents coordinate through files under `~/.omp/agent/mesh/` (presence, inboxes, feed), maintained by the extension inside each omp process.

History: v0.1 wrapped pi-messenger. v0.2 was our own imperative engine. v0.3 rebuilt it on Effect 4. v0.4 made it idiomatic Effect: typed errors, `Context.Service` services composed in one layer, a Schema-derived tool contract, live state on `SubscriptionRef`/`PubSub`, and `@effect/vitest` property tests. v0.5 replaces the hand-built lifecycle with an XState v6 machine hosted by `@xstate/effect`, following the [rat-stack](https://ratstack.sh/AGENTS.md) convention: the machine owns the states, declared Effect actors own the side effects.

## Concepts

- **Repo group.** Sessions in the same git repository (including its worktrees) form a group. `peers` lists your group first, `broadcast` defaults to it, and the startup brief only names group members. `peers` with `all: true` and `broadcast` with `scope: "all"` reach other repos.
- **Title addressing.** `send` accepts an agent handle (`GoldXenon`), a title card (the `PLAN` in a session titled `PLAN: auth rewrite`), or a substring of a title. Ambiguous matches are rejected with the candidate handles.
- **Subagent attribution.** A subagent's `edit`/`write` is checked against other agents' claims and blocked like any peer's. Allowed edits are recorded on the parent's presence (`subagents` running count, `recent` edits labelled with the subagent) and in the feed as `<Parent>/<subagent>`. Peers render it as `@GoldXenon — repo — working — 3 subagents — last edit src/auth.ts (scout)`.

## Install

Requires omp 18.x and Bun.

```sh
git clone https://github.com/masrurimz/omp-agent-mesh
cd omp-agent-mesh
bun install
omp plugin link "$PWD"
```

`omp plugin link` makes the extension load in every omp session.

## Configure

The extension auto-joins sessions whose cwd is under a configured root. Config lives at `~/.omp/agent/mesh.json`:

```sh
ln -s "$PWD/config/mesh.json" ~/.omp/agent/mesh.json
```

Shipped default: `{ "roots": ["~/work/*"] }`, which matches everything under `~/work` at any depth. Without a config file, that default applies.

State directory defaults to `~/.omp/agent/mesh`; override with `OMP_AGENT_MESH_DIR`.

## Teach your agents the rules

Agents only coordinate if they are told to. Add something like this to your global omp `AGENTS.md`:

```markdown
## Multi-agent coordination (mesh)

- Other omp agents may be running in other sessions. Run the `mesh` tool with action `peers` before work that touches shared resources.
- Keep your status current with `mesh` action `note`: what you're doing, which ports/containers you hold.
- Ports: before binding, check the port is free (`ss -ltn`). If a server fails on a taken port, pick another. Post the port in your note.
- Heavy shared work (docker, e2e, migrations, full builds): if a peer's status shows the same work, message them with `mesh` action `send` and wait instead of running in parallel.
- Before editing files outside your own worktree, claim them with `mesh` action `claim`. Release with action `release` when done. Edits to files another agent claimed are blocked automatically.
- If your change affects a peer's work (API, schema, shared config), message them. `broadcast` defaults to your repo group; pass `scope: "all"` for every agent on the machine. `send` accepts a handle or a title card such as `PLAN`.
```

## How it works

| Path | Job |
| --- | --- |
| `src/domain/*` | One `Schema.TaggedError` per failure file (`not-joined.ts`, `target-not-found.ts`, `target-ambiguous.ts`, `claim-conflict.ts`, `empty-body.ts`, `invalid-input.ts`, `mesh-io-error.ts`), each carrying context and a `MESH_*` message with a fix hint. Also the schemas (`PeerSchema`, `MeshMessageSchema`, `FeedEventSchema`) and the pure rules: target resolution, groups, claim matching, paths, roots, reservations, peer formatting. |
| `src/lifecycle/session-machine.ts` | The session lifecycle as one XState machine (`joining`, `idle`, `working`, `departing`, `left`) run by `createEffectActor` inside the session scope. Declared `createEffectLogic` actors announce the join, persist the status to presence, and record the leave. Events the current state does not handle are ignored. |
| `src/services/*` | `Context.Service` classes whose `make` captures dependencies: `MeshConfig`, `Presence`, `Inbox`, `Feed`, `Claims`, `Throttle`, `MainRegistry`, the per-session `SessionState` (live peer state and presence writes), and the scoped `MeshSession`. `live.ts` composes the stores into `MeshServices`. |
| `src/contract/*` | The `mesh` tool as a Schema tagged union per action, plus `defineMeshTool`, which derives the omp tool parameters from the Schema and decodes input at the edge. |
| `src/omp/index.ts` | The omp edge: registers the tool and hooks, and is the only place that calls `runtime.runPromise`. Failures are logged or returned as tool text, never thrown. |
| `src/omp/mesh-tool.ts` | The `mesh` tool handler: maps each action onto session methods. |
| `src/omp/runtime.ts` | The single process `ManagedRuntime`; Effect logs go to omp's logger. |
| `src/omp/git.ts`, `src/omp/host.ts` | Git lookups as Effects, and Schema readers for host fields the pinned pi types lack (`ctx.agent`, `pi.logger`). |

**Typed errors.** Session methods fail with the tagged errors above; there are no result objects like `{ kind: "none" }`. Tool text derives from the error message, for example `MESH_TARGET_AMBIGUOUS: "auth" matches GoldXenon, RedOwl. Fix: send to one exact handle.`

**Lifecycle machine.** `joining` runs the `announce` actor (presence plus the feed `join`) and lands in `idle.synced`. `AGENT_START` and `AGENT_END` move between `idle` and `working`; each entry runs the `publishStatus` actor and settles in `synced`, or in `unsynced` with the `MeshIoError` in context when the presence write fails, so `agentStarted` and `agentEnded` fail with that error and the next event retries. `LEAVE` runs the `depart` actor (feed `leave`, presence removal) and ends in the final `left` state. The machine starts with `createEffectActor` in the `MeshSession` scope; closing the scope sends `LEAVE`, waits for `left`, then stops the actor. Unknown events are ignored by the machine, so there is no invalid-transition error.

**Tool schema.** `src/contract/mesh-contract.ts` defines the input as a Schema tagged union. `defineMeshTool` calls `Schema.toJsonSchemaDocument` on it and merges the per-action variants into the single object schema providers require (a key is required only when every action requires it). The decoder stays authoritative: input is decoded per action, and a bad call returns `MESH_INVALID_INPUT` text.

**Cleanup guarantee.** `session_start` creates a `Scope` and builds `MeshSession` in it. Finalizers run in reverse order when the scope closes (`leave` action or `session_shutdown`): the heartbeat/watch fibers are interrupted, the session is unregistered from `MainRegistry`, then the leave event is appended and the presence file removed.

**Live state.** Session state is a `SubscriptionRef`. The status bar subscribes to its changes, and delivered messages flow through a `PubSub` the host subscribes to.

**Subagent linkage.** omp reuses the extension factory for every session in the process (`ctx.agent.kind === "sub"` identifies subagents) and keeps process-level state shared. The one process `ManagedRuntime` and its `MainRegistry` therefore outlive any session. A subagent session finds its parent through `MainRegistry.current`. This assumes one main session per process, which holds for omp's TUI and print modes. In-process subagents running in an isolated worktree have a different cwd, so claims made with other absolute paths do not match their relative edits.

## Deferred follow-ups

Tracked as issues:

- [#1](https://github.com/masrurimz/omp-agent-mesh/issues/1) stable per-worktree ports (port-selector). For now, agents announce ports in their notes and check `ss -ltn` before binding.
- [#2](https://github.com/masrurimz/omp-agent-mesh/issues/2) Tern status-line plugin for mesh state. For now, omp's status bar shows `mesh: <name> (N peers)`.
- [#3](https://github.com/masrurimz/omp-agent-mesh/issues/3) cross-machine mesh. Presence is local files, so agents on different machines don't see each other yet.
- [#4](https://github.com/masrurimz/omp-agent-mesh/issues/4) non-interrupting delivery. Done in v0.2 via `aside`; the issue stays as the record.

## Development

```sh
bun run lint        # oxlint (the fence: ultracite core, vendored anti-slop, rat-stack plugins)
bun run fmt         # oxfmt --check
bun run typecheck   # effect-tsrs diagnostics --strict
bun run typecheck:fast # bun check --no-script --threads 4
bun run test        # vitest run (@effect/vitest, property tests)
bun run smoke       # real omp processes; needs a configured model provider
bun run check       # all of the above except smoke, in order
```

`bun run smoke` recreates `~/work/labs/mesh-test-{a,b,c}` (a git repo, a worktree of it, and a separate repo), starts real omp sessions (CommandCode DeepSeek), and asserts on the feed, presence, and inbox files rather than on model narration. Checks: peers see each other, a message wakes a busy agent and gets an ACK, a claimed file blocks another agent's edit, a fresh agent's startup brief names its peers, subagents stay off the mesh, sends are throttled rather than budget-rejected, broadcast stays in the repo group by default, `scope: "all"` reaches the other repo, a subagent's edit to a claimed file is blocked and attributed as `<Parent>/<subagent>`, and the parent's presence shows its running subagent count.

The fence is ported from [rat-stack](https://github.com/joelhooks/rat-stack): see `AGENTS.md` for the rule list and `PROVENANCE.md` for credits. `prek run --all-files` runs the same gates as the commit hook. `.omp/extensions/vcs-policy.ts` blocks agent `git ... --no-verify` inside omp sessions.

`bun run typecheck` runs strict Effect diagnostics ([`@yielded/effect-tsrs`](https://www.npmjs.com/package/@yielded/effect-tsrs)): floating effects and other Effect rule violations fail the gate. `typecheck:fast` is the plain `bun check` pass; its language server is [tsrs](https://github.com/oxc-project/tsrs), pinned as a devDependency. There is deliberately no `typescript` package: both tools bundle TypeScript's lib files. Host API types come from `@earendil-works/pi-coding-agent` as a devDependency; omp rewrites those specifiers to its own packages at load time.

## License

MIT
