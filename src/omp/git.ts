// @effect-diagnostics nodeBuiltinImport:off asyncFunction:off -- Resolves git's possibly relative common dir with the host's native path module, and the injected git exec is a native Promise boundary.
import path from "node:path";

import { Effect, Option } from "effect";

import { repoGroup } from "../domain/peers.ts";
import { hasText } from "../domain/text.ts";

export interface RepoInfo {
  readonly branch: string | undefined;
  readonly group: string;
}

export type GitExec = (args: readonly string[]) => Promise<string>;

export const repoInfo = Effect.fn("repoInfo")(function* repoInfo(
  exec: GitExec,
  cwd: string
) {
  const git = (args: readonly string[]) =>
    Effect.tryPromise(async () => await exec(args)).pipe(
      Effect.map((stdout) => stdout.trim()),
      Effect.option,
      Effect.map((output) =>
        output.pipe(Option.filter(hasText), Option.getOrUndefined)
      )
    );

  const { branch, common, topLevel } = yield* Effect.all(
    {
      branch: git(["rev-parse", "--abbrev-ref", "HEAD"]),
      common: git(["rev-parse", "--git-common-dir"]),
      topLevel: git(["rev-parse", "--show-toplevel"]),
    },
    { concurrency: 3 }
  );

  const commonAbs =
    common !== undefined && common !== ""
      ? path.resolve(cwd, common)
      : undefined;

  return {
    branch: branch !== undefined && branch !== "HEAD" ? branch : undefined,
    group: repoGroup(commonAbs, topLevel, cwd),
  } satisfies RepoInfo;
});
