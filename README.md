# omp-agent-mesh

An [omp](https://omp.sh) extension that lets **separate omp sessions** see each other, message each other, and avoid stepping on each other's work.

It wraps [pi-messenger](https://github.com/nicobailon/pi-messenger) (0.15.2, unmodified) and adds two things pi-messenger is missing for omp:

1. **Subagents stay off the mesh.** omp re-runs extensions inside every subagent session. Without a gate, every spawned helper would join the mesh as a fake peer. Here, only main sessions join; subagents keep using omp's built-in IRC (`agent://`).
2. **A startup peer summary.** Each new main session gets a short hidden note naming the agents already online, what folder and branch they're in, and what they're doing. The agent knows about its peers before its first step, without spending a tool call.

Everything else (presence, direct messages that wake the receiver mid-run, broadcasts, file reservations that block conflicting edits, activity feed, stuck detection, `/messenger` overlay) is pi-messenger.

There is no daemon and no server. Agents coordinate through files in `~/.pi/agent/messenger/`, which pi-messenger maintains.

## Install

Requires omp 18.x, Bun, and pi-messenger's runtime deps (installed automatically as this package's dependencies).

```sh
git clone <this repo> ~/work/labs/omp-agent-mesh
cd ~/work/labs/omp-agent-mesh
bun install
omp plugin link ~/work/labs/omp-agent-mesh
```

`omp plugin link` makes the extension load in every omp session. Do **not** also install pi-messenger on its own (`omp install npm:pi-messenger`): it would load twice, once without the subagent gate.

## Configure

pi-messenger reads `~/.pi/agent/pi-messenger.json`. This repo ships a config at `config/pi-messenger.json`; link it:

```sh
ln -s ~/work/labs/omp-agent-mesh/config/pi-messenger.json ~/.pi/agent/pi-messenger.json
```

The shipped config auto-joins only sessions under `~/work/*`, turns off pi-messenger's Crew-oriented startup note (the peer summary replaces it), and disables the Crew overlay popups. Adjust `autoRegisterPaths` to your working roots. Note pi-messenger's glob support is simple: `~/work/*` matches everything under `~/work`, at any depth.

## Teach your agents the rules

Agents only coordinate if they're told to. Add something like this to your global omp `AGENTS.md`:

```markdown
## Multi-agent coordination (pi-messenger)

- Other omp agents may be running in other sessions. Run `pi_messenger` with action `list` before work that touches shared resources.
- Keep your status note current: what you're doing, which ports/containers you hold.
- Ports: before binding, check the port is free (`ss -ltn`). If a server fails on a taken port, pick another. Post the port in your status.
- Heavy shared work (docker, e2e, migrations, full builds): if a peer's status shows the same work, message them and wait instead of running in parallel.
- Before editing files outside your own worktree, reserve them with `pi_messenger` action `reserve`. Release when done.
- If your change affects a peer's work (API, schema, shared config), message them.
- Use only the messaging actions. Crew actions (`plan`, `work`, `review`) spawn `pi`, not omp; do not use them.
```

## How it works

| File              | Job                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/gate.ts`     | Wraps the `pi` object handed to pi-messenger. Its `session_start` handler runs only for main sessions (`ctx.agent.kind === "main"`). In subagent sessions, `index.ts` also removes the `pi_messenger` tool. It also absolutizes paths: pi-messenger matches reservations by exact string, so the gate resolves `edit`/`write` paths and `reserve`/`release` patterns against the session cwd first. |
| `src/registry.ts` | An Effect service that reads pi-messenger's `registry/*.json`, decodes each entry with Schema, and drops dead PIDs, the caller's own entry, and unreadable files.                                                                                                                                                                                                                                   |
| `src/brief.ts`    | Formats the peer summary text. Pure function.                                                                                                                                                                                                                                                                                                                                                       |
| `src/runtime.ts`  | One `ManagedRuntime` per omp process; Effect logs are bridged to omp's logger.                                                                                                                                                                                                                                                                                                                      |
| `src/index.ts`    | The omp entry point. Registers pi-messenger (gated), then on `session_start` inserts the peer summary as a hidden `nextTurn` message. A failed registry read never blocks session start.                                                                                                                                                                                                            |

Effect is used only where there is IO or failure to handle (reading the registry). The gate and the formatter are plain functions.

## Not included

- **Port allocation.** Agents announce ports in their status notes and check `ss -ltn` before binding. If collisions still happen, [port-selector](https://github.com/dapi/port-selector) is a good complement.
- **A Tern status-line plugin.** pi-messenger already shows peer and unread counts in omp's status bar.
- **Cross-machine meshes.** The registry is local files, so agents on different machines don't see each other.

## Development

```sh
bun run lint        # oxlint
bun run fmt         # oxfmt --check
bun run typecheck   # bun check --no-script --threads 4
bun run test        # bun test test/
bun run smoke       # real omp processes; needs a configured model provider
bun run check       # all of the above except smoke, in order
```

`bun run smoke` starts real omp sessions (a cheap model) in `~/work/labs/mesh-test-{a,b}` and checks: peers see each other, a message wakes a busy agent, a reserved file blocks another agent's edit, a fresh agent's startup brief names its peers, and subagents stay off the mesh.

Type checking is `bun check`; the language server is [tsrs](https://github.com/oxc-project/tsrs), pinned as a devDependency. There is deliberately no `typescript` package: both tools bundle TypeScript's lib files. pi-messenger's untyped upstream source is kept out of the typecheck by the compile-time seam in `src/pi-messenger.d.ts`; its runtime behaviour is covered by the smoke test.

## License

MIT
