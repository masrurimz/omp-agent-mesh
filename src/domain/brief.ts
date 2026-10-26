import { displayPath, folderName } from "./paths.ts";
import type { Peer } from "./peer.ts";
import { effectiveGroup } from "./peers.ts";

export const formatStatus = (name: string, peerCount: number, unread: number): string =>
  `mesh: ${name} (${peerCount} peer${peerCount === 1 ? "" : "s"})${unread > 0 ? ` ●${unread}` : ""}`;

export const describePeer = (peer: Peer): string => {
  const head = peer.title ? `"${peer.title}" — @${peer.name}` : `@${peer.name}`;
  const where = peer.branch ? `${folderName(peer.cwd)} (${peer.branch})` : folderName(peer.cwd);
  const parts = [head, where, peer.note ? `${peer.status} — ${peer.note}` : peer.status];
  if (peer.subagents > 0) {
    parts.push(`${peer.subagents} subagent${peer.subagents === 1 ? "" : "s"}`);
  }
  const last = peer.recent[0];
  if (last) parts.push(`last edit ${displayPath(peer.cwd, last.path)} (${last.by})`);
  if (peer.reservations.length > 0) {
    parts.push(
      `claims: ${peer.reservations.map((r) => displayPath(peer.cwd, r.pattern)).join(", ")}`,
    );
  }
  return `- ${parts.join(" — ")}`;
};

export const formatBrief = (peers: ReadonlyArray<Peer>, groupLabel?: string): string =>
  [
    groupLabel ? `Mesh peers in this repo (${groupLabel}):` : "Mesh peers online now:",
    ...peers.map(describePeer),
    "Reach them with the mesh tool: `peers` for live status, `send` to message one peer.",
  ].join("\n");

export const formatPeerList = (
  me: Peer,
  peers: ReadonlyArray<Peer>,
  includeOtherRepos: boolean,
): string => {
  const myGroup = effectiveGroup(me);
  const mine = peers.filter((p) => effectiveGroup(p) === myGroup);
  const others = peers.filter((p) => effectiveGroup(p) !== myGroup);
  const out = [
    `You are ${me.name}${me.title ? ` ("${me.title}")` : ""} in ${folderName(myGroup)}.`,
  ];
  out.push(
    mine.length
      ? `In this repo (${mine.length}):\n${mine.map(describePeer).join("\n")}`
      : "No other agents in this repo.",
  );
  if (includeOtherRepos && others.length) {
    const byGroup = new Map<string, Array<Peer>>();
    for (const p of others) {
      const key = folderName(effectiveGroup(p));
      byGroup.set(key, [...(byGroup.get(key) ?? []), p]);
    }
    for (const [group, members] of byGroup) {
      out.push(`In ${group} (${members.length}):\n${members.map(describePeer).join("\n")}`);
    }
  } else if (others.length) {
    out.push(`${others.length} more in other repos (all: true lists them).`);
  }
  return out.join("\n");
};
