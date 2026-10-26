import { join } from "node:path";
import { Context, DateTime, Effect, FileSystem, Layer, Schema } from "effect";
import { FeedEvent, type NewFeedEvent } from "../domain/message.ts";
import { meshIo } from "./io.ts";
import { MeshConfig } from "./mesh-config.ts";

const encodeFeedEvent = Schema.encodeEffect(Schema.fromJsonString(FeedEvent));

export class Feed extends Context.Service<Feed>()("omp-agent-mesh/services/Feed", {
  make: Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const { meshDir } = yield* MeshConfig;
    const feedPath = join(meshDir, "feed.jsonl");

    const append = (event: NewFeedEvent) =>
      Effect.gen(function* () {
        const ts = DateTime.formatIso(yield* DateTime.now);
        const text = yield* encodeFeedEvent({ ts, ...event });
        yield* fs.writeFileString(feedPath, `${text}\n`, { flag: "a" });
      }).pipe(meshIo("appendFeed", feedPath));

    const read = (limit: number) =>
      Effect.gen(function* () {
        if (!(yield* fs.exists(feedPath))) return [];
        const text = yield* fs.readFileString(feedPath);
        return text.trim().split("\n").filter(Boolean).slice(-limit);
      }).pipe(meshIo("readFeed", feedPath));

    return { append, read };
  }),
}) {
  static readonly layer = Layer.effect(this, this.make);
}
