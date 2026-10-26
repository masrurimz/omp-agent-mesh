import { Result, Schema } from "effect";
import { InvalidTransition } from "../domain/errors.ts";

export const Lifecycle = Schema.TaggedUnion({ Joining: {}, Idle: {}, Working: {}, Left: {} });
export type Lifecycle = typeof Lifecycle.Type;

export const LifecycleEvent = Schema.TaggedUnion({
  Joined: {},
  AgentStarted: {},
  AgentEnded: {},
  Departed: {},
});

export const events = {
  joined: LifecycleEvent.cases.Joined.make({}),
  agentStarted: LifecycleEvent.cases.AgentStarted.make({}),
  agentEnded: LifecycleEvent.cases.AgentEnded.make({}),
  departed: LifecycleEvent.cases.Departed.make({}),
} satisfies Record<string, LifecycleEvent>;
export type LifecycleEvent = typeof LifecycleEvent.Type;

const states = {
  Joining: Lifecycle.cases.Joining.make({}),
  Idle: Lifecycle.cases.Idle.make({}),
  Working: Lifecycle.cases.Working.make({}),
  Left: Lifecycle.cases.Left.make({}),
} satisfies Record<Lifecycle["_tag"], Lifecycle>;

export const joining: Lifecycle = states.Joining;

const next: Record<
  Lifecycle["_tag"],
  Partial<Record<LifecycleEvent["_tag"], Lifecycle["_tag"]>>
> = {
  Joining: { Joined: "Idle", Departed: "Left" },
  Idle: { AgentStarted: "Working", AgentEnded: "Idle", Departed: "Left" },
  Working: { AgentStarted: "Working", AgentEnded: "Idle", Departed: "Left" },
  Left: {},
};

export const transition = (
  state: Lifecycle,
  event: LifecycleEvent,
): Result.Result<Lifecycle, InvalidTransition> => {
  const target = next[state._tag][event._tag];
  return target
    ? Result.succeed(states[target])
    : Result.fail(new InvalidTransition({ from: state._tag, event: event._tag }));
};
