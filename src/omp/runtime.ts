import { BunFileSystem } from "@effect/platform-bun";
import { Layer, Logger, ManagedRuntime } from "effect";
import { MeshServices } from "../services/live.ts";
import { MeshConfig } from "../services/mesh-config.ts";

const live = MeshServices.pipe(
  Layer.provideMerge(MeshConfig.layer),
  Layer.provideMerge(BunFileSystem.layer),
  Layer.provideMerge(Logger.layer([])),
);

export const runtime = ManagedRuntime.make(live);

export type MeshEnv = ManagedRuntime.ManagedRuntime.Services<typeof runtime>;
