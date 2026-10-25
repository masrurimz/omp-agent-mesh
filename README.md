# omp-agent-mesh

An [omp](https://omp.sh) extension that lets **separate omp sessions** see each other, message each other, and avoid stepping on each other's work.

Each main session joins a mesh on startup: it can list live peers, send messages that wake the receiver mid-run, broadcast, claim files so other agents' edits to them are blocked, and leave a status note. Subagent sessions stay off the mesh and keep using omp's built-in IRC (`agent://`).

There is no daemon and no server. Agents coordinate through files under `~/.omp/agent/mesh/` (presence, inboxes, feed), maintained by the extension inside each omp process.

History: v0.1 wrapped pi-messenger. v0.2 is our own engine, written after the wrapper accumulated one fix too many (subagent gating, path normalization, and neutralizing an upstream per-session message budget). Messages now arrive with `aside` delivery, so they land between steps without interrupting a running tool batch, and sends are throttled instead of capped.

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
- If your change affects a peer's work (API, schema, shared config), message them.
```

## How it works

| File              | Job                                                                                                                                                                                                                                                                      |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/index.ts`    | The omp entry point and the engine: registers the `mesh` tool, joins on `session_start` (main sessions under a mesh root only), watches the inbox, delivers messages, blocks edits to claimed files, and bridges omp callbacks to the Effect runtime for registry reads. |
| `src/store.ts`    | Plain filesystem state: presence write/read, liveness, dead-peer reaping, inbox append, feed, claim conflict lookup, name generation, and the send `Throttle` (token bucket: burst 5, then 1 per 20s, delayed and never rejected).                                       |
| `src/registry.ts` | An Effect service that reads presence files and decodes them with Schema at the boundary. Used for the startup brief and the `peers` action.                                                                                                                             |
| `src/peer.ts`     | The `Peer` and `Reservation` Schemas: the shape of a presence file.                                                                                                                                                                                                      |
| `src/paths.ts`    | Path rules: relative paths are absolutized against the session cwd; scheme URIs (`xd://`, `skill://`) are left alone; directory claims match by prefix.                                                                                                                  |
| `src/brief.ts`    | Formats the startup peer summary. Pure function.                                                                                                                                                                                                                         |
| `src/runtime.ts`  | One `ManagedRuntime` per session binding; Effect logs go to omp's logger.                                                                                                                                                                                                |

A new session's first turn contains a hidden summary (`Mesh peers online now:` plus one line per agent). Direct messages are delivered with `aside` and start a turn when the receiver is idle; broadcasts are passive and never wake anyone.

Effect is used where there is IO with failure modes worth typing (presence reads). The store is plain filesystem code; the throttle and formatter are pure.

## Deferred follow-ups

Tracked as issues:

- [#1](https://github.com/masrurimz/omp-agent-mesh/issues/1) stable per-worktree ports (port-selector). For now, agents announce ports in their notes and check `ss -ltn` before binding.
- [#2](https://github.com/masrurimz/omp-agent-mesh/issues/2) Tern status-line plugin for mesh state. For now, omp's status bar shows `mesh: <name> (N peers)`.
- [#3](https://github.com/masrurimz/omp-agent-mesh/issues/3) cross-machine mesh. Presence is local files, so agents on different machines don't see each other yet.
- [#4](https://github.com/masrurimz/omp-agent-mesh/issues/4) non-interrupting delivery. Done in v0.2 via `aside`; the issue stays as the record.

## Development

```sh
bun run lint        # oxlint
bun run fmt         # oxfmt --check
bun run typecheck   # bun check --no-script --threads 4
bun run test        # bun test test/
bun run smoke       # real omp processes; needs a configured model provider
bun run check       # all of the above except smoke, in order
```

`bun run smoke` starts real omp sessions (CommandCode DeepSeek) in `~/work/labs/mesh-test-{a,b}` and checks: peers see each other, a message wakes a busy agent and gets an ACK, a claimed file blocks another agent's edit, a fresh agent's startup brief names its peers, subagents stay off the mesh, and sends are throttled rather than budget-rejected.

Type checking is `bun check`; the language server is [tsrs](https://github.com/oxc-project/tsrs), pinned as a devDependency. There is deliberately no `typescript` package: both tools bundle TypeScript's lib files. Host API types come from `@earendil-works/pi-coding-agent` as a devDependency; omp rewrites those specifiers to its own packages at load time.

## License

MIT
