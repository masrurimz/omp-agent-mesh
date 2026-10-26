import { isAbsolute, resolve } from "node:path";
import { Effect } from "effect";
import { repoGroup } from "../domain/peers.ts";

export interface RepoInfo {
  readonly branch: string | undefined;
  readonly group: string;
}

export type GitExec = (args: ReadonlyArray<string>) => Promise<string>;

export const repoInfo = Effect.fn("repoInfo")(function* (exec: GitExec, cwd: string) {
  const git = (args: ReadonlyArray<string>) =>
    Effect.tryPromise(() => exec(args)).pipe(
      Effect.map((stdout) => stdout.trim() || undefined),
      Effect.orElseSucceed(() => undefined),
    );

  const { branch, common, topLevel } = yield* Effect.all(
    {
      branch: git(["rev-parse", "--abbrev-ref", "HEAD"]),
      common: git(["rev-parse", "--git-common-dir"]),
      topLevel: git(["rev-parse", "--show-toplevel"]),
    },
    { concurrency: 3 },
  );

  const commonAbs = common && (isAbsolute(common) ? common : resolve(cwd, common));
  return {
    branch: branch && branch !== "HEAD" ? branch : undefined,
    group: repoGroup(commonAbs, topLevel, cwd),
  } satisfies RepoInfo;
});
