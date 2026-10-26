// @effect-diagnostics nodeBuiltinImport:off -- Joins mesh directory paths with the host's native path module.
import path from "node:path";

import {
  Context,
  Effect,
  FileSystem,
  Layer,
  Option,
  Ref,
  Schema,
  Stream,
} from "effect";

import { MeshMessageSchema } from "../domain/message.ts";
import type { MeshMessage } from "../domain/message.ts";
import { meshIo } from "./io.ts";
import { MeshConfig } from "./mesh-config.ts";

export interface InboxRead {
  readonly messages: readonly MeshMessage[];
  readonly offset: number;
}

const decodeMessage = Schema.decodeUnknownEffect(
  Schema.fromJsonString(MeshMessageSchema)
);

const encodeMessage = Schema.encodeEffect(
  Schema.fromJsonString(MeshMessageSchema)
);

const NEWLINE = 10;

const POLL = "5 seconds";

export class Inbox extends Context.Service<Inbox>()(
  "omp-agent-mesh/services/Inbox",
  {
    make: Effect.gen(function* make() {
      const fs = yield* FileSystem.FileSystem;
      const { meshDir } = yield* MeshConfig;
      const inboxDir = path.join(meshDir, "inbox");

      const inboxPath = (sessionId: string) =>
        path.join(inboxDir, `${sessionId}.jsonl`);

      const ensureDir = fs
        .makeDirectory(inboxDir, { recursive: true })
        .pipe(meshIo("ensureDir", inboxDir));

      const append = Effect.fnUntraced(
        function* appendMessage(toSessionId: string, message: MeshMessage) {
          const text = yield* encodeMessage(message);
          yield* fs.writeFileString(inboxPath(toSessionId), `${text}\n`, {
            flag: "a",
          });
        },
        (effect, toSessionId) =>
          meshIo("appendInbox", inboxPath(toSessionId))(effect)
      );

      const size = (sessionId: string) =>
        Effect.gen(function* readSize() {
          if (!(yield* fs.exists(inboxPath(sessionId)))) {
            return 0;
          }

          return Number((yield* fs.stat(inboxPath(sessionId))).size);
        }).pipe(meshIo("inboxSize", inboxPath(sessionId)));

      const read = (sessionId: string, offset: number) =>
        Effect.gen(function* readFrom() {
          const file = inboxPath(sessionId);

          if (!(yield* fs.exists(file))) {
            return { messages: [], offset: 0 } satisfies InboxRead;
          }

          const bytes = yield* fs.readFile(file);
          const from = bytes.length < offset ? 0 : offset;
          const chunk = bytes.subarray(from);
          const complete = chunk.lastIndexOf(NEWLINE) + 1;

          if (complete === 0) {
            return { messages: [], offset: from } satisfies InboxRead;
          }

          const lines = new TextDecoder()
            .decode(chunk.subarray(0, complete))
            .split("\n");

          const decoded = yield* Effect.forEach(
            lines.filter((line) => line.trim() !== ""),
            (line) =>
              decodeMessage(line).pipe(
                Effect.tapError(() =>
                  Effect.logWarning(`skipping unreadable inbox line in ${file}`)
                ),
                Effect.option
              )
          );

          return {
            messages: decoded.flatMap((m) =>
              Option.isSome(m) ? [m.value] : []
            ),
            offset: from + complete,
          } satisfies InboxRead;
        }).pipe(meshIo("readInbox", inboxPath(sessionId)));

      const triggers = Stream.merge(
        fs.watch(inboxDir).pipe(
          Stream.as("changed"),
          Stream.catchCause(() => Stream.empty)
        ),
        Stream.tick(POLL)
      );

      const messages = (sessionId: string, from: number) =>
        Stream.fromEffect(Ref.make(from)).pipe(
          Stream.flatMap((offset) =>
            triggers.pipe(
              Stream.mapEffect(() =>
                Effect.gen(function* pollMessages() {
                  const inbox = yield* read(sessionId, yield* Ref.get(offset));
                  yield* Ref.set(offset, inbox.offset);

                  return inbox.messages;
                }).pipe(
                  Effect.catchTag("MeshIoError", (failure) =>
                    Effect.logWarning(
                      `inbox poll failed: ${failure.message}`
                    ).pipe(Effect.as<readonly MeshMessage[]>([]))
                  )
                )
              ),
              Stream.flattenIterable
            )
          )
        );

      return { append, ensureDir, messages, read, size };
    }),
  }
) {
  static readonly layer = Layer.effect(this, this.make);
}
