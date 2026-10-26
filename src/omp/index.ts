import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Cause, Context, Effect, Exit, Layer, Logger, Option, Ref, Scope, Stream } from "effect";
import { formatBrief } from "../domain/brief.ts";
import { NotJoined } from "../domain/errors.ts";
import type { MeshMessage } from "../domain/message.ts";
import { absolutize, editedPaths, folderName } from "../domain/paths.ts";
import { effectiveGroup } from "../domain/peers.ts";
import { underRoots } from "../domain/roots.ts";
import { MainRegistry, type MainHandle } from "../services/main-registry.ts";
import { MeshConfig } from "../services/mesh-config.ts";
import { MeshSession } from "../services/mesh-session.ts";
import { repoInfo } from "./git.ts";
import { agentOf, hostLogger } from "./host.ts";
import { makeMeshTool } from "./mesh-tool.ts";
import { type MeshEnv, runtime } from "./runtime.ts";

interface Handle {
  readonly session: MeshSession["Service"];
  readonly scope: Scope.Closeable;
}

// omp supports deliverAs "aside" at runtime (lands at the next step boundary
// without interrupting the current tool batch); the upstream pi types predate it.
// SAFETY: omp's runtime accepts "aside"; the pinned pi type only lists "steer".
const ASIDE_OPTIONS = { deliverAs: "aside", triggerTurn: true } as unknown as {
  deliverAs: "steer";
  triggerTurn: boolean;
};

export default function (pi: ExtensionAPI) {
  const logger = hostLogger(pi);
  const hostLoggers = new Set([
    Logger.make(({ logLevel, message }) => {
      if (logLevel === "Warn" || logLevel === "Error") logger?.warn(`mesh: ${String(message)}`);
    }),
  ]);

  const handle = Ref.makeUnsafe(Option.none<Handle>());

  const run = <A, E>(effect: Effect.Effect<A, E, MeshEnv>, fallback: A): Promise<A> =>
    runtime.runPromise(
      effect.pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning(Cause.pretty(cause)).pipe(Effect.as(fallback)),
        ),
        Effect.provideService(Logger.CurrentLoggers, hostLoggers),
      ),
    );

  const closeHandle = Effect.gen(function* () {
    const current = yield* Ref.modify(handle, (h) => [h, Option.none<Handle>()] as const);
    if (Option.isSome(current)) yield* Scope.close(current.value.scope, Exit.void);
  });

  const current = Effect.flatMap(Ref.get(handle), (h) =>
    Option.isSome(h) ? Effect.succeed(h.value.session) : Effect.fail(new NotJoined()),
  );

  const onMain = <E>(use: (main: MainHandle) => Effect.Effect<void, E>) =>
    Effect.gen(function* () {
      const main = yield* (yield* MainRegistry).current;
      if (Option.isSome(main)) yield* use(main.value);
    });

  const onOwn = <E>(use: (own: MeshSession["Service"]) => Effect.Effect<void, E>) =>
    Effect.gen(function* () {
      const own = yield* Ref.get(handle);
      if (Option.isSome(own)) yield* use(own.value.session);
    });

  const readTitle = Effect.try(() => pi.getSessionName()).pipe(
    Effect.orElseSucceed(() => undefined),
  );

  const meshTool = makeMeshTool({ current, leave: closeHandle });
  pi.registerTool({
    name: meshTool.name,
    label: meshTool.label,
    description: meshTool.description,
    parameters: meshTool.parameters,
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const text = await run(
        meshTool.run(params, { cwd: ctx.cwd }),
        "mesh: internal error, see the omp log.",
      );
      return { content: [{ type: "text" as const, text }], details: {} };
    },
  });

  const deliver = (message: MeshMessage) =>
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
      Effect.catchDefect((defect) => Effect.logWarning(`delivery failed: ${String(defect)}`)),
    );

  const showStatus = (ctx: ExtensionContext, text: string) =>
    Effect.sync(() => ctx.ui.setStatus("mesh", text)).pipe(
      Effect.catchDefect((defect) => Effect.logWarning(`status update failed: ${String(defect)}`)),
    );

  const startSession = Effect.fn("startSession")(function* (ctx: ExtensionContext) {
    const config = yield* MeshConfig;
    if (!underRoots(ctx.cwd, yield* config.roots, config.home)) return;
    yield* closeHandle;
    const info = yield* repoInfo(
      (args) => pi.exec("git", [...args], { cwd: ctx.cwd }).then((result) => result.stdout),
      ctx.cwd,
    );
    const scope = yield* Scope.make();
    const services = yield* Layer.buildWithScope(
      MeshSession.layer({
        sessionId: ctx.sessionManager.getSessionId(),
        cwd: ctx.cwd,
        group: info.group,
        branch: info.branch,
        model: ctx.model?.id,
        readTitle,
      }),
      scope,
    ).pipe(Effect.onError(() => Scope.close(scope, Exit.void)));
    const session = Context.get(services, MeshSession);

    yield* Effect.gen(function* () {
      yield* session.deliveries.pipe(Stream.runForEach(deliver), Effect.forkScoped);
      yield* session.status.pipe(
        Stream.runForEach((text) => showStatus(ctx, text)),
        Effect.forkScoped,
      );
    }).pipe(Scope.provide(scope));
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
  });

  pi.on("session_start", async (_event, ctx) => {
    if (agentOf(ctx).kind === "sub") {
      pi.setActiveTools(pi.getActiveTools().filter((name) => name !== "mesh"));
      return;
    }
    await run(startSession(ctx), undefined);
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
      onOwn((session) => session.agentStarted),
      undefined,
    );
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
      onOwn((session) => session.agentEnded),
      undefined,
    );
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
        for (const path of paths) yield* owner.value.guardEdit(path, by);
        return undefined;
      }).pipe(
        Effect.catchTag("ClaimConflict", (conflict) =>
          Effect.succeed({ block: true, reason: conflict.message }),
        ),
      ),
      undefined,
    );
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    if (agentOf(ctx).kind === "sub") {
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
