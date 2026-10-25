import type { Peer } from "./peer.ts";

const describe = (peer: Peer): string => {
  const folder = peer.cwd.split("/").filter(Boolean).at(-1) ?? peer.cwd;
  const where = peer.gitBranch ? `${folder} (${peer.gitBranch})` : folder;
  const doing = peer.statusMessage ?? peer.activity?.currentActivity;
  return doing ? `- ${peer.name} — ${where} — ${doing}` : `- ${peer.name} — ${where}`;
};

export const formatBrief = (peers: ReadonlyArray<Peer>): string =>
  [
    "Mesh peers online now:",
    ...peers.map(describe),
    "Reach them with pi_messenger: `list` for live status, `send` to message one peer.",
  ].join("\n");
