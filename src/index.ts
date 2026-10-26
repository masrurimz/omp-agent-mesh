import { homedir } from "node:os";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Cause, Effect, Exit, Option, Ref, Scope } from "effect";
import { Type } from "typebox";
import { formatBrief, formatPeerList } from "./brief.ts";
import { loadRoots, underRoots } from "./config.ts";
import { repoInfo } from "./git.ts";
import { agentOf, hostLogger } from "./host.ts";
import { MainRegistry } from "./main-registry.ts";
import { absolutize, editedPaths } from "./paths.ts";
import { effectiveGroup, folderName, type ClaimConflict } from "./peers.ts";
import { bindHostLog, runtime, type MeshEnv } from "./runtime.ts";
import { joinMesh, type MeshSession } from "./session.ts";

interface Handle {
  readonly session: MeshSession;
  readonly scope: Scope.Closeable;
}

// omp supports deliverAs "aside" at runtime (lands at the next step boundary
// without interrupting the current tool batch); the upstream pi types predate it.
const ASIDE_OPTIONS = { deliverAs: "aside", triggerTurn: true } as unknown as {
  deliverAs: "steer";
  triggerTurn: boolean;
};

const blockReason = (path: string, conflict: ClaimConflict): string =>
  [
    path,
    `Reserved by: ${conflict.peer.name} (in ${folderName(conflict.peer.cwd)})`,
    ...(conflict.reservation.reason ? [`Reason: "${conflict.reservation.reason}"`] : []),
    "",
    `Coordinate with the mesh tool: send to "${conflict.peer.name}".`,
  ].join("\n");

export default function (pi: ExtensionAPI) {
  const logger = hostLogger(pi);
  bindHostLog((level, message) => {
    if (level === "Warn" || level === "Error") logger?.warn(`mesh: ${message}`);
  });

  const handle = Ref.makeUnsafe(Option.none<Handle>());

  const run = <A, E>(effect: Effect.Effect<A, E, MeshEnv>, fallback: A): Promise<A> =>
    runtime.runPromise(
      effect.pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning(Cause.pretty(cause)).pipe(Effect.as(fallback)),
        ),
      ),
    );

  const closeHandle = Effect.gen(function* () {
    const current = yield* Ref.modify(handle, (h) => [h, Option.none<Handle>()] as const);
    if (Option.isSome(current)) yield* Scope.close(current.value.scope, Exit.void);
  });

  const onMain = (use: (main: MeshSession) => Effect.Effect<void, unknown>) =>
    Effect.gen(function* () {
      const main = yield* (yield* MainRegistry).current;
      if (Option.isSome(main)) yield* use(main.value);
    });

  const onOwn = (use: (own: MeshSession) => Effect.Effect<void, unknown>) =>
    Effect.gen(function* () {
      const own = yield* Ref.get(handle);
      if (Option.isSome(own)) yield* use(own.value.session);
    });

  const refreshStatus = (ctx: ExtensionContext) =>
    run(
      onOwn((session) =>
        session.statusLine.pipe(Effect.map((text) => ctx.ui.setStatus("mesh", text))),
      ),
      undefined,
    );

  const readTitle = Effect.try(() => pi.getSessionName()).pipe(
    Effect.orElseSucceed(() => undefined),
  );

  pi.registerTool({
    name: "mesh",
    label: "Mesh",
    description:
      "Coordinate with other omp sessions on this machine. Actions: peers (who is online), send (to: handle, title card, or title text; body), broadcast (body; scope group by default, all for every repo), claim (paths), release (paths optional), note (body), feed, leave.",
    parameters: Type.Object({
      action: Type.Union([
        Type.Literal("peers"),
        Type.Literal("send"),
        Type.Literal("broadcast"),
        Type.Literal("claim"),
        Type.Literal("release"),
        Type.Literal("note"),
        Type.Literal("feed"),
        Type.Literal("leave"),
      ]),
      to: Type.Optional(
        Type.String({ description: "Recipient for send: agent handle, title card, or title text" }),
      ),
      body: Type.Optional(
        Type.String({ description: "Message text (send/broadcast) or status note (note)" }),
      ),
      paths: Type.Optional(
        Type.Array(Type.String(), { description: "Files or directories (claim/release)" }),
      ),
      reason: Type.Optional(Type.String({ description: "Why you are claiming these paths" })),
      limit: Type.Optional(Type.Number({ description: "Feed lines to return" })),
      all: Type.Optional(Type.Boolean({ description: "peers: include other repo groups" })),
      scope: Type.Optional(
        Type.Union([Type.Literal("group"), Type.Literal("all")], {
          description: "broadcast scope: own repo group (default) or all agents",
        }),
      ),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const reply = (text: string) => ({
        content: [{ type: "text" as const, text }],
        details: {},
      });
      const program = Effect.gen(function* () {
        const current = yield* Ref.get(handle);
        if (Option.isNone(current)) {
          return reply("mesh: not joined in this session (cwd outside mesh roots, or a subagent).");
        }
        const session = current.value.session;
        const waited = (ms: number) => (ms > 0 ? ` (throttled ${Math.ceil(ms / 1000)}s)` : "");

        switch (params.action) {
          case "peers": {
            const peers = yield* session.peers;
            return reply(formatPeerList(yield* session.view, peers, params.all ?? false));
          }
          case "send": {
            if (!params.to || !params.body) return reply("mesh send needs `to` and `body`.");
            const outcome = yield* session.send(params.to, params.body);
            if (outcome.kind === "none") return reply(`mesh: no live agent matching ${params.to}.`);
            if (outcome.kind === "ambiguous") {
              return reply(
                `mesh: "${params.to}" matches ${outcome.names.join(", ")}. Use the exact handle.`,
              );
            }
            const cross = outcome.crossGroup ? " (other repo group)" : "";
            return reply(
              `Message sent to ${outcome.target.name}${cross}.${waited(outcome.waitedMs)}`,
            );
          }
          case "broadcast": {
            if (!params.body) return reply("mesh broadcast needs `body`.");
            const scope = params.scope ?? "group";
            const outcome = yield* session.broadcast(params.body, scope);
            const n = outcome.recipients;
            return reply(
              `Broadcast (${scope}) sent to ${n} agent${n === 1 ? "" : "s"}.${waited(outcome.waitedMs)}`,
            );
          }
          case "claim": {
            if (!params.paths?.length) return reply("mesh claim needs `paths`.");
            const paths = params.paths.map((p) => absolutize(ctx.cwd, p));
            yield* session.claim(paths, params.reason);
            return reply(`Claimed: ${paths.join(", ")}`);
          }
          case "release": {
            const paths = params.paths?.map((p) => absolutize(ctx.cwd, p));
            return reply(`Released ${yield* session.release(paths)} claim(s).`);
          }
          case "note": {
            yield* session.note(params.body);
            return reply("Note updated.");
          }
          case "feed": {
            const lines = yield* session.feed(params.limit ?? 20);
            return reply(lines.length ? lines.join("\n") : "Feed is empty.");
          }
          case "leave": {
            yield* closeHandle;
            return reply(`${session.name} left the mesh.`);
          }
        }
      });
      return run(
        program.pipe(
          Effect.catchTag("MeshIoError", (e) =>
            Effect.succeed(reply(`mesh: ${e.op} failed on ${e.path}.`)),
          ),
        ),
        reply("mesh: internal error, see the omp log."),
      );
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    const role = agentOf(ctx);
    if (role.kind === "sub") {
      pi.setActiveTools(pi.getActiveTools().filter((name) => name !== "mesh"));
      return;
    }
    const home = homedir();
    await run(
      Effect.gen(function* () {
        if (!underRoots(ctx.cwd, yield* loadRoots(home), home)) return;
        yield* closeHandle;
        const info = yield* repoInfo(
          (args) => pi.exec("git", [...args], { cwd: ctx.cwd }).then((result) => result.stdout),
          ctx.cwd,
        );
        const scope = yield* Scope.make();
        const session = yield* joinMesh({
          sessionId: ctx.sessionManager.getSessionId(),
          cwd: ctx.cwd,
          group: info.group,
          branch: info.branch,
          model: ctx.model?.id,
          readTitle,
          onMessage: (message) =>
            Effect.sync(() => {
              if (message.broadcast) {
                pi.sendMessage(
                  {
                    customType: "mesh-broadcast",
                    content: `Broadcast from ${message.from}: ${message.body}`,
                    display: false,
                  },
                  { deliverAs: "nextTurn" },
                );
                return;
              }
              pi.sendMessage(
                {
                  customType: "mesh-message",
                  content: `Message from ${message.from}: ${message.body}\nReply with the mesh tool: send to "${message.from}".`,
                  display: true,
                },
                ASIDE_OPTIONS,
              );
            }).pipe(
              Effect.catchDefect((defect) =>
                Effect.logWarning(`delivery failed: ${String(defect)}`),
              ),
            ),
        }).pipe(
          Scope.provide(scope),
          Effect.onError(() => Scope.close(scope, Exit.void)),
        );
        yield* Ref.set(handle, Option.some({ session, scope }));

        const peers = yield* session.peers;
        const sameGroup = peers.filter((p) => effectiveGroup(p) === session.group);
        const label = folderName(session.group);
        if (sameGroup.length > 0) {
          pi.sendMessage(
            { customType: "mesh-brief", content: formatBrief(sameGroup, label), display: false },
            { deliverAs: "nextTurn" },
          );
        } else if (peers.length > 0) {
          pi.sendMessage(
            {
              customType: "mesh-brief",
              content: `No mesh peers in this repo (${label}). ${peers.length} online in other repos: mesh peers (all: true) lists them.`,
              display: false,
            },
            { deliverAs: "nextTurn" },
          );
        }
      }),
      undefined,
    );
    await refreshStatus(ctx);
  });

  pi.on("agent_start", async (_event, ctx) => {
    const role = agentOf(ctx);
    if (role.kind === "sub") {
      const key = ctx.sessionManager.getSessionId();
      await run(
        onMain((main) => main.subagentStarted(key, role.label)),
        undefined,
      );
      return;
    }
    await run(
      onOwn((session) => session.setWorking(true)),
      undefined,
    );
    await refreshStatus(ctx);
  });

  pi.on("agent_end", async (_event, ctx) => {
    if (agentOf(ctx).kind === "sub") {
      const key = ctx.sessionManager.getSessionId();
      await run(
        onMain((main) => main.subagentEnded(key)),
        undefined,
      );
      return;
    }
    await run(
      onOwn((session) => session.setWorking(false)),
      undefined,
    );
    await refreshStatus(ctx);
  });

  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName !== "edit" && event.toolName !== "write") return undefined;
    const paths = editedPaths(event.input).map((p) => absolutize(ctx.cwd, p));
    if (paths.length === 0) return undefined;
    const role = agentOf(ctx);
    const by = role.kind === "sub" ? role.label : undefined;
    return run(
      Effect.gen(function* () {
        const owner =
          role.kind === "sub"
            ? yield* (yield* MainRegistry).current
            : Option.map(yield* Ref.get(handle), (h) => h.session);
        if (Option.isNone(owner)) return undefined;
        for (const path of paths) {
          const conflict = yield* owner.value.guardEdit(path, by);
          if (Option.isSome(conflict)) {
            return { block: true, reason: blockReason(path, conflict.value) };
          }
        }
        return undefined;
      }),
      undefined,
    );
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    const role = agentOf(ctx);
    if (role.kind === "sub") {
      const key = ctx.sessionManager.getSessionId();
      await run(
        onMain((main) => main.subagentEnded(key)),
        undefined,
      );
      return;
    }
    await run(closeHandle, undefined);
  });
}
