import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { absolutize, matchesReservation } from "../src/paths.ts";
import type { Peer } from "../src/peer.ts";
import {
  ensureDirs,
  findConflict,
  generateName,
  livePeers,
  reapDead,
  removePresence,
  Throttle,
  writePresence,
} from "../src/store.ts";

let base: string;

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "mesh-store-"));
  ensureDirs(base);
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

const peer = (sessionId: string, pid: number, extra: Partial<Peer> = {}): Peer => ({
  name: `Peer-${sessionId}`,
  pid,
  sessionId,
  cwd: "/work/x",
  status: "idle",
  reservations: [],
  updatedAt: Date.now(),
  ...extra,
});

describe("presence", () => {
  test("livePeers excludes self and dead PIDs; reapDead removes dead files", () => {
    writePresence(base, peer("self", process.pid));
    writePresence(base, peer("live", process.pid));
    writePresence(base, peer("dead", 99_999_999));

    expect(livePeers(base, "self").map((p) => p.sessionId)).toEqual(["live"]);

    reapDead(base);
    expect(
      livePeers(base, "nobody")
        .map((p) => p.sessionId)
        .sort(),
    ).toEqual(["live", "self"]);
    removePresence(base, "self");
    expect(livePeers(base, "nobody").map((p) => p.sessionId)).toEqual(["live"]);
  });

  test("generateName avoids taken names", () => {
    const name = generateName(new Set(["x"]));
    expect(name).not.toBe("x");
    expect(name.length).toBeGreaterThan(2);
  });
});

describe("claims", () => {
  test("findConflict matches exact files and directory prefixes, skipping self", () => {
    const holder = peer("holder", process.pid, {
      reservations: [
        { pattern: "/repo/src/auth/", since: 1 },
        { pattern: "/repo/README.md", since: 1 },
      ],
    });
    const peers = [holder, peer("me", process.pid)];

    expect(
      findConflict(peers, "me", "/repo/src/auth/login.ts", matchesReservation)?.peer.sessionId,
    ).toBe("holder");
    expect(findConflict(peers, "me", "/repo/README.md", matchesReservation)?.peer.sessionId).toBe(
      "holder",
    );
    expect(findConflict(peers, "me", "/repo/src/other.ts", matchesReservation)).toBeUndefined();
    expect(findConflict(peers, "holder", "/repo/README.md", matchesReservation)).toBeUndefined();
  });
});

describe("paths", () => {
  test("absolutize resolves relatives, keeps absolutes and scheme URIs", () => {
    expect(absolutize("/repo", "src/a.ts")).toBe("/repo/src/a.ts");
    expect(absolutize("/repo", "src/")).toBe("/repo/src/");
    expect(absolutize("/repo", "/x/a.ts")).toBe("/x/a.ts");
    expect(absolutize("/repo", "xd://pi_messenger")).toBe("xd://pi_messenger");
  });
});

describe("Throttle", () => {
  test("burst is free, then sends are delayed by the refill interval, never rejected", () => {
    const throttle = new Throttle(2, 1_000);
    const t0 = Date.now();
    expect(throttle.take(t0)).toBe(0);
    expect(throttle.take(t0)).toBe(0);
    expect(throttle.take(t0)).toBe(1_000);
    expect(throttle.take(t0 + 1_000)).toBe(1_000);
    expect(throttle.take(t0 + 3_000)).toBe(0);
  });
});
