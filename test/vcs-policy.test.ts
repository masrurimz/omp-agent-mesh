import { assert, describe, it } from "@effect/vitest";

import {
  applyCommandPolicy,
  HOOK_BYPASS_REASON,
  NONINTERACTIVE_VCS_ENV,
} from "../scripts/vcs-command-policy.ts";

describe("vcs command policy", () => {
  it("blocks hook bypass on git commands, however they are chained", () => {
    for (const command of [
      "git commit --no-verify -m x",
      "git push --no-verify",
      "cd repo && git commit -m x --no-verify",
      "/usr/bin/git commit --no-verify",
    ]) {
      assert.deepStrictEqual(applyCommandPolicy(command), {
        action: "block",
        reason: HOOK_BYPASS_REASON,
      });
    }
  });

  it("makes allowed git and jj commands non-interactive", () => {
    assert.deepStrictEqual(applyCommandPolicy("git rebase -i HEAD~2"), {
      action: "allow",
      command: `${NONINTERACTIVE_VCS_ENV}git rebase -i HEAD~2`,
    });
    assert.strictEqual(applyCommandPolicy("jj describe").action, "allow");
  });

  it("leaves unrelated commands alone, including the flag outside git", () => {
    assert.deepStrictEqual(applyCommandPolicy("ls --no-verify"), {
      action: "allow",
      command: "ls --no-verify",
    });
    assert.deepStrictEqual(applyCommandPolicy("bun run test"), {
      action: "allow",
      command: "bun run test",
    });
  });
});
