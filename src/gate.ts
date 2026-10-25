import { isAbsolute, resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export interface GateContext {
  readonly agent?: { readonly kind?: string };
  readonly cwd?: string;
}

type Handler = (event: unknown, ctx: GateContext) => unknown;

export const isMainSession = (ctx: GateContext): boolean => ctx.agent?.kind !== "sub";

// A scheme URI (xd://pi_messenger, skill://name) addresses a tool, not a file on disk.
// Resolving one against cwd invents a path that matches no real file or reservation.
const SCHEME_URI = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//;

export const absolutize = (cwd: string, pattern: string): string => {
  if (isAbsolute(pattern) || SCHEME_URI.test(pattern)) return pattern;
  const abs = resolve(cwd, pattern);
  return pattern.endsWith("/") ? `${abs}/` : abs;
};

interface ToolCallEvent {
  readonly toolName?: string;
  readonly input?: Record<string, unknown>;
}

export const normalizeEditPath = (event: ToolCallEvent, cwd: string): ToolCallEvent => {
  if (event.toolName !== "edit" && event.toolName !== "write") return event;
  const path = event.input?.path;
  if (typeof path !== "string" || isAbsolute(path)) return event;
  return { ...event, input: { ...event.input, path: absolutize(cwd, path) } };
};

interface MessengerParams {
  readonly action?: string;
  readonly paths?: unknown;
}

export const normalizeReservePaths = (params: MessengerParams, cwd: string): MessengerParams => {
  if (params.action !== "reserve" && params.action !== "release") return params;
  if (!Array.isArray(params.paths)) return params;
  return {
    ...params,
    paths: params.paths.map((p) => (typeof p === "string" ? absolutize(cwd, p) : p)),
  };
};

interface ToolDefinition {
  readonly name?: string;
  readonly execute?: (...args: Array<unknown>) => unknown;
}

const wrapTool = (def: ToolDefinition): ToolDefinition => {
  if (def.name !== "pi_messenger" || typeof def.execute !== "function") return def;
  const execute = def.execute;
  return {
    ...def,
    execute: (...args: Array<unknown>) => {
      const params = args[1] as MessengerParams | undefined;
      const ctx = args[4] as GateContext | undefined;
      if (params && ctx?.cwd) args[1] = normalizeReservePaths(params, ctx.cwd);
      return execute(...args);
    },
  };
};

export function mainOnly(pi: ExtensionAPI): ExtensionAPI {
  const on = pi.on.bind(pi) as (event: string, handler: Handler) => unknown;
  const registerTool = pi.registerTool.bind(pi) as (def: ToolDefinition) => unknown;
  return new Proxy(pi, {
    get(target, prop) {
      if (prop === "on") {
        return (event: string, handler: Handler) =>
          on(event, (e, ctx) => {
            if (event === "session_start" && !isMainSession(ctx)) return undefined;
            if (event === "tool_call" && ctx.cwd) {
              return handler(normalizeEditPath(e as ToolCallEvent, ctx.cwd), ctx);
            }
            return handler(e, ctx);
          });
      }
      if (prop === "registerTool") {
        return (def: ToolDefinition) => registerTool(wrapTool(def));
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
