// @effect-diagnostics asyncFunction:off -- omp's extension API takes Promise-returning hooks and tool executors; this module is the edge where Effect programs run.
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
  Cause,
  Context,
  Effect,
  Exit,
  Layer,
  Logger,
  Option,
  Ref,
  Scope,
  Stream,
} from "effect";

import { formatBrief } from "../domain/brief.ts";
import type { MeshMessage } from "../domain/message.ts";
import { NotJoined } from "../domain/not-joined.ts";
import {
  absolutize,
  decodeEditInput,
  editedPaths,
  folderName,
} from "../domain/paths.ts";
import { effectiveGroup } from "../domain/peers.ts";
import { underRoots } from "../domain/roots.ts";
import { MainRegistry } from "../services/main-registry.ts";
import type { MainHandle } from "../services/main-registry.ts";
import { MeshConfig } from "../services/mesh-config.ts";
import { MeshSession } from "../services/mesh-session.ts";
import { repoInfo } from "./git.ts";
import { agentOf, hostLogger } from "./host.ts";
import { bindMeshTool } from "./mesh-tool.ts";
import { runtime } from "./runtime.ts";
import type { MeshEnv } from "./runtime.ts";

interface Handle {
  readonly session: MeshSession["Service"];
  readonly scope: Scope.Closeable;
}

// SAFETY: omp's runtime accepts "aside"; the pinned pi type only lists "steer".
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the pinned pi delivery type omits the aside mode omp supports
const ASIDE_DELIVERY = "aside" as "steer";

const ASIDE_OPTIONS = { deliverAs: ASIDE_DELIVERY, triggerTurn: true };

const onMain = <E>(use: (main: MainHandle) => Effect.Effect<void, E>) =>
  Effect.gen(function* runOnMain() {
    const main = yield* (yield* MainRegistry).current;

    if (Option.isSome(main)) {
      yield* use(main.value);
    }
  });

const showStatus = (ctx: ExtensionContext, text: string) =>
  Effect.sync(() => {
    ctx.ui.setStatus("mesh", text);
  }).pipe(
    Effect.catchDefect((defect) =>
      Effect.logWarning(`status update failed: ${String(defect)}`)
    )
  );

export default function meshExtension(pi: ExtensionAPI) {
  const logger = hostLogger(pi);

  const hostLoggers = new Set([
    Logger.make(({ logLevel, message }) => {
      if (logLevel === "Warn" || logLevel === "Error") {
        logger?.warn(`mesh: ${String(message)}`);
      }
    }),
  ]);

  const handle = Ref.makeUnsafe(Option.none<Handle>());

  const runOr = async <A, E, B>(
    effect: Effect.Effect<A, E, MeshEnv>,
    recovery: Effect.Effect<B>
  ): Promise<A | B> =>
    await runtime.runPromise(
      effect.pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning(Cause.pretty(cause)).pipe(Effect.andThen(recovery))
        ),
        Effect.provideService(Logger.CurrentLoggers, hostLoggers)
      )
    );

  const run = async <E>(effect: Effect.Effect<void, E, MeshEnv>) => {
    await runOr(effect, Effect.void);
  };

  const closeHandle = Effect.gen(function* closeHandle() {
    const current = yield* Ref.modify(
      handle,
      (h) => [h, Option.none<Handle>()] as const
    );

    if (Option.isSome(current)) {
      yield* Scope.close(current.value.scope, Exit.void);
    }
  });

  const current = Effect.flatMap(Ref.get(handle), (h) =>
    Option.isSome(h)
      ? Effect.succeed(h.value.session)
      : Effect.fail(new NotJoined())
  );

  const onOwn = <E>(
    use: (own: MeshSession["Service"]) => Effect.Effect<void, E>
  ) =>
    Effect.gen(function* runOnOwn() {
      const own = yield* Ref.get(handle);

      if (Option.isSome(own)) {
        yield* use(own.value.session);
      }
    });

  const readTitle = Effect.try(() => pi.getSessionName()).pipe(
    Effect.option,
    Effect.map(Option.getOrUndefined)
  );

  const meshTool = bindMeshTool({ current, leave: closeHandle });
  pi.registerTool({
    description: meshTool.description,
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const text = await runOr(
        meshTool.run(params, { cwd: ctx.cwd }),
        Effect.succeed("mesh: internal error, see the omp log.")
      );

      return { content: [{ text, type: "text" as const }], details: {} };
    },
    label: meshTool.label,
    name: meshTool.name,
    parameters: meshTool.parameters,
  });

  const deliver = (message: MeshMessage) =>
    Effect.sync(() => {
      if (message.broadcast) {
        pi.sendMessage(
          {
            content: `Broadcast from ${message.from}: ${message.body}`,
            customType: "mesh-broadcast",
            display: false,
          },
          { deliverAs: "nextTurn" }
        );

        return;
      }

      pi.sendMessage(
        {
          content: `Message from ${message.from}: ${message.body}\nReply with the mesh tool: send to "${message.from}".`,
          customType: "mesh-message",
          display: true,
        },
        ASIDE_OPTIONS
      );
    }).pipe(
      Effect.catchDefect((defect) =>
        Effect.logWarning(`delivery failed: ${String(defect)}`)
      )
    );

  const startSession = Effect.fn("startSession")(function* startSession(
    ctx: ExtensionContext
  ) {
    const config = yield* MeshConfig;

    if (!underRoots(ctx.cwd, yield* config.roots, config.home)) {
      return;
    }

    yield* closeHandle;

    const info = yield* repoInfo(async (args) => {
      const result = await pi.exec("git", [...args], { cwd: ctx.cwd });

      return result.stdout;
    }, ctx.cwd);

    const scope = yield* Scope.make();

    const services = yield* Layer.buildWithScope(
      MeshSession.layer({
        branch: info.branch,
        cwd: ctx.cwd,
        group: info.group,
        model: ctx.model?.id,
        readTitle,
        sessionId: ctx.sessionManager.getSessionId(),
      }),
      scope
    ).pipe(Effect.onError(() => Scope.close(scope, Exit.void)));

    const session = Context.get(services, MeshSession);

    yield* Effect.gen(function* forkDeliveries() {
      yield* session.deliveries.pipe(
        Stream.runForEach(deliver),
        Effect.forkScoped
      );
      yield* session.status.pipe(
        Stream.runForEach((text) => showStatus(ctx, text)),
        Effect.forkScoped
      );
    }).pipe(Scope.provide(scope));
    yield* Ref.set(handle, Option.some({ scope, session }));

    const peers = yield* session.peers;
    const sameGroup = peers.filter((p) => effectiveGroup(p) === session.group);
    const label = folderName(session.group);

    if (sameGroup.length > 0) {
      pi.sendMessage(
        {
          content: formatBrief(sameGroup, label),
          customType: "mesh-brief",
          display: false,
        },
        { deliverAs: "nextTurn" }
      );
    } else if (peers.length > 0) {
      pi.sendMessage(
        {
          content: `No mesh peers in this repo (${label}). ${peers.length} online in other repos: mesh peers (all: true) lists them.`,
          customType: "mesh-brief",
          display: false,
        },
        { deliverAs: "nextTurn" }
      );
    }
  });

  pi.on("session_start", async (_event, ctx) => {
    if (agentOf(ctx).kind === "sub") {
      pi.setActiveTools(pi.getActiveTools().filter((name) => name !== "mesh"));

      return;
    }

    await run(startSession(ctx));
  });

  pi.on("agent_start", async (_event, ctx) => {
    const role = agentOf(ctx);

    if (role.kind === "sub") {
      const key = ctx.sessionManager.getSessionId();
      await run(onMain((main) => main.subagentStarted(key, role.label)));

      return;
    }

    await run(onOwn((session) => session.agentStarted));
  });

  pi.on("agent_end", async (_event, ctx) => {
    if (agentOf(ctx).kind === "sub") {
      const key = ctx.sessionManager.getSessionId();
      await run(onMain((main) => main.subagentEnded(key)));

      return;
    }

    await run(onOwn((session) => session.agentEnded));
  });

  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName !== "edit" && event.toolName !== "write") {
      return;
    }

    const edited = Option.match(decodeEditInput(event.input), {
      onNone: () => [],
      onSome: editedPaths,
    });

    const paths = edited.map((p) => absolutize(ctx.cwd, p));

    if (paths.length === 0) {
      return;
    }

    const role = agentOf(ctx);
    const by = role.kind === "sub" ? role.label : undefined;

    return await runOr(
      Effect.gen(function* guardPaths() {
        const owner =
          role.kind === "sub"
            ? yield* (yield* MainRegistry).current
            : (yield* Ref.get(handle)).pipe(Option.map((h) => h.session));

        if (Option.isNone(owner)) {
          return;
        }

        for (const path of paths) {
          yield* owner.value.guardEdit(path, by);
        }
      }).pipe(
        Effect.catchTag("ClaimConflict", (conflict) =>
          Effect.succeed({ block: true, reason: conflict.message })
        )
      ),
      Effect.void
    );
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    if (agentOf(ctx).kind === "sub") {
      const key = ctx.sessionManager.getSessionId();
      await run(onMain((main) => main.subagentEnded(key)));

      return;
    }

    await run(closeHandle);
  });
}
