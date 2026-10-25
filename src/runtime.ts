import { BunFileSystem } from "@effect/platform-bun";
import { Layer, Logger, ManagedRuntime } from "effect";
import { Registry } from "./registry.ts";

export interface HostLogEntry {
  readonly logLevel: string;
  readonly message: unknown;
}

export const makeRuntime = (hostLog: (entry: HostLogEntry) => void) =>
  ManagedRuntime.make(
    Layer.merge(
      Registry.layer.pipe(Layer.provide(BunFileSystem.layer)),
      Logger.layer([Logger.make(({ logLevel, message }) => hostLog({ logLevel, message }))]),
    ),
  );
