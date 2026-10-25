import type { Peer } from "./peer.ts";

const describe = (peer: Peer): string => {
  const folder = peer.cwd.split("/").filter(Boolean).at(-1) ?? peer.cwd;
  const where = peer.branch ? `${folder} (${peer.branch})` : folder;
  const doing = peer.note ?? (peer.status === "working" ? "working" : undefined);
  return doing ? `- ${peer.name} — ${where} — ${doing}` : `- ${peer.name} — ${where}`;
};

export const formatBrief = (peers: ReadonlyArray<Peer>): string =>
  [
    "Mesh peers online now:",
    ...peers.map(describe),
    "Reach them with the mesh tool: `peers` for live status, `send` to message one peer.",
  ].join("\n");
