import { mkdirSync, writeFileSync } from "node:fs";

const root = `${process.env.HOME}/work/labs`;
const dirA = `${root}/mesh-test-a`;
const dirB = `${root}/mesh-test-b`;
mkdirSync(dirA, { recursive: true });
mkdirSync(dirB, { recursive: true });
writeFileSync(`${dirA}/shared.txt`, "shared file for claim smoke test\n");

const meshBase = `${process.env.HOME}/.omp/agent/mesh`;
const feedFile = `${meshBase}/feed.jsonl`;
const agentsDirPath = `${meshBase}/agents`;

interface RunResult {
  out: string;
  code: number;
}

const MODEL = "commandcode/deepseek/deepseek-v4-flash";

const runOmp = (cwd: string, prompt: string, timeoutMs = 420_000): Promise<RunResult> => {
  const proc = Bun.spawn(
    ["omp", "-p", "--no-session", "--model", MODEL, "--approval-mode", "yolo", prompt],
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

const ownName = (out: string): string | undefined => /You are (\w+)\./.exec(out)?.[1];

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

console.log("== running agent B ==");
const b = await runOmp(
  dirB,
  "You auto-joined the omp mesh. Do these in order: " +
    "(1) Before calling any tool, print exactly one line: 'BRIEF: ' followed by the agent names from the note in your context that begins 'Mesh peers online now', or 'BRIEF: none' if there is no such note. " +
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
  "4. B's startup brief named A before any tool call",
  Boolean(aName && new RegExp(`BRIEF:[^\\n]*${aName}`).test(b.out)),
  `BRIEF line: ${/BRIEF:[^\n]*/.exec(b.out)?.[0] ?? "(none found)"}`,
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

const failed = verdicts.filter(([, ok]) => !ok);
console.log(
  `\n== smoke done: ${verdicts.length - failed.length}/${verdicts.length} checks passed ==`,
);
process.exit(failed.length > 0 ? 1 : 0);
