import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BunFileSystem } from "@effect/platform-bun";
import { Effect, Layer } from "effect";
import { Registry } from "../src/registry.ts";

const layer = Registry.layer.pipe(Layer.provide(BunFileSystem.layer));

const entry = (name: string, sessionId: string, pid: number) =>
  JSON.stringify({
    name,
    pid,
    sessionId,
    cwd: `/work/${name}`,
    branch: "main",
    status: "idle",
    reservations: [],
    updatedAt: Date.now(),
  });

let base: string;
let agentsDirPath: string;

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "mesh-registry-"));
  agentsDirPath = join(base, "agents");
  mkdirSync(agentsDirPath);
  process.env.OMP_AGENT_MESH_DIR = base;
});

afterEach(() => {
  delete process.env.OMP_AGENT_MESH_DIR;
  rmSync(base, { recursive: true, force: true });
});

const activePeers = (selfSessionId: string) =>
  Effect.runPromise(Registry.use((r) => r.activePeers(selfSessionId)).pipe(Effect.provide(layer)));

describe("Registry.activePeers", () => {
  test("returns live peers only: self, dead PIDs, broken files, and non-JSON files are excluded", async () => {
    writeFileSync(join(agentsDirPath, "live.json"), entry("LiveOne", "sess-live", process.pid));
    writeFileSync(join(agentsDirPath, "self.json"), entry("Self", "sess-self", 4242));
    writeFileSync(join(agentsDirPath, "dead.json"), entry("DeadOne", "sess-dead", 99_999_999));
    writeFileSync(join(agentsDirPath, "broken.json"), "{not json");
    writeFileSync(join(agentsDirPath, "notes.txt"), entry("NotJson", "sess-x", process.pid));

    const peers = await activePeers("sess-self");
    expect(peers.map((p) => p.name)).toEqual(["LiveOne"]);
  });

  test("a missing agents directory fails with RegistryReadError", async () => {
    rmSync(agentsDirPath, { recursive: true, force: true });
    const error = await Effect.runPromise(
      Registry.use((r) => r.activePeers("sess-self")).pipe(Effect.flip, Effect.provide(layer)),
    );
    expect(error._tag).toBe("RegistryReadError");
  });
});
