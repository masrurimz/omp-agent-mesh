import { Schema } from "effect";

import { formatPeerList } from "../domain/brief.ts";
import { ClaimConflict } from "../domain/claim-conflict.ts";
import { EmptyBody } from "../domain/empty-body.ts";
import { InvalidInput } from "../domain/invalid-input.ts";
import { MeshIoError } from "../domain/mesh-io-error.ts";
import { NotJoined } from "../domain/not-joined.ts";
import { PeerSchema } from "../domain/peer.ts";
import { TargetAmbiguous } from "../domain/target-ambiguous.ts";
import { TargetNotFound } from "../domain/target-not-found.ts";
import type { MeshToolContract } from "./define-tool.ts";

const Body = Schema.String.annotate({
  description: "Message text (send/broadcast) or status note (note)",
});

const Paths = Schema.Array(Schema.String).annotate({
  description: "Files or directories (claim/release)",
});

const Scope = Schema.Literals(["group", "all"]);

export const MeshInputSchema = Schema.Union([
  Schema.Struct({
    action: Schema.Literal("peers"),
    all: Schema.optionalKey(
      Schema.Boolean.annotate({
        description: "peers: include other repo groups",
      })
    ),
  }),
  Schema.Struct({
    action: Schema.Literal("send"),
    body: Body,
    to: Schema.String.annotate({
      description:
        "Recipient for send: agent handle, title card, or title text",
    }),
  }),
  Schema.Struct({
    action: Schema.Literal("broadcast"),
    body: Body,
    scope: Schema.optionalKey(
      Scope.annotate({
        description: "broadcast scope: own repo group (default) or all agents",
      })
    ),
  }),
  Schema.Struct({
    action: Schema.Literal("claim"),
    paths: Paths,
    reason: Schema.optionalKey(
      Schema.String.annotate({
        description: "Why you are claiming these paths",
      })
    ),
  }),
  Schema.Struct({
    action: Schema.Literal("release"),
    paths: Schema.optionalKey(Paths),
  }),
  Schema.Struct({
    action: Schema.Literal("note"),
    body: Schema.optionalKey(Body),
  }),
  Schema.Struct({
    action: Schema.Literal("feed"),
    limit: Schema.optionalKey(
      Schema.Finite.annotate({ description: "Feed lines to return" })
    ),
  }),
  Schema.Struct({ action: Schema.Literal("leave") }),
]);

export type MeshInput = typeof MeshInputSchema.Type;

export const MeshOutputSchema = Schema.Union([
  Schema.Struct({
    action: Schema.Literal("peers"),
    all: Schema.Boolean,
    me: PeerSchema,
    peers: Schema.Array(PeerSchema),
  }),
  Schema.Struct({
    action: Schema.Literal("send"),
    crossGroup: Schema.Boolean,
    target: Schema.String,
    waitedMs: Schema.Finite,
  }),
  Schema.Struct({
    action: Schema.Literal("broadcast"),
    recipients: Schema.Int,
    scope: Scope,
    waitedMs: Schema.Finite,
  }),
  Schema.Struct({
    action: Schema.Literal("claim"),
    paths: Schema.Array(Schema.String),
  }),
  Schema.Struct({ action: Schema.Literal("release"), released: Schema.Int }),
  Schema.Struct({ action: Schema.Literal("note") }),
  Schema.Struct({
    action: Schema.Literal("feed"),
    lines: Schema.Array(Schema.String),
  }),
  Schema.Struct({ action: Schema.Literal("leave"), name: Schema.String }),
]);

export type MeshOutput = typeof MeshOutputSchema.Type;

export const MeshFailureSchema = Schema.Union([
  NotJoined,
  TargetNotFound,
  TargetAmbiguous,
  ClaimConflict,
  EmptyBody,
  InvalidInput,
  MeshIoError,
]);

export type MeshFailure = typeof MeshFailureSchema.Type;

const waited = (ms: number): string =>
  ms > 0 ? ` (throttled ${Math.ceil(ms / 1000)}s)` : "";

export const renderOutput = (output: MeshOutput): string => {
  switch (output.action) {
    case "peers": {
      return formatPeerList(output.me, output.peers, output.all);
    }

    case "send": {
      return `Message sent to ${output.target}${output.crossGroup ? " (other repo group)" : ""}.${waited(output.waitedMs)}`;
    }

    case "broadcast": {
      return `Broadcast (${output.scope}) sent to ${output.recipients} agent${output.recipients === 1 ? "" : "s"}.${waited(output.waitedMs)}`;
    }

    case "claim": {
      return `Claimed: ${output.paths.join(", ")}`;
    }

    case "release": {
      return `Released ${output.released} claim(s).`;
    }

    case "note": {
      return "Note updated.";
    }

    case "feed": {
      return output.lines.length > 0
        ? output.lines.join("\n")
        : "Feed is empty.";
    }

    case "leave": {
      return `${output.name} left the mesh.`;
    }

    default: {
      const unreachable: never = output;

      return unreachable;
    }
  }
};

export const meshContract: MeshToolContract<
  MeshInput,
  MeshOutput,
  MeshFailure
> = {
  description:
    "Coordinate with other omp sessions on this machine. Actions: peers (who is online), send (to: handle, title card, or title text; body), broadcast (body; scope group by default, all for every repo), claim (paths), release (paths optional), note (body), feed, leave.",
  failure: MeshFailureSchema,
  input: MeshInputSchema,
  label: "Mesh",
  name: "mesh",
  render: renderOutput,
};
