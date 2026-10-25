import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { Peer, Reservation } from "./peer.ts";

export interface MeshMessage {
  readonly from: string;
  readonly to: string;
  readonly body: string;
  readonly broadcast: boolean;
  readonly at: number;
}

export const meshDir = (): string =>
  process.env.OMP_AGENT_MESH_DIR ?? join(process.env.HOME ?? "", ".omp/agent/mesh");

export const agentsDir = (base: string): string => join(base, "agents");
export const inboxDir = (base: string): string => join(base, "inbox");
export const inboxPath = (base: string, name: string): string =>
  join(inboxDir(base), `${name}.jsonl`);
export const feedPath = (base: string): string => join(base, "feed.jsonl");

export const ensureDirs = (base: string): void => {
  mkdirSync(agentsDir(base), { recursive: true });
  mkdirSync(inboxDir(base), { recursive: true });
};

const presencePath = (base: string, sessionId: string): string =>
  join(agentsDir(base), `${sessionId}.json`);

export const writePresence = (base: string, peer: Peer): void => {
  const path = presencePath(base, peer.sessionId);
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(peer));
  renameSync(tmp, path);
};

export const removePresence = (base: string, sessionId: string): void => {
  rmSync(presencePath(base, sessionId), { force: true });
};

export const readPresenceFile = (path: string): Peer | undefined => {
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as Peer;
  } catch {
    return undefined;
  }
};

export const listPresence = (base: string): Array<Peer> => {
  if (!existsSync(agentsDir(base))) return [];
  const peers: Array<Peer> = [];
  for (const file of readdirSync(agentsDir(base))) {
    if (!file.endsWith(".json")) continue;
    const peer = readPresenceFile(join(agentsDir(base), file));
    if (peer) peers.push(peer);
  }
  return peers;
};

export const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "EPERM";
  }
};

export const livePeers = (base: string, selfSessionId: string): Array<Peer> =>
  listPresence(base).filter((p) => p.sessionId !== selfSessionId && isAlive(p.pid));

export const reapDead = (base: string): void => {
  for (const peer of listPresence(base)) {
    if (!isAlive(peer.pid)) removePresence(base, peer.sessionId);
  }
};

export const appendInbox = (base: string, message: MeshMessage): void => {
  appendFileSync(inboxPath(base, message.to), `${JSON.stringify(message)}\n`);
};

export const feed = (
  base: string,
  event: { type: string; agent: string; target?: string; preview?: string },
): void => {
  const line = JSON.stringify({ ts: new Date().toISOString(), ...event });
  appendFileSync(feedPath(base), `${line}\n`);
};

export const readFeed = (base: string, limit: number): Array<string> => {
  try {
    const lines = readFileSync(feedPath(base), "utf-8").trim().split("\n").filter(Boolean);
    return lines.slice(-limit);
  } catch {
    return [];
  }
};

export interface ClaimConflict {
  readonly peer: Peer;
  readonly reservation: Reservation;
}

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

const ADJECTIVES = [
  "Amber",
  "Bold",
  "Brave",
  "Bright",
  "Calm",
  "Clever",
  "Dark",
  "Epic",
  "Fast",
  "Gold",
  "Happy",
  "Iron",
  "Jade",
  "Keen",
  "Loud",
  "Nice",
  "Oak",
  "Pure",
  "Quick",
  "Red",
  "Sage",
  "True",
  "Ultra",
  "Vivid",
];
const NOUNS = [
  "Arrow",
  "Castle",
  "Dragon",
  "Eagle",
  "Falcon",
  "Grove",
  "Hawk",
  "Ice",
  "Jaguar",
  "Lion",
  "Moon",
  "Nova",
  "Owl",
  "Phoenix",
  "Quartz",
  "Raven",
  "Storm",
  "Tiger",
  "Viper",
  "Wolf",
  "Xenon",
  "Yak",
  "Zenith",
];

export const generateName = (taken: ReadonlySet<string>): string => {
  for (let attempt = 0; attempt < 200; attempt++) {
    const name = `${ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)]}${NOUNS[Math.floor(Math.random() * NOUNS.length)]}`;
    if (!taken.has(name)) return name;
  }
  return `Agent${process.pid}`;
};

export class Throttle {
  private tokens: number;
  private last: number;

  constructor(
    private readonly capacity = 5,
    private readonly refillMs = 20_000,
  ) {
    this.tokens = capacity;
    this.last = Date.now();
  }

  take(now: number): number {
    const elapsed = now - this.last;
    if (elapsed > 0) {
      this.tokens = Math.min(this.capacity, this.tokens + elapsed / this.refillMs);
      this.last = now;
    }
    this.tokens -= 1;
    return this.tokens >= 0 ? 0 : Math.ceil(-this.tokens * this.refillMs);
  }
}
