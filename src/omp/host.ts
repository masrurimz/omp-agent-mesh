import { Option, Schema } from "effect";

// The pinned upstream pi types predate parts of the omp host surface (ctx.agent,
// pi.logger). These schemas read them at runtime instead of casting.

export type AgentRole =
  | { readonly kind: "main" }
  | { readonly kind: "sub"; readonly label: string };

const HostContext = Schema.Struct({
  agent: Schema.optional(
    Schema.Struct({
      kind: Schema.Literals(["main", "sub"]),
      id: Schema.optional(Schema.String),
      name: Schema.optional(Schema.String),
    }),
  ),
});

const decodeContext = Schema.decodeUnknownOption(HostContext);

export const agentOf = (ctx: unknown): AgentRole => {
  const agent = Option.getOrUndefined(decodeContext(ctx))?.agent;
  if (agent?.kind !== "sub") return { kind: "main" };
  return { kind: "sub", label: agent.id || agent.name || "sub" };
};

export interface HostLogger {
  readonly warn: (message: string) => void;
}

const isHostLogger = (u: unknown): u is HostLogger =>
  typeof u === "object" && u !== null && "warn" in u && typeof u.warn === "function";

const decodeHost = Schema.decodeUnknownOption(
  Schema.Struct({ logger: Schema.optional(Schema.declare(isHostLogger)) }),
);

export const hostLogger = (pi: unknown): HostLogger | undefined =>
  Option.getOrUndefined(decodeHost(pi))?.logger;
