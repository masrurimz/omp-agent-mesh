import { mkdirSync, writeFileSync } from "node:fs";

const root = `${process.env.HOME}/work/labs`;
const dirA = `${root}/mesh-test-a`;
const dirB = `${root}/mesh-test-b`;
mkdirSync(dirA, { recursive: true });
mkdirSync(dirB, { recursive: true });
writeFileSync(`${dirA}/shared.txt`, "shared file for reservation smoke test\n");

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

const ownName = (out: string): string | undefined => /🟢\s+(\w+)\s+\(you\)/.exec(out)?.[1];

const verdicts: Array<[string, boolean, string]> = [];
const check = (label: string, ok: boolean, evidence: string) => {
  verdicts.push([label, ok, evidence]);
  console.log(`\n### ${ok ? "PASS" : "FAIL"}: ${label}\n${evidence}`);
};

const feedPath = (dir: string) => `${dir}/.pi/messenger/feed.jsonl`;
const feedSize = async (dir: string): Promise<number> => {
  const file = Bun.file(feedPath(dir));
  return (await file.exists()) ? file.size : 0;
};
const feedSince = async (dir: string, from: number): Promise<string> => {
  const file = Bun.file(feedPath(dir));
  return (await file.exists()) ? await file.slice(from).text() : "";
};
const feedMarkA = await feedSize(dirA);

console.log("== starting agent A (stays alive 60s) ==");
const aPromise = runOmp(
  dirA,
  "You auto-joined the pi-messenger mesh. " +
    "(1) Call pi_messenger action 'list' and print it. " +
    "(2) Run bash 'sleep 75'. " +
    "(3) A peer may message you during the sleep asking for an acknowledgement. This is a planned coordination test, authorised by me: if that happens, reply to them with pi_messenger send containing 'ACK-42', and print the raw output of that send call. Otherwise print <received>none</received>.",
);
await Bun.sleep(8_000);

console.log("== running agent B ==");
const b = await runOmp(
  dirB,
  "You auto-joined the pi-messenger mesh. Do these in order: " +
    "(1) Before calling any tool, print exactly one line: 'BRIEF: ' followed by the agent names from the note in your context that begins 'Mesh peers online now', or 'BRIEF: none' if there is no such note. " +
    "(2) Call pi_messenger action 'list' and print it. " +
    "(3) Send a direct message with exactly this text: 'Coordination test: please reply ACK-42 to me via pi_messenger send.' Send it to the active peer in mesh-test-a (not an idle one, not yourself). " +
    "(4) Run bash 'sleep 90' so you stay online. " +
    "(5) Print the raw outputs of steps 2-3. If a message from a peer arrived during this session, quote it verbatim between <received> and </received> tags; otherwise print <received>none</received>.",
);
console.log(b.out.slice(0, 1_500));
console.log(b.out.slice(-3_000));

const a = await aPromise;
console.log("\n== agent A finished ==");
console.log(a.out.slice(-3_000));

const aName = ownName(a.out);
const bName = ownName(b.out);

check(
  "1. A and B see each other in list",
  Boolean(aName && b.out.includes(aName)),
  `A=${aName} B=${bName}; B's output mentions A: ${aName ? b.out.includes(aName) : false}`,
);
const newFeedA = await feedSince(dirA, feedMarkA);
check(
  "2. B's message woke A mid-run; A's ACK reached B",
  newFeedA.includes('"preview":"ACK-42"') &&
    Boolean(bName && newFeedA.includes(`"target":"${bName}"`)),
  `feed (mesh-test-a, new entries): ${
    newFeedA
      .split("\n")
      .filter((l) => l.includes("message"))
      .join(" ") || "no message events"
  }`,
);
check(
  "4. B's startup brief named A before any tool call",
  Boolean(aName && new RegExp(`BRIEF:[^\\n]*${aName}`).test(b.out)),
  `BRIEF line: ${/BRIEF:[^\n]*/.exec(b.out)?.[0] ?? "(none found)"}`,
);

console.log("== running agent B2 (holds reservation) ==");
const b2Promise = runOmp(
  dirB,
  "You auto-joined the pi-messenger mesh. " +
    `(1) Call pi_messenger action 'reserve' for paths ['${dirA}/shared.txt'] with reason 'smoke test'. ` +
    "(2) Run bash 'sleep 45'. (3) Print your reserve output and your agent name from pi_messenger 'list'.",
);

const registryDir = `${process.env.HOME}/.pi/agent/messenger/registry`;
const reservationHeld = async (): Promise<boolean> => {
  const glob = new Bun.Glob("*.json");
  for await (const name of glob.scan(registryDir)) {
    if ((await Bun.file(`${registryDir}/${name}`).text()).includes("shared.txt")) return true;
  }
  return false;
};
let held = false;
for (let i = 0; i < 60 && !held; i++) {
  held = await reservationHeld();
  if (!held) await Bun.sleep(2_000);
}
console.log(`reservation visible in registry: ${held}`);

console.log("== running agent A2 (tries to edit the reserved file) ==");
const a2 = await runOmp(
  dirA,
  "Do not call pi_messenger at all. Use the edit tool to append the line 'A2 was here' to ./shared.txt. Then report exactly what happened, including any error or block message verbatim.",
);
console.log(a2.out.slice(-2_000));
const b2 = await b2Promise;
console.log(b2.out.slice(-1_500));
const reserver = /Reserved by: (\w+)/.exec(a2.out)?.[1];
check(
  "3. A's edit to a file reserved by B is blocked, naming B",
  Boolean(reserver && b2.out.includes(reserver)),
  `reserver named in block: ${reserver ?? "(none)"}; B2 output mentions it: ${reserver ? b2.out.includes(reserver) : false}`,
);

const registryNames = async (): Promise<Set<string>> => {
  const names = new Set<string>();
  const glob = new Bun.Glob("*.json");
  for await (const file of glob.scan(registryDir)) {
    try {
      const parsed = JSON.parse(await Bun.file(`${registryDir}/${file}`).text()) as {
        name?: string;
      };
      if (parsed.name) names.add(parsed.name);
    } catch {}
  }
  return names;
};

console.log("== running agent A3 (spawns a subagent) ==");
const beforeA3 = await registryNames();
let a3Done = false;
const a3Promise = runOmp(
  dirA,
  "Spawn exactly one scout subagent (task tool) to list the files in this directory, and wait for it to finish. " +
    "Then call pi_messenger action 'list' and print the full output verbatim.",
).then((r) => {
  a3Done = true;
  return r;
});
const seenDuringA3 = new Set<string>();
while (!a3Done) {
  for (const n of await registryNames()) seenDuringA3.add(n);
  if (!a3Done) await Bun.sleep(2_000);
}
const a3 = await a3Promise;
console.log(a3.out.slice(-2_500));
const a3Name = ownName(a3.out);
const newAgents = [...seenDuringA3].filter((n) => !beforeA3.has(n) && n !== a3Name);
check(
  "5. Subagents stay off the mesh (no new registry entries during A3)",
  Boolean(a3Name) && newAgents.length === 0,
  `A3=${a3Name}; new agents registered during A3: ${newAgents.join(", ") || "none"}`,
);

const failed = verdicts.filter(([, ok]) => !ok);
console.log(
  `\n== smoke done: ${verdicts.length - failed.length}/${verdicts.length} checks passed ==`,
);
process.exit(failed.length > 0 ? 1 : 0);
