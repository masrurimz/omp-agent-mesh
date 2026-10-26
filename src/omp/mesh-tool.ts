import { Effect } from "effect";
import { defineMeshTool } from "../contract/define-tool.ts";
import {
  meshContract,
  type MeshFailure,
  type MeshInput,
  type MeshOutput,
} from "../contract/mesh-contract.ts";
import type { NotJoined } from "../domain/errors.ts";
import { absolutize } from "../domain/paths.ts";
import type { MeshSession } from "../services/mesh-session.ts";

export interface ToolCall {
  readonly cwd: string;
}

export interface MeshToolHost {
  readonly current: Effect.Effect<MeshSession["Service"], NotJoined>;
  readonly leave: Effect.Effect<void>;
}

const FEED_LIMIT = 20;

export const makeMeshTool = (host: MeshToolHost) =>
  defineMeshTool(
    meshContract,
    Effect.fnUntraced(function* (
      input: MeshInput,
      call: ToolCall,
    ): Effect.fn.Return<MeshOutput, MeshFailure> {
      const session = yield* host.current;
      switch (input.action) {
        case "peers":
          return {
            action: "peers",
            me: yield* session.view,
            peers: yield* session.peers,
            all: input.all ?? false,
          };
        case "send": {
          const sent = yield* session.send(input.to, input.body);
          return {
            action: "send",
            target: sent.target.name,
            crossGroup: sent.crossGroup,
            waitedMs: sent.waitedMs,
          };
        }
        case "broadcast": {
          const scope = input.scope ?? "group";
          const sent = yield* session.broadcast(input.body, scope);
          return { action: "broadcast", scope, ...sent };
        }
        case "claim": {
          const paths = input.paths.map((p) => absolutize(call.cwd, p));
          yield* session.claim(paths, input.reason);
          return { action: "claim", paths };
        }
        case "release": {
          const paths = input.paths?.map((p) => absolutize(call.cwd, p));
          return { action: "release", released: yield* session.release(paths) };
        }
        case "note":
          yield* session.note(input.body);
          return { action: "note" };
        case "feed":
          return { action: "feed", lines: yield* session.feed(input.limit ?? FEED_LIMIT) };
        case "leave":
          yield* host.leave;
          return { action: "leave", name: session.name };
      }
    }),
  );
