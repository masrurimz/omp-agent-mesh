import { expect, test } from "bun:test";
import { BunFileSystem } from "@effect/platform-bun";
import { Effect } from "effect";
import { describePeer, formatPeerList } from "../src/brief.ts";
import { loadRoots, underRoots } from "../src/config.ts";
import { repoInfo } from "../src/git.ts";
import { absolutize, displayPath, editedPaths, matchesReservation } from "../src/paths.ts";
import {
  broadcastTargets,
  findConflict,
  generateName,
  repoGroup,
  resolveTarget,
} from "../src/peers.ts";
import { peer } from "./support.ts";

test("paths: relative claims absolutize, scheme URIs are left alone, directories match by prefix", () => {
  expect(absolutize("/w", "src/a.ts")).toBe("/w/src/a.ts");
  expect(absolutize("/w", "src/")).toBe("/w/src/");
  expect(absolutize("/w", "xd://pi_messenger")).toBe("xd://pi_messenger");
  expect(matchesReservation("/w/src/a.ts", "/w/src/")).toBe(true);
  expect(matchesReservation("/w/src/a.ts", "/w/src/b.ts")).toBe(false);
  expect(displayPath("/w", "/w/src/a.ts")).toBe("src/a.ts");
  expect(displayPath("/w", "/elsewhere/a.ts")).toBe("/elsewhere/a.ts");
});

test("editedPaths reads path fields and patch headers", () => {
  expect(editedPaths({ path: "a.ts", content: "x" })).toEqual(["a.ts"]);
  expect(
    editedPaths({ input: "*** Begin Patch\n[src/a.ts#1A2B]\nPUT >1:\n+x\n[b.ts#FFFF]\n+y" }),
  ).toEqual(["src/a.ts", "b.ts"]);
  expect(editedPaths({ input: "*** Update File: lib/c.ts\n@@" })).toEqual(["lib/c.ts"]);
  expect(editedPaths("nope")).toEqual([]);
});

test("resolveTarget finds by handle, title card, or title text, and reports ambiguity", () => {
  const peers = [
    peer("1", { name: "GoldXenon", title: "PLAN: auth rewrite" }),
    peer("2", { name: "RedOwl", title: "FIX: auth tests" }),
  ];
  expect(resolveTarget(peers, "goldxenon")).toMatchObject({ kind: "found" });
  expect(resolveTarget(peers, "plan")).toMatchObject({
    kind: "found",
    peer: { name: "GoldXenon" },
  });
  expect(resolveTarget(peers, "tests")).toMatchObject({ kind: "found", peer: { name: "RedOwl" } });
  expect(resolveTarget(peers, "auth")).toEqual({
    kind: "ambiguous",
    names: ["GoldXenon", "RedOwl"],
  });
  expect(resolveTarget(peers, "nobody")).toEqual({ kind: "none" });
});

test("broadcastTargets defaults to the group and widens on request", () => {
  const peers = [peer("1", { group: "/a" }), peer("2", { group: "/b" }), peer("3", { cwd: "/a" })];
  expect(broadcastTargets(peers, "/a", "group").map((p) => p.sessionId)).toEqual(["1", "3"]);
  expect(broadcastTargets(peers, "/a", "all")).toHaveLength(3);
});

test("findConflict ignores the asking session", () => {
  const claimant = peer("c", { reservations: [{ pattern: "/w/a.ts", since: 0 }] });
  expect(findConflict([claimant], "me", "/w/a.ts", matchesReservation)?.peer.sessionId).toBe("c");
  expect(findConflict([claimant], "c", "/w/a.ts", matchesReservation)).toBeUndefined();
});

test("generateName is non-empty and avoids taken names", () => {
  const taken = new Set<string>();
  for (let i = 0; i < 200; i++) {
    const name = generateName(taken);
    expect(name).toMatch(/^[A-Za-z0-9]+$/);
    expect(taken.has(name)).toBe(false);
    taken.add(name);
  }
});

test("repoGroup groups worktrees by the shared git dir and submodules by toplevel", () => {
  expect(repoGroup("/r/.git", "/r/wt", "/r/wt")).toBe("/r");
  expect(repoGroup("/r/.git/modules/sub", "/r/sub", "/r/sub")).toBe("/r/sub");
  expect(repoGroup(undefined, undefined, "/loose")).toBe("/loose");
});

test("repoInfo resolves a worktree's group and falls back when git fails", async () => {
  const fake = (answers: Record<string, string>) => (args: ReadonlyArray<string>) =>
    args.join(" ") in answers
      ? Promise.resolve(answers[args.join(" ")] ?? "")
      : Promise.reject(new Error("not a repo"));
  const worktree = await Effect.runPromise(
    repoInfo(
      fake({
        "rev-parse --abbrev-ref HEAD": "feat\n",
        "rev-parse --git-common-dir": "../main/.git\n",
        "rev-parse --show-toplevel": "/r/wt\n",
      }),
      "/r/wt",
    ),
  );
  expect(worktree).toEqual({ branch: "feat", group: "/r/main" });
  const outside = await Effect.runPromise(repoInfo(fake({}), "/tmp/x"));
  expect(outside).toEqual({ branch: undefined, group: "/tmp/x" });
});

test("underRoots matches home-relative globs", () => {
  expect(underRoots("/h/work/a/b", ["~/work/*"], "/h")).toBe(true);
  expect(underRoots("/h/other", ["~/work/*"], "/h")).toBe(false);
  expect(underRoots("/h/work", ["~/work/*"], "/h")).toBe(true);
});

test("loadRoots falls back to the default when no config file exists", async () => {
  const roots = await Effect.runPromise(
    loadRoots("/nonexistent-home").pipe(Effect.provide(BunFileSystem.layer)),
  );
  expect(roots).toEqual(["~/work/*"]);
});

test("peer lines carry subagent counts and the last attributed edit", () => {
  const busy = peer("p", {
    name: "GoldXenon",
    status: "working",
    subagents: 3,
    recent: [{ path: "/work/repo/src/auth.ts", by: "scout", at: 1 }],
  });
  expect(describePeer(busy)).toBe(
    "- @GoldXenon — repo — working — 3 subagents — last edit src/auth.ts (scout)",
  );
  expect(describePeer(peer("q", { name: "RedOwl", subagents: 1 }))).toContain("1 subagent");
  const listing = formatPeerList(
    peer("me", { name: "Me" }),
    [busy, peer("z", { group: "/x", name: "Far" })],
    false,
  );
  expect(listing).toContain("3 subagents");
  expect(listing).toContain("1 more in other repos");
});
