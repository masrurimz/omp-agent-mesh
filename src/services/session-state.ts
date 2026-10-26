import { Clock, Context, Effect, SubscriptionRef } from "effect";
import type { Peer } from "../domain/peer.ts";
import { Presence } from "./presence.ts";

export interface State {
  readonly peer: Peer;
  readonly subs: ReadonlyMap<string, string>;
  readonly unread: number;
  readonly peerCount: number;
}

const stamp = (state: State, now: number): State => ({
  ...state,
  peer: { ...state.peer, subagents: state.subs.size, updatedAt: now },
});

export class SessionState extends Context.Service<SessionState>()(
  "omp-agent-mesh/services/SessionState",
  {
    make: Effect.fn("SessionState.make")(function* (initial: State) {
      const presence = yield* Presence;
      const ref = yield* SubscriptionRef.make(initial);

      const commit = <E>(change: (current: State) => Effect.Effect<State, E>) =>
        SubscriptionRef.updateAndGetEffect(ref, (current) =>
          Effect.gen(function* () {
            const next = stamp(yield* change(current), yield* Clock.currentTimeMillis);
            yield* presence.write(next.peer);
            return next;
          }),
        );

      const persist = (change: (current: State) => State) =>
        commit((current) => Effect.succeed(change(current)));

      const publishStatus = (status: Peer["status"], clearUnread: boolean) =>
        persist((current) => ({
          ...current,
          peer: { ...current.peer, status },
          unread: clearUnread ? 0 : current.unread,
        }));

      return { ref, commit, persist, publishStatus };
    }),
  },
) {}
