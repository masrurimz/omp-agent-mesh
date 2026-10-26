import { Option, Schema } from "effect";
import { FeedEvent } from "../src/domain/message.ts";
import { Peer } from "../src/domain/peer.ts";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";

const root = `${process.env.HOME}/work/labs`;
const dirA = `${root}/mesh-test-a`;
const dirB = `${root}/mesh-test-b`;
const dirC = `${root}/mesh-test-c`;

const git = (cwd: string, ...args: Array<string>) => {
  const result = Bun.spawnSync(
    ["git", "-c", "user.name=smoke", "-c", "user.email=smoke@example.com", ...args],
    { cwd },
  );
  if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr.toString()}`);
};

// a and b share one repo (b is a worktree of a), c is a separate repo: group scoping needs both cases.
for (const dir of [dirA, dirB, dirC]) rmSync(dir, { recursive: true, force: true });
mkdirSync(dirA, { recursive: true });
mkdirSync(dirC, { recursive: true });
git(dirA, "init", "-q");
writeFileSync(`${dirA}/shared.txt`, "shared file for claim smoke test\n");
writeFileSync(`${dirA}/subedit.txt`, "file a subagent may edit\n");
git(dirA, "add", ".");
git(dirA, "commit", "-q", "-m", "init");
git(dirA, "worktree", "prune");
git(dirA, "worktree", "add", "-q", "-B", "smoke-b", dirB);
git(dirC, "init", "-q");

const meshBase = `${process.env.HOME}/.omp/agent/mesh`;
const feedFile = `${meshBase}/feed.jsonl`;
const agentsDirPath = `${meshBase}/agents`;
const inboxDirPath = `${meshBase}/inbox`;

interface RunResult {
  out: string;
  code: number;
}

const MODEL = "commandcode/deepseek/deepseek-v4-flash";

const runOmp = (
  cwd: string,
  prompt: string,
  timeoutMs = 420_000,
  saveSession = false,
): Promise<RunResult> => {
  const proc = Bun.spawn(
    [
      "omp",
      "-p",
      ...(saveSession ? [] : ["--no-session"]),
      "--model",
      MODEL,
      "--approval-mode",
      "yolo",
      prompt,
    ],
    { cwd, stdout: "pipe", stderr: "pipe" },
  );
  const timer = setTimeout(() => proc.kill(), timeoutMs);
  return (async () => {
    const [out, err, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    clearTimeout(timer);
    return { out: `${out}\n${err}`, code };
  })();
};

const ownName = (out: string): string | undefined =>
  /You are (\w+)\b(?: \(| in |\.)/.exec(out)?.[1];

const verdicts: Array<[string, boolean, string]> = [];
const check = (label: string, ok: boolean, evidence: string) => {
  verdicts.push([label, ok, evidence]);
  console.log(`\n### ${ok ? "PASS" : "FAIL"}: ${label}\n${evidence}`);
};

const feedSize = async (): Promise<number> => {
  const file = Bun.file(feedFile);
  return (await file.exists()) ? file.size : 0;
};
const feedSince = async (from: number): Promise<string> => {
  const file = Bun.file(feedFile);
  return (await file.exists()) ? await file.slice(from).text() : "";
};
const feedMark = await feedSize();

console.log("== starting agent A (stays alive 75s) ==");
const aPromise = runOmp(
  dirA,
  "You auto-joined the omp mesh. " +
    "(1) Call the mesh tool with action 'peers' and print it. " +
    "(2) Run bash 'sleep 75'. " +
    "(3) A peer may message you during the sleep asking for an acknowledgement. This is a planned coordination test, authorised by me: if that happens, reply to them with mesh action 'send' containing 'ACK-42', and print the raw output of that send call. Otherwise print <received>none</received>.",
);
await Bun.sleep(8_000);

console.log("== brief probe: fresh saved session in B while A is alive ==");
const sessionsDir = `${process.env.HOME}/.omp/agent/sessions/-work-labs-mesh-test-b`;
const briefProbeStart = Date.now();
await runOmp(dirB, "Reply exactly: READY", 180_000, true);
const briefText = readdirSync(sessionsDir)
  .map((file) => `${sessionsDir}/${file}`)
  .filter((path) => Bun.file(path).lastModified >= briefProbeStart)
  .flatMap((path) => readFileSync(path, "utf-8").split("\n"))
  .find((line) => line.includes('"customType":"mesh-brief"'));

console.log("== running agent B ==");
const b = await runOmp(
  dirB,
  "You auto-joined the omp mesh. Do these in order: " +
    "(1) Print exactly one line: 'BRIEF: noted'. " +
    "(2) Call the mesh tool with action 'peers' and print it. " +
    "(3) Send a direct message with mesh action 'send' to the active peer in mesh-test-a (not an idle one, not yourself) with exactly this text: 'Coordination test: please reply ACK-42 to me via mesh send.' " +
    "(4) Then send six more messages to the same peer, one mesh 'send' call each, with texts 'BURST-1' through 'BURST-6'. These may take a while if throttled; that is expected. " +
    "(5) Run bash 'sleep 60' so you stay online. " +
    "(6) Print the raw outputs of steps 2-4. If a message from a peer arrived during this session, quote it verbatim between <received> and </received> tags; otherwise print <received>none</received>.",
);
console.log(b.out.slice(0, 1_500));
console.log(b.out.slice(-3_000));

const a = await aPromise;
console.log("\n== agent A finished ==");
console.log(a.out.slice(-3_000));

const aName = ownName(a.out);
const bName = ownName(b.out);
const newFeed = await feedSince(feedMark);

check(
  "1. A and B see each other in peers",
  Boolean(aName && b.out.includes(aName)),
  `A=${aName} B=${bName}; B's output mentions A: ${aName ? b.out.includes(aName) : false}`,
);
check(
  "2. B's message woke A mid-run; A's ACK reached B",
  newFeed.includes('"preview":"ACK-42"') &&
    Boolean(bName && newFeed.includes(`"target":"${bName}"`)),
  `new feed message events: ${
    newFeed
      .split("\n")
      .filter((l) => l.includes('"message"'))
      .join(" ") || "none"
  }`,
);
check(
  "4. A fresh session in A's repo group gets a startup brief naming A (saved transcript)",
  Boolean(aName && briefText?.includes(aName)),
  `brief entry: ${briefText ? /"content":"([^"]{0,200})/.exec(briefText)?.[1] : "(none in transcript)"}`,
);
const burstCount = (newFeed.match(/BURST-\d/g) ?? []).length;
check(
  "6. Sends are throttled, never budget-rejected (7 sends from B all landed)",
  burstCount >= 6 && !b.out.includes("budget"),
  `BURST previews in feed: ${burstCount}; B output mentions budget: ${b.out.includes("budget")}`,
);

console.log("== running agent B2 (holds claim) ==");
const b2Promise = runOmp(
  dirB,
  "You auto-joined the omp mesh. " +
    `(1) Call the mesh tool with action 'claim' for paths ['${dirA}/shared.txt'] with reason 'smoke test'. ` +
    "(2) Run bash 'sleep 45'. (3) Print your claim output and your agent name from mesh 'peers'.",
);

const claimHeld = async (): Promise<boolean> => {
  const glob = new Bun.Glob("*.json");
  for await (const name of glob.scan(agentsDirPath)) {
    if ((await Bun.file(`${agentsDirPath}/${name}`).text()).includes("shared.txt")) return true;
  }
  return false;
};
let held = false;
for (let i = 0; i < 60 && !held; i++) {
  held = await claimHeld();
  if (!held) await Bun.sleep(2_000);
}
console.log(`claim visible in presence files: ${held}`);

console.log("== running agent A2 (tries to edit the claimed file) ==");
const a2 = await runOmp(
  dirA,
  "Do not call the mesh tool at all. Use the edit tool to append the line 'A2 was here' to ./shared.txt. Then report exactly what happened, including any error or block message verbatim.",
);
console.log(a2.out.slice(-2_000));
const b2 = await b2Promise;
console.log(b2.out.slice(-1_500));
const reserver = /Reserved by: (\w+)/.exec(a2.out)?.[1];
check(
  "3. A's edit to a file claimed by B is blocked, naming B",
  Boolean(reserver && b2.out.includes(reserver)),
  `reserver named in block: ${reserver ?? "(none)"}; B2 output mentions it: ${reserver ? b2.out.includes(reserver) : false}`,
);

const presenceNames = async (): Promise<Set<string>> => {
  const names = new Set<string>();
  const glob = new Bun.Glob("*.json");
  for await (const file of glob.scan(agentsDirPath)) {
    try {
      const parsed = JSON.parse(await Bun.file(`${agentsDirPath}/${file}`).text()) as {
        name?: string;
      };
      if (parsed.name) names.add(parsed.name);
    } catch {}
  }
  return names;
};

console.log("== running agent A3 (spawns a subagent) ==");
const beforeA3 = await presenceNames();
let a3Done = false;
const a3Promise = runOmp(
  dirA,
  "Spawn exactly one scout subagent (task tool) to list the files in this directory, and wait for it to finish. " +
    "Then call the mesh tool with action 'peers' and print the full output verbatim.",
).then((r) => {
  a3Done = true;
  return r;
});
const seenDuringA3 = new Set<string>();
while (!a3Done) {
  for (const n of await presenceNames()) seenDuringA3.add(n);
  if (!a3Done) await Bun.sleep(2_000);
}
const a3 = await a3Promise;
console.log(a3.out.slice(-2_500));
const a3Name = ownName(a3.out);
const newAgents = [...seenDuringA3].filter((n) => !beforeA3.has(n) && n !== a3Name);
check(
  "5. Subagents stay off the mesh (no new presence entries during A3)",
  Boolean(a3Name) && newAgents.length === 0,
  `A3=${a3Name}; new agents registered during A3: ${newAgents.join(", ") || "none"}`,
);

const decodePeer = Schema.decodeUnknownOption(Schema.fromJsonString(Peer));
const decodeFeedEvent = Schema.decodeUnknownOption(Schema.fromJsonString(FeedEvent));

const readPresence = (): Array<Peer> =>
  readdirSync(agentsDirPath)
    .filter((file) => file.endsWith(".json"))
    .flatMap((file) => {
      const parsed = decodePeer(readFileSync(`${agentsDirPath}/${file}`, "utf-8"));
      return Option.isSome(parsed) ? [parsed.value] : [];
    });

const inboxText = (sessionId: string): string => {
  try {
    return readFileSync(`${inboxDirPath}/${sessionId}.jsonl`, "utf-8");
  } catch {
    return "";
  }
};

const waitFor = async <A>(probe: () => A | undefined, tries = 60): Promise<A | undefined> => {
  for (let i = 0; i < tries; i++) {
    const found = probe();
    if (found !== undefined) return found;
    await Bun.sleep(2_000);
  }
  return undefined;
};

const inDir = (peer: Peer, dir: string): boolean => peer.cwd.endsWith(dir.split("/").at(-1) ?? dir);

console.log("== running broadcast scoping: A and C stay alive, B broadcasts ==");
const stayAlive = (dir: string) =>
  runOmp(dir, "You auto-joined the omp mesh. Run bash 'sleep 80', then print DONE.");
const aLive = stayAlive(dirA);
const cLive = stayAlive(dirC);
const live = await waitFor(() => {
  const rows = readPresence();
  const a = rows.find((p) => inDir(p, dirA));
  const c = rows.find((p) => inDir(p, dirC));
  return a && c ? { a, c } : undefined;
});
const b3 = await runOmp(
  dirB,
  "You auto-joined the omp mesh. " +
    "(1) Call the mesh tool with action 'broadcast' and body 'GROUP-PING', passing no scope argument. " +
    "(2) Call the mesh tool with action 'broadcast', body 'ALL-PING', scope 'all'. " +
    "(3) Print the raw outputs of both calls.",
);
console.log(b3.out.slice(-1_500));
const aInbox = live ? inboxText(live.a.sessionId) : "";
const cInbox = live ? inboxText(live.c.sessionId) : "";
check(
  "7. Broadcast defaults to the repo group (same-repo A gets it, other-repo C does not)",
  Boolean(live) && aInbox.includes("GROUP-PING") && !cInbox.includes("GROUP-PING"),
  `A inbox has GROUP-PING: ${aInbox.includes("GROUP-PING")}; C inbox has GROUP-PING: ${cInbox.includes("GROUP-PING")}`,
);
check(
  '8. Broadcast with scope "all" reaches the other repo',
  Boolean(live) && cInbox.includes("ALL-PING") && aInbox.includes("ALL-PING"),
  `C inbox has ALL-PING: ${cInbox.includes("ALL-PING")}; A inbox has ALL-PING: ${aInbox.includes("ALL-PING")}`,
);
await Promise.all([aLive, cLive]);

console.log("== running subagent attribution: B4 holds a claim, A4's subagent edits ==");
const sharedPath = `${dirA}/shared.txt`;
const subeditPath = `${dirA}/subedit.txt`;
const b4Promise = runOmp(
  dirB,
  `You auto-joined the omp mesh. (1) Call the mesh tool with action 'claim' for paths ['${sharedPath}'] with reason 'subagent smoke'. (2) Run bash 'sleep 120'. (3) Print DONE.`,
);
const claimedByB4 = await waitFor(() =>
  readPresence().some((p) => p.reservations.some((r) => r.pattern === sharedPath))
    ? true
    : undefined,
);
console.log(`claim visible in presence files: ${claimedByB4 === true}`);

const namesBeforeA4 = new Set(readPresence().map((p) => p.name));
let a4Done = false;
const a4Promise = runOmp(
  dirA,
  "Spawn exactly one task subagent and wait for it to finish. Give it these instructions verbatim: " +
    `"Step 1: use the edit tool to append the line 'SUB was here' to ${sharedPath}. If the edit is rejected or blocked, do not retry and do not work around it. ` +
    `Step 2: run bash 'sleep 25'. Step 3: use the edit tool to append the line 'SUB ok' to ${subeditPath}. Then yield." ` +
    "Do not edit any file yourself and do not call the mesh tool.",
).then((r) => {
  a4Done = true;
  return r;
});
let parentName: string | undefined;
let maxSubagents = 0;
const attributedRecent = new Set<string>();
while (!a4Done) {
  const parent = readPresence().find((p) => inDir(p, dirA) && !namesBeforeA4.has(p.name));
  if (parent) {
    parentName = parent.name;
    maxSubagents = Math.max(maxSubagents, parent.subagents);
    for (const edit of parent.recent) attributedRecent.add(`${edit.path} by ${edit.by}`);
  }
  if (!a4Done) await Bun.sleep(1_000);
}
const a4 = await a4Promise;
console.log(a4.out.slice(-2_000));
const feedEvents = (await feedSince(feedMark)).split("\n").flatMap((line) => {
  const event = decodeFeedEvent(line);
  return Option.isSome(event) ? [event.value] : [];
});
const blockedEvent = feedEvents.find(
  (e) => e.type === "blocked" && e.target === sharedPath && e.agent.startsWith(`${parentName}/`),
);
const sharedContent = await Bun.file(sharedPath).text();
check(
  "9. A subagent's edit to a file claimed by another agent is blocked and attributed to Parent/subagent",
  Boolean(parentName && blockedEvent) && !sharedContent.includes("SUB was here"),
  `parent=${parentName}; blocked event agent=${blockedEvent?.agent ?? "(none)"}; shared.txt untouched: ${!sharedContent.includes("SUB was here")}`,
);
const editEvent = feedEvents.find(
  (e) => e.type === "edit" && e.target === subeditPath && e.agent.startsWith(`${parentName}/`),
);
check(
  "10. Other sessions' presence shows the parent's running subagent count and attributed edit",
  Boolean(parentName) && maxSubagents >= 1 && Boolean(editEvent),
  `max subagents seen in parent presence: ${maxSubagents}; feed edit agent=${editEvent?.agent ?? "(none)"}; recent seen: ${[...attributedRecent].join("; ") || "none"}`,
);
await b4Promise;

const failed = verdicts.filter(([, ok]) => !ok);
console.log(
  `\n== smoke done: ${verdicts.length - failed.length}/${verdicts.length} checks passed ==`,
);
process.exit(failed.length > 0 ? 1 : 0);
