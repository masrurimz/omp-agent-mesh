import { expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { Effect } from "effect";
import { MeshStore } from "../src/mesh-store.ts";
import { DEAD_PID, peer, runMesh } from "./support.ts";

test("presence round-trips and a broken file is skipped, not fatal", () =>
  runMesh((dir) =>
    Effect.gen(function* () {
      const store = yield* MeshStore;
      yield* store.ensureDirs;
      yield* store.writePresence(
        peer("a", {
          title: "PLAN: x",
          subagents: 2,
          recent: [{ path: "/w/f.ts", by: "scout", at: 1 }],
        }),
      );
      writeFileSync(join(dir, "agents", "broken.json"), "{not json");
      writeFileSync(join(dir, "agents", "notes.txt"), "ignored");
      const peers = yield* store.listPresence;
      expect(peers).toHaveLength(1);
      expect(peers[0]).toMatchObject({ sessionId: "a", subagents: 2, title: "PLAN: x" });
      expect(peers[0]?.recent[0]?.by).toBe("scout");
    }),
  ));

test("presence written by an older version decodes with subagent defaults", () =>
  runMesh((dir) =>
    Effect.gen(function* () {
      const store = yield* MeshStore;
      yield* store.ensureDirs;
      const { subagents: _s, recent: _r, ...legacy } = peer("old");
      writeFileSync(join(dir, "agents", "old.json"), JSON.stringify(legacy));
      const [only] = yield* store.listPresence;
      expect(only).toMatchObject({ sessionId: "old", subagents: 0, recent: [] });
    }),
  ));

test("livePeers hides self and dead pids; reapDead removes dead presence files", () =>
  runMesh(() =>
    Effect.gen(function* () {
      const store = yield* MeshStore;
      yield* store.ensureDirs;
      yield* store.writePresence(peer("self"));
      yield* store.writePresence(peer("live"));
      yield* store.writePresence(peer("dead", { pid: DEAD_PID }));
      expect((yield* store.livePeers("self")).map((p) => p.sessionId)).toEqual(["live"]);
      yield* store.reapDead;
      const remaining = (yield* store.listPresence).map((p) => p.sessionId).sort();
      expect(remaining).toEqual(["live", "self"]);
    }),
  ));

test("inbox reads only new complete lines, in bytes, and survives non-ASCII", () =>
  runMesh((dir) =>
    Effect.gen(function* () {
      const store = yield* MeshStore;
      yield* store.ensureDirs;
      const message = (body: string) => ({ from: "A", to: "B", body, broadcast: false, at: 1 });
      yield* store.appendInbox("b", message("héllo ✓"));
      const first = yield* store.readInbox("b", 0);
      expect(first.messages.map((m) => m.body)).toEqual(["héllo ✓"]);
      expect(yield* store.inboxSize("b")).toBe(first.offset);

      writeFileSync(join(dir, "inbox", "b.jsonl"), '{"from":"A"', { flag: "a" });
      const partial = yield* store.readInbox("b", first.offset);
      expect(partial).toEqual({ messages: [], offset: first.offset });

      writeFileSync(join(dir, "inbox", "b.jsonl"), "\n", { flag: "a" });
      yield* store.appendInbox("b", message("second"));
      const next = yield* store.readInbox("b", first.offset);
      expect(next.messages.map((m) => m.body)).toEqual(["second"]);
    }),
  ));

test("feed returns the newest lines", () =>
  runMesh(() =>
    Effect.gen(function* () {
      const store = yield* MeshStore;
      yield* store.ensureDirs;
      for (const agent of ["one", "two", "three"]) {
        yield* store.appendFeed({ type: "join", agent });
      }
      const lines = yield* store.readFeed(2);
      expect(lines).toHaveLength(2);
      expect(lines[1]).toContain('"agent":"three"');
    }),
  ));
