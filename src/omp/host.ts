import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Option, Predicate, Schema } from "effect";

export type AgentRole =
  | { readonly kind: "main" }
  | { readonly kind: "sub"; readonly label: string };

const HostContext = Schema.Struct({
  agent: Schema.optional(
    Schema.Struct({
      id: Schema.optional(Schema.String),
      kind: Schema.Literals(["main", "sub"]),
      name: Schema.optional(Schema.String),
    })
  ),
});

const decodeContext = Schema.decodeUnknownOption(HostContext);

export const agentOf = (ctx: ExtensionContext): AgentRole => {
  const agent = Option.getOrUndefined(decodeContext(ctx))?.agent;

  if (agent?.kind !== "sub") {
    return { kind: "main" };
  }

  return { kind: "sub", label: agent.id ?? agent.name ?? "sub" };
};

export interface HostLogger {
  readonly warn: (message: string) => void;
}

const isHostLogger = (value: unknown): value is HostLogger =>
  Predicate.hasProperty(value, "warn") && Predicate.isFunction(value.warn);

const decodeHost = Schema.decodeUnknownOption(
  Schema.Struct({ logger: Schema.optional(Schema.declare(isHostLogger)) })
);

export const hostLogger = (pi: ExtensionAPI): HostLogger | undefined =>
  Option.getOrUndefined(decodeHost(pi))?.logger;
