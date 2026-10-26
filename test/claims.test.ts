import { assert, describe, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { Claims } from "../src/services/claims.ts";
import { Presence } from "../src/services/presence.ts";
import { peer, withMesh } from "./support.ts";

const Id = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 9999 }));

const claimedBy = (pattern: string) =>
  peer("holder", { name: "Holder", reservations: [{ pattern, since: 0 }] });

describe("claims", () => {
  it.effect.prop(
    "a directory claim blocks every other session under it and never its owner",
    { dir: Id, file: Id },
    ({ dir, file }) =>
      withMesh(
        Effect.gen(function* () {
          const presence = yield* Presence;
          const claims = yield* Claims;
          yield* presence.ensureDir;
          yield* presence.write(claimedBy(`/w/${dir}/`));
          const path = `/w/${dir}/sub/${file}.ts`;

          const blocked = yield* Effect.flip(claims.guard("other", path));
          assert.strictEqual(blocked._tag, "ClaimConflict");
          if (blocked._tag === "ClaimConflict") {
            assert.strictEqual(blocked.holder, "Holder");
            assert.strictEqual(blocked.path, path);
          }
          yield* claims.guard("holder", path);
          yield* claims.guard("other", `/w/${dir + 1}/sub/${file}.ts`);
        }),
      ),
  );

  it.effect.prop(
    "a file claim blocks exactly that file for others and never its owner",
    { dir: Id, file: Id },
    ({ dir, file }) =>
      withMesh(
        Effect.gen(function* () {
          const presence = yield* Presence;
          const claims = yield* Claims;
          yield* presence.ensureDir;
          const claimed = `/w/${dir}/${file}.ts`;
          yield* presence.write(claimedBy(claimed));

          const blocked = yield* Effect.flip(claims.guard("other", claimed));
          assert.strictEqual(blocked._tag, "ClaimConflict");
          yield* claims.guard("holder", claimed);
          yield* claims.guard("other", `${claimed}x`);
          yield* claims.guard("other", `/w/${dir}/${file + 1}.ts`);
        }),
      ),
  );
});
