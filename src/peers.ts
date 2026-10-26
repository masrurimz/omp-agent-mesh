import { humanId } from "human-id";
import type { Peer, Reservation } from "./peer.ts";

export interface ClaimConflict {
  readonly peer: Peer;
  readonly reservation: Reservation;
}

export const folderName = (cwd: string): string => cwd.split("/").filter(Boolean).at(-1) ?? cwd;

export const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "EPERM";
  }
};

export const findConflict = (
  peers: ReadonlyArray<Peer>,
  selfSessionId: string,
  filePath: string,
  matches: (filePath: string, pattern: string) => boolean,
): ClaimConflict | undefined => {
  for (const peer of peers) {
    if (peer.sessionId === selfSessionId) continue;
    for (const reservation of peer.reservations) {
      if (matches(filePath, reservation.pattern)) return { peer, reservation };
    }
  }
  return undefined;
};

export const repoGroup = (
  gitCommonDir: string | undefined,
  topLevel: string | undefined,
  cwd: string,
): string => {
  if (gitCommonDir && !gitCommonDir.includes("/.git/modules/")) {
    return gitCommonDir.replace(/\/\.git$/, "") || cwd;
  }
  return topLevel ?? cwd;
};

export const effectiveGroup = (peer: Peer): string => peer.group ?? peer.cwd;

export const titleCard = (title: string | undefined): string | undefined =>
  title ? /([A-Z][A-Z0-9_-]{1,15}):/.exec(title)?.[1] : undefined;

export type TargetResolution =
  | { readonly kind: "found"; readonly peer: Peer }
  | { readonly kind: "ambiguous"; readonly names: ReadonlyArray<string> }
  | { readonly kind: "none" };

export const resolveTarget = (peers: ReadonlyArray<Peer>, query: string): TargetResolution => {
  const q = query.trim().toLowerCase();
  if (!q) return { kind: "none" };
  const byHandle = peers.find((p) => p.name.toLowerCase() === q);
  if (byHandle) return { kind: "found", peer: byHandle };
  const matches = peers.filter(
    (p) =>
      titleCard(p.title)?.toLowerCase() === q ||
      (p.title ? p.title.toLowerCase().includes(q) : false),
  );
  if (matches.length === 1 && matches[0]) return { kind: "found", peer: matches[0] };
  if (matches.length > 1) return { kind: "ambiguous", names: matches.map((p) => p.name) };
  return { kind: "none" };
};

export type BroadcastScope = "group" | "all";

export const broadcastTargets = (
  peers: ReadonlyArray<Peer>,
  selfGroup: string,
  scope: BroadcastScope,
): Array<Peer> =>
  scope === "all" ? [...peers] : peers.filter((p) => effectiveGroup(p) === selfGroup);

const newName = (): string => humanId({ separator: "", capitalize: true });

export const generateName = (taken: ReadonlySet<string>): string => {
  for (let attempt = 0; attempt < 5; attempt++) {
    const name = newName();
    if (!taken.has(name)) return name;
  }
  const base = newName();
  for (let n = 2; ; n++) {
    if (!taken.has(`${base}${n}`)) return `${base}${n}`;
  }
};
