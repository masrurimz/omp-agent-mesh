import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BunFileSystem } from "@effect/platform-bun";
import { Effect, Layer } from "effect";
import { Registry } from "../src/registry.ts";

const layer = Registry.layer.pipe(Layer.provide(BunFileSystem.layer));

const entry = (name: string, pid: number) =>
  JSON.stringify({ name, pid, cwd: `/work/${name}`, model: "test-model", gitBranch: "main" });

let base: string;
let registryDir: string;

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "mesh-registry-"));
  registryDir = join(base, "registry");
  mkdirSync(registryDir);
  process.env.PI_MESSENGER_DIR = base;
});

afterEach(() => {
  delete process.env.PI_MESSENGER_DIR;
  rmSync(base, { recursive: true, force: true });
});

const activePeers = (selfPid: number) =>
  Effect.runPromise(Registry.use((r) => r.activePeers(selfPid)).pipe(Effect.provide(layer)));

describe("Registry.activePeers", () => {
  test("returns live peers only: self, dead PIDs, broken files, and non-JSON files are excluded", async () => {
    writeFileSync(join(registryDir, "live.json"), entry("LiveOne", process.pid));
    writeFileSync(join(registryDir, "self.json"), entry("Self", 4242));
    writeFileSync(join(registryDir, "dead.json"), entry("DeadOne", 99_999_999));
    writeFileSync(join(registryDir, "broken.json"), "{not json");
    writeFileSync(join(registryDir, "notes.txt"), entry("NotJson", process.pid));

    const peers = await activePeers(4242);
    expect(peers.map((p) => p.name)).toEqual(["LiveOne"]);
    expect(peers[0]?.cwd).toBe("/work/LiveOne");
  });

  test("a missing registry directory fails with RegistryReadError", async () => {
    rmSync(registryDir, { recursive: true, force: true });
    const error = await Effect.runPromise(
      Registry.use((r) => r.activePeers(1)).pipe(Effect.flip, Effect.provide(layer)),
    );
    expect(error._tag).toBe("RegistryReadError");
  });
});
