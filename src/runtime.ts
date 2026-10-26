import { BunFileSystem } from "@effect/platform-bun";
import { Layer, Logger, ManagedRuntime } from "effect";
import { MainRegistry } from "./main-registry.ts";
import { MeshStore, meshDir } from "./mesh-store.ts";

export type HostLog = (level: string, message: string) => void;

// The factory runs once per session but the runtime is process-wide, so the sink
// reads whichever host logger the latest factory bound.
let hostLog: HostLog = () => {};

export const bindHostLog = (log: HostLog): void => {
  hostLog = log;
};

const live = Layer.mergeAll(MeshStore.layer(meshDir()), MainRegistry.layer).pipe(
  Layer.provideMerge(BunFileSystem.layer),
  Layer.provideMerge(
    Logger.layer([Logger.make(({ logLevel, message }) => hostLog(logLevel, String(message)))]),
  ),
);

export const runtime = ManagedRuntime.make(live);

export type MeshEnv = ManagedRuntime.ManagedRuntime.Services<typeof runtime>;
