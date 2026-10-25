import { describe, expect, test } from "bun:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  mainOnly,
  normalizeEditPath,
  normalizeReservePaths,
  type GateContext,
} from "../src/gate.ts";

type Handler = (event: unknown, ctx: GateContext) => unknown;

interface FakeTool {
  readonly name?: string;
  readonly execute?: (...args: Array<unknown>) => unknown;
}

const wire = () => {
  const handlers = new Map<string, Handler>();
  const tools = new Map<string, FakeTool>();
  const pi = {
    on(event: string, handler: Handler) {
      handlers.set(event, handler);
    },
    registerTool(def: FakeTool) {
      if (def.name) tools.set(def.name, def);
    },
  };
  const seen: Array<string> = [];
  const executed: Array<unknown> = [];
  const factory = (p: typeof pi) => {
    p.on("session_start", (_event, ctx) => {
      seen.push(`start:${ctx.agent?.kind ?? "none"}`);
    });
    p.on("tool_call", (event) => {
      const e = event as { input?: { path?: unknown } };
      seen.push(`tool:${String(e.input?.path)}`);
    });
    p.registerTool({
      name: "pi_messenger",
      execute: (...args: Array<unknown>) => {
        executed.push(args[1]);
        return "ok";
      },
    });
  };
  factory(mainOnly(pi as unknown as ExtensionAPI) as unknown as typeof pi);
  return { handlers, tools, seen, executed };
};

describe("mainOnly session gate", () => {
  test("a subagent session never reaches the wrapped session_start handler", () => {
    const { handlers, seen } = wire();
    handlers.get("session_start")?.({}, { agent: { kind: "sub" } });
    expect(seen).toEqual([]);
  });

  test("a main session reaches it, and a context without agent info counts as main", () => {
    const { handlers, seen } = wire();
    handlers.get("session_start")?.({}, { agent: { kind: "main" } });
    handlers.get("session_start")?.({}, {});
    expect(seen).toEqual(["start:main", "start:none"]);
  });

  test("tool_call events still reach subagent sessions, with edit paths absolutized", () => {
    const { handlers, seen } = wire();
    handlers.get("tool_call")?.(
      { toolName: "edit", input: { path: "src/a.ts" } },
      { agent: { kind: "sub" }, cwd: "/repo" },
    );
    expect(seen).toEqual(["tool:/repo/src/a.ts"]);
  });

  test("reserve paths are absolutized before the pi_messenger tool executes", () => {
    const { tools, executed } = wire();
    const tool = tools.get("pi_messenger");
    tool?.execute?.("id", { action: "reserve", paths: ["src/auth/", "shared.txt"] }, null, null, {
      cwd: "/repo",
    });
    expect(executed).toEqual([
      { action: "reserve", paths: ["/repo/src/auth/", "/repo/shared.txt"] },
    ]);
  });
});

describe("normalizeEditPath", () => {
  test("resolves relative edit and write paths against cwd", () => {
    expect(normalizeEditPath({ toolName: "edit", input: { path: "./a.ts" } }, "/repo")).toEqual({
      toolName: "edit",
      input: { path: "/repo/a.ts" },
    });
    expect(normalizeEditPath({ toolName: "write", input: { path: "b.ts" } }, "/repo")).toEqual({
      toolName: "write",
      input: { path: "/repo/b.ts" },
    });
  });

  test("leaves absolute paths and other tools untouched", () => {
    const abs = { toolName: "edit", input: { path: "/x/a.ts" } };
    expect(normalizeEditPath(abs, "/repo")).toBe(abs);
    const bash = { toolName: "bash", input: { path: "a.ts" } };
    expect(normalizeEditPath(bash, "/repo")).toBe(bash);
  });

  test("leaves tool-device URIs alone instead of inventing a file path under cwd", () => {
    const write = { toolName: "write", input: { path: "xd://pi_messenger" } };
    const edit = { toolName: "edit", input: { path: "skill://poteto-mode" } };
    expect(normalizeEditPath(write, "/repo")).toEqual(write);
    expect(normalizeEditPath(edit, "/repo")).toEqual(edit);
  });
});

describe("normalizeReservePaths", () => {
  test("keeps the trailing slash on directory patterns", () => {
    expect(normalizeReservePaths({ action: "reserve", paths: ["src/"] }, "/repo")).toEqual({
      action: "reserve",
      paths: ["/repo/src/"],
    });
  });

  test("ignores other actions", () => {
    const params = { action: "send", paths: ["src/"] };
    expect(normalizeReservePaths(params, "/repo")).toBe(params);
  });
});
