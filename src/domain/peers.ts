import { Option, Result } from "effect";
import { humanId } from "human-id";

import { ClaimConflict } from "./claim-conflict.ts";
import { matchesReservation } from "./paths.ts";
import type { Peer } from "./peer.ts";
import { TargetAmbiguous } from "./target-ambiguous.ts";
import { TargetNotFound } from "./target-not-found.ts";

export const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);

    return true;
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "EPERM";
  }
};

export const findConflict = (
  peers: readonly Peer[],
  selfSessionId: string,
  filePath: string
): Option.Option<ClaimConflict> => {
  for (const peer of peers) {
    if (peer.sessionId === selfSessionId) {
      continue;
    }

    const reservation = peer.reservations.find((r) =>
      matchesReservation(filePath, r.pattern)
    );

    if (reservation) {
      return Option.some(
        new ClaimConflict({
          holder: peer.name,
          holderCwd: peer.cwd,
          path: filePath,
          reason: reservation.reason,
        })
      );
    }
  }

  return Option.none();
};

export const repoGroup = (
  gitCommonDir: string | undefined,
  topLevel: string | undefined,
  cwd: string
): string => {
  if (
    gitCommonDir !== undefined &&
    gitCommonDir !== "" &&
    !gitCommonDir.includes("/.git/modules/")
  ) {
    return gitCommonDir.replace(/\/\.git$/u, "") || cwd;
  }

  return topLevel ?? cwd;
};

export const effectiveGroup = (peer: Peer): string => peer.group ?? peer.cwd;

export const titleCard = (title: string | undefined): string | undefined =>
  title === undefined
    ? undefined
    : /(?<card>[A-Z][A-Z0-9_-]{1,15}):/u.exec(title)?.groups?.card;

export const resolveTarget = (
  peers: readonly Peer[],
  query: string
): Result.Result<Peer, TargetNotFound | TargetAmbiguous> => {
  const q = query.trim().toLowerCase();
  const notFound = Result.fail(new TargetNotFound({ query }));

  if (!q) {
    return notFound;
  }

  const byHandle = peers.find((p) => p.name.toLowerCase() === q);

  if (byHandle) {
    return Result.succeed(byHandle);
  }

  const matches = peers.filter(
    (p) =>
      titleCard(p.title)?.toLowerCase() === q ||
      p.title?.toLowerCase().includes(q) === true
  );

  const [only, second] = matches;

  if (only && !second) {
    return Result.succeed(only);
  }

  if (second) {
    return Result.fail(
      new TargetAmbiguous({ candidates: matches.map((p) => p.name), query })
    );
  }

  return notFound;
};

export type BroadcastScope = "group" | "all";

export const broadcastTargets = (
  peers: readonly Peer[],
  selfGroup: string,
  scope: BroadcastScope
): Peer[] =>
  scope === "all"
    ? [...peers]
    : peers.filter((p) => effectiveGroup(p) === selfGroup);

const newName = (): string => humanId({ capitalize: true, separator: "" });

export const generateName = (taken: ReadonlySet<string>): string => {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const name = newName();

    if (!taken.has(name)) {
      return name;
    }
  }

  const base = newName();

  for (let n = 2; ; n += 1) {
    if (!taken.has(`${base}${n}`)) {
      return `${base}${n}`;
    }
  }
};
