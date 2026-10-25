import { existsSync, readFileSync, statSync, watch, type FSWatcher } from "node:fs";
import { homedir } from "node:os";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Effect } from "effect";
import { Type } from "typebox";
import { formatBrief } from "./brief.ts";
import { absolutize, matchesReservation } from "./paths.ts";
import type { Peer } from "./peer.ts";
import { Registry } from "./registry.ts";
import { makeRuntime } from "./runtime.ts";
import {
  appendInbox,
  ensureDirs,
  feed,
  findConflict,
  generateName,
  inboxDir,
  inboxPath,
  livePeers,
  meshDir,
  readFeed,
  reapDead,
  removePresence,
  Throttle,
  writePresence,
  type MeshMessage,
} from "./store.ts";

interface HostContext {
  readonly agent?: { readonly kind?: string };
  readonly cwd: string;
  readonly model?: { readonly id?: string };
  readonly sessionManager: { getSessionId(): string };
  readonly setInterval?: (fn: () => void, ms: number) => unknown;
}

interface MeshConfig {
  readonly roots: ReadonlyArray<string>;
}

const loadConfig = (): MeshConfig => {
  try {
    const raw = JSON.parse(readFileSync(`${homedir()}/.omp/agent/mesh.json`, "utf-8")) as {
      roots?: unknown;
    };
    if (Array.isArray(raw.roots) && raw.roots.every((r) => typeof r === "string")) {
      return { roots: raw.roots as Array<string> };
    }
  } catch {}
  return { roots: ["~/work/*"] };
};

const underRoots = (cwd: string, roots: ReadonlyArray<string>): boolean =>
  roots.some((pattern) => {
    const expanded = pattern.replace(/^~\//, `${homedir()}/`).replace(/\/+$/, "");
    if (expanded.endsWith("/*")) {
      const base = expanded.slice(0, -2);
      return cwd === base || cwd.startsWith(`${base}/`);
    }
    if (expanded.endsWith("*")) return cwd.startsWith(expanded.slice(0, -1));
    return cwd === expanded;
  });

const folderName = (cwd: string): string => cwd.split("/").filter(Boolean).at(-1) ?? cwd;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export default function (pi: ExtensionAPI) {
  const base = meshDir();
  const runtime = makeRuntime(({ logLevel, message }) => {
    if (logLevel === "Warn" || logLevel === "Error") {
      const host = pi as unknown as { logger?: { warn?: (m: string) => void } };
      host.logger?.warn?.(`mesh: ${String(message)}`);
    }
  });
  // omp supports deliverAs "aside" at runtime (lands at the next step boundary
  // without interrupting the current tool batch); the upstream pi types predate it.
  const ASIDE_OPTIONS = { deliverAs: "aside", triggerTurn: true } as unknown as {
    deliverAs: "steer";
    triggerTurn: boolean;
  };
  const throttle = new Throttle(5, 20_000);

  let self: Peer | undefined;
  let watcher: FSWatcher | undefined;
  let inboxOffset = 0;
  let unread = 0;

  const updateStatus = (ctx: ExtensionContext) => {
    if (!self) return;
    const peers = livePeers(base, self.sessionId).length;
    ctx.ui.setStatus(
      "mesh",
      `mesh: ${self.name} (${peers} peer${peers === 1 ? "" : "s"})${unread > 0 ? ` ●${unread}` : ""}`,
    );
  };

  const persist = (patch: Partial<Peer>) => {
    if (!self) return;
    self = { ...self, ...patch, updatedAt: Date.now() };
    writePresence(base, self);
  };

  const deliver = () => {
    if (!self) return;
    const path = inboxPath(base, self.name);
    if (!existsSync(path)) return;
    const size = statSync(path).size;
    if (size < inboxOffset) inboxOffset = 0;
    if (size === inboxOffset) return;
    const text = readFileSync(path, "utf-8").slice(inboxOffset);
    inboxOffset = size;
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      let message: MeshMessage;
      try {
        message = JSON.parse(line) as MeshMessage;
      } catch {
        continue;
      }
      if (message.from === self.name) continue;
      if (message.broadcast) {
        pi.sendMessage(
          {
            customType: "mesh-broadcast",
            content: `Broadcast from ${message.from}: ${message.body}`,
            display: false,
          },
          { deliverAs: "nextTurn" },
        );
      } else {
        unread += 1;
        pi.sendMessage(
          {
            customType: "mesh-message",
            content: `Message from ${message.from}: ${message.body}\nReply with the mesh tool: send to "${message.from}".`,
            display: true,
          },
          ASIDE_OPTIONS,
        );
      }
    }
  };

  pi.registerTool({
    name: "mesh",
    label: "Mesh",
    description:
      "Coordinate with other omp sessions on this machine. Actions: peers (who is online), send (to, body), broadcast (body), claim (paths), release (paths optional), note (body), feed, leave.",
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
      to: Type.Optional(Type.String({ description: "Recipient agent name for send" })),
      body: Type.Optional(
        Type.String({ description: "Message text (send/broadcast) or status note (note)" }),
      ),
      paths: Type.Optional(
        Type.Array(Type.String(), { description: "Files or directories (claim/release)" }),
      ),
      reason: Type.Optional(Type.String({ description: "Why you are claiming these paths" })),
      limit: Type.Optional(Type.Number({ description: "Feed lines to return" })),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const host = ctx as unknown as HostContext;
      const text = (content: string) => ({
        content: [{ type: "text" as const, text: content }],
        details: {},
      });
      if (!self)
        return text("mesh: not joined in this session (cwd outside mesh roots, or a subagent).");
      const me: Peer = self;

      switch (params.action) {
        case "peers": {
          const peers = await runtime.runPromise(
            Registry.use((r) => r.activePeers(me.sessionId)).pipe(
              Effect.catchTag("RegistryReadError", () => Effect.succeed<ReadonlyArray<Peer>>([])),
            ),
          );
          if (peers.length === 0) return text(`You are ${me.name}. No other agents online.`);
          const lines = peers.map((p) => {
            const claims = p.reservations.length
              ? ` — claims: ${p.reservations.map((r) => r.pattern).join(", ")}`
              : "";
            return `- ${p.name} — ${folderName(p.cwd)}${p.branch ? ` (${p.branch})` : ""} — ${p.status}${p.note ? ` — ${p.note}` : ""}${claims}`;
          });
          return text(`You are ${me.name}. Agents online (${peers.length}):\n${lines.join("\n")}`);
        }
        case "send": {
          if (!params.to || !params.body) return text("mesh send needs `to` and `body`.");
          const target = livePeers(base, me.sessionId).find(
            (p) => p.name.toLowerCase() === params.to?.toLowerCase(),
          );
          if (!target) return text(`mesh: no live agent named ${params.to}.`);
          const wait = throttle.take(Date.now());
          if (wait > 0) await sleep(wait);
          appendInbox(base, {
            from: me.name,
            to: target.name,
            body: params.body,
            broadcast: false,
            at: Date.now(),
          });
          feed(base, {
            type: "message",
            agent: me.name,
            target: target.name,
            preview: params.body.slice(0, 200),
          });
          return text(
            `Message sent to ${target.name}.${wait > 0 ? ` (throttled ${Math.ceil(wait / 1000)}s)` : ""}`,
          );
        }
        case "broadcast": {
          if (!params.body) return text("mesh broadcast needs `body`.");
          const wait = throttle.take(Date.now());
          if (wait > 0) await sleep(wait);
          const targets = livePeers(base, me.sessionId);
          for (const target of targets) {
            appendInbox(base, {
              from: me.name,
              to: target.name,
              body: params.body,
              broadcast: true,
              at: Date.now(),
            });
          }
          feed(base, { type: "message", agent: me.name, preview: params.body.slice(0, 200) });
          return text(
            `Broadcast sent to ${targets.length} agent${targets.length === 1 ? "" : "s"}.`,
          );
        }
        case "claim": {
          if (!params.paths?.length) return text("mesh claim needs `paths`.");
          const added = params.paths.map((p) => ({
            pattern: absolutize(host.cwd, p),
            reason: params.reason,
            since: Date.now(),
          }));
          const merged = [
            ...(me.reservations ?? []).filter((r) => !added.some((a) => a.pattern === r.pattern)),
            ...added,
          ];
          persist({ reservations: merged });
          for (const a of added) {
            feed(base, {
              type: "claim",
              agent: me.name,
              target: a.pattern,
              preview: params.reason,
            });
          }
          return text(`Claimed: ${added.map((a) => a.pattern).join(", ")}`);
        }
        case "release": {
          const current = me.reservations ?? [];
          const kept = params.paths?.length
            ? current.filter(
                (r) => !params.paths?.some((p) => absolutize(host.cwd, p) === r.pattern),
              )
            : [];
          persist({ reservations: kept });
          feed(base, {
            type: "release",
            agent: me.name,
            preview: `${current.length - kept.length} released`,
          });
          return text(`Released ${current.length - kept.length} claim(s).`);
        }
        case "note": {
          persist({ note: params.body });
          return text("Note updated.");
        }
        case "feed": {
          const lines = readFeed(base, params.limit ?? 20);
          return text(lines.length ? lines.join("\n") : "Feed is empty.");
        }
        case "leave": {
          removePresence(base, me.sessionId);
          feed(base, { type: "leave", agent: me.name });
          const name = me.name;
          self = undefined;
          return text(`${name} left the mesh.`);
        }
      }
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    const host = ctx as unknown as HostContext;
    if (host.agent?.kind === "sub") {
      pi.setActiveTools(pi.getActiveTools().filter((name) => name !== "mesh"));
      return;
    }
    if (!underRoots(host.cwd, loadConfig().roots)) return;

    ensureDirs(base);
    reapDead(base);
    const sessionId = host.sessionManager.getSessionId();
    const taken = new Set(livePeers(base, sessionId).map((p) => p.name));
    const name = generateName(taken);
    let branch: string | undefined;
    try {
      const result = await pi.exec("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: host.cwd });
      const out = (result as { stdout?: string }).stdout?.trim();
      if (out && out !== "HEAD") branch = out;
    } catch {}

    self = {
      name,
      pid: process.pid,
      sessionId,
      cwd: host.cwd,
      branch,
      model: host.model?.id,
      status: "idle",
      reservations: [],
      updatedAt: Date.now(),
    };
    writePresence(base, self);
    feed(base, { type: "join", agent: name });

    const path = inboxPath(base, name);
    inboxOffset = existsSync(path) ? statSync(path).size : 0;
    try {
      watcher = watch(inboxDir(base), () => deliver());
    } catch {}
    host.setInterval?.(() => {
      deliver();
      persist({});
    }, 5_000);

    const peers = await runtime.runPromise(
      Registry.use((r) => r.activePeers(sessionId)).pipe(
        Effect.catchTag("RegistryReadError", () => Effect.succeed<ReadonlyArray<Peer>>([])),
      ),
    );
    if (peers.length > 0) {
      pi.sendMessage(
        { customType: "mesh-brief", content: formatBrief(peers), display: false },
        { deliverAs: "nextTurn" },
      );
    }
    updateStatus(ctx);
  });

  pi.on("agent_start", (_event, ctx) => {
    if (!self) return;
    unread = 0;
    persist({ status: "working" });
    updateStatus(ctx as ExtensionContext);
  });

  pi.on("agent_end", (_event, ctx) => {
    if (!self) return;
    persist({ status: "idle" });
    updateStatus(ctx as ExtensionContext);
  });

  pi.on("tool_call", (event, ctx) => {
    if (!self) return;
    if (event.toolName !== "edit" && event.toolName !== "write") return;
    const host = ctx as unknown as HostContext;
    const input = event.input as Record<string, unknown>;
    const path = typeof input.path === "string" ? input.path : undefined;
    if (!path) return;
    const abs = absolutize(host.cwd, path);
    const conflict = findConflict(
      livePeers(base, self.sessionId),
      self.sessionId,
      abs,
      matchesReservation,
    );
    if (!conflict) return;
    const lines = [abs, `Reserved by: ${conflict.peer.name} (in ${folderName(conflict.peer.cwd)})`];
    if (conflict.reservation.reason) lines.push(`Reason: "${conflict.reservation.reason}"`);
    lines.push("");
    lines.push(`Coordinate with the mesh tool: send to "${conflict.peer.name}".`);
    return { block: true, reason: lines.join("\n") };
  });

  pi.on("session_shutdown", async () => {
    if (self) {
      feed(base, { type: "leave", agent: self.name });
      removePresence(base, self.sessionId);
      self = undefined;
    }
    watcher?.close();
    await runtime.dispose();
  });
}
