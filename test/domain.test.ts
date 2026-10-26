import { assert, describe, it } from "@effect/vitest";
import { Option, Result, Schema } from "effect";

import { describePeer, formatPeerList } from "../src/domain/brief.ts";
import {
  absolutize,
  decodeEditInput,
  displayPath,
  editedPaths,
  matchesReservation,
} from "../src/domain/paths.ts";
import {
  broadcastTargets,
  effectiveGroup,
  repoGroup,
  resolveTarget,
} from "../src/domain/peers.ts";
import { underRoots } from "../src/domain/roots.ts";
import { peer } from "./support.ts";

const Id = Schema.Int.check(Schema.isBetween({ maximum: 9999, minimum: 0 }));

const SmallCount = Schema.Int.check(
  Schema.isBetween({ maximum: 7, minimum: 2 })
);

const handleFor = (n: number) => `Agent${n}`;

const editedFrom = (raw: Schema.Json) =>
  Option.match(decodeEditInput(raw), {
    onNone: () => [],
    onSome: editedPaths,
  });

describe("resolveTarget", () => {
  it.prop(
    "an exact handle beats every title that mentions it",
    { base: Id, others: SmallCount },
    ({ base, others }) => {
      const target = handleFor(base);

      const rivals = Array.from({ length: others }, (_, i) =>
        peer(`r${i}`, {
          name: handleFor(base + 1 + i),
          title: `WORK: help ${target}`,
        })
      );

      const result = resolveTarget(
        [peer("t", { name: target }), ...rivals],
        target.toLowerCase()
      );

      assert.isTrue(Result.isSuccess(result));

      if (Result.isSuccess(result)) {
        assert.strictEqual(result.success.name, target);
      }
    }
  );

  it.prop(
    "an ambiguous title lists every candidate, in order",
    { base: Id, count: SmallCount },
    ({ base, count }) => {
      const peers = Array.from({ length: count }, (_, i) =>
        peer(`p${i}`, {
          name: handleFor(base + i),
          title: `T${i}: auth rewrite`,
        })
      );

      const result = resolveTarget(peers, "auth");
      assert.isTrue(Result.isFailure(result));

      if (Result.isFailure(result)) {
        assert.strictEqual(result.failure._tag, "TargetAmbiguous");
        assert.deepStrictEqual(
          "candidates" in result.failure ? result.failure.candidates : [],
          peers.map((p) => p.name)
        );
      }
    }
  );

  it("finds a unique title card or title text and reports unknown queries", () => {
    const peers = [
      peer("1", { name: "GoldXenon", title: "PLAN: auth rewrite" }),
      peer("2", { name: "RedOwl", title: "FIX: billing tests" }),
    ];

    const found = (query: string) => {
      const result = resolveTarget(peers, query);

      return Result.isSuccess(result)
        ? result.success.name
        : result.failure._tag;
    };

    assert.strictEqual(found("plan"), "GoldXenon");
    assert.strictEqual(found("billing"), "RedOwl");
    assert.strictEqual(found("nobody"), "TargetNotFound");
    assert.strictEqual(found("   "), "TargetNotFound");
  });
});

describe("broadcastTargets", () => {
  const Groups = Schema.Array(Schema.Literals(["/a", "/b", "/c"]));

  it.prop(
    "the group scope is a subset of the all scope",
    { groups: Groups },
    ({ groups }) => {
      const peers = groups.map((group, i) => peer(`p${i}`, { group }));
      const inGroup = broadcastTargets(peers, "/a", "group");
      const everyone = broadcastTargets(peers, "/a", "all");
      assert.strictEqual(everyone.length, peers.length);
      assert.isTrue(inGroup.every((p) => everyone.includes(p)));
      assert.isTrue(inGroup.every((p) => effectiveGroup(p) === "/a"));
      assert.strictEqual(
        inGroup.length,
        peers.filter((p) => p.group === "/a").length
      );
    }
  );
});

describe("paths and roots", () => {
  it("relative claims absolutize, scheme URIs are left alone, directories match by prefix", () => {
    assert.strictEqual(absolutize("/w", "src/a.ts"), "/w/src/a.ts");
    assert.strictEqual(absolutize("/w", "src/"), "/w/src/");
    assert.strictEqual(
      absolutize("/w", "xd://pi_messenger"),
      "xd://pi_messenger"
    );
    assert.isTrue(matchesReservation("/w/src/a.ts", "/w/src/"));
    assert.isFalse(matchesReservation("/w/src/a.ts", "/w/src/b.ts"));
    assert.strictEqual(displayPath("/w", "/w/src/a.ts"), "src/a.ts");
    assert.strictEqual(displayPath("/w", "/elsewhere/a.ts"), "/elsewhere/a.ts");
  });

  it("editedPaths reads path fields and patch headers", () => {
    assert.deepStrictEqual(editedFrom({ content: "x", path: "a.ts" }), [
      "a.ts",
    ]);
    assert.deepStrictEqual(
      editedFrom({
        input: "*** Begin Patch\n[src/a.ts#1A2B]\nPUT >1:\n+x\n[b.ts#FFFF]\n+y",
      }),
      ["src/a.ts", "b.ts"]
    );
    assert.deepStrictEqual(
      editedFrom({ input: "*** Update File: lib/c.ts\n@@" }),
      ["lib/c.ts"]
    );
    assert.deepStrictEqual(editedFrom("nope"), []);
  });

  it("repoGroup groups worktrees by the shared git dir and submodules by toplevel", () => {
    assert.strictEqual(repoGroup("/r/.git", "/r/wt", "/r/wt"), "/r");
    assert.strictEqual(
      repoGroup("/r/.git/modules/sub", "/r/sub", "/r/sub"),
      "/r/sub"
    );
    assert.strictEqual(repoGroup(undefined, undefined, "/loose"), "/loose");
  });

  it("underRoots matches home-relative globs", () => {
    assert.isTrue(underRoots("/h/work/a/b", ["~/work/*"], "/h"));
    assert.isFalse(underRoots("/h/other", ["~/work/*"], "/h"));
    assert.isTrue(underRoots("/h/work", ["~/work/*"], "/h"));
  });
});

describe("peer formatting", () => {
  it("peer lines carry subagent counts and the last attributed edit", () => {
    const busy = peer("p", {
      name: "GoldXenon",
      recent: [{ at: 1, by: "scout", path: "/work/repo/src/auth.ts" }],
      status: "working",
      subagents: 3,
    });

    assert.strictEqual(
      describePeer(busy),
      "- @GoldXenon — repo — working — 3 subagents — last edit src/auth.ts (scout)"
    );
    assert.include(
      describePeer(peer("q", { name: "RedOwl", subagents: 1 })),
      "1 subagent"
    );

    const listing = formatPeerList(
      peer("me", { name: "Me" }),
      [busy, peer("z", { group: "/x", name: "Far" })],
      false
    );

    assert.include(listing, "3 subagents");
    assert.include(listing, "1 more in other repos");
  });
});
