# Provenance

omp-agent-mesh bans comments in code (see AGENTS.md). Credit for borrowed code lives here instead.

| Code | Origin | Notes |
| --- | --- | --- |
| `oxlint.config.ts`, `oxfmt.config.ts`, the Effect diagnostics map in `tsconfig.json`, `scripts/vcs-command-policy.ts` | [rat-stack](https://github.com/joelhooks/rat-stack) `oxlint.config.ts`, `oxfmt.config.ts`, `tsconfig.base.json`, `scripts/vcs-command-policy.js` (MIT) | Trimmed to the rules that apply to a single-package Bun repo. The policy is ported to TypeScript; prek replaces lefthook. |
| `scripts/oxlint-plugin-no-comments.ts`, `scripts/oxlint-plugin-patterns.ts` (`acquire-release-constructs-in-acquire-body`, `no-module-level-mutable-state` only) | rat-stack `scripts/` (MIT) | Copied; unused rules removed. |
| `scripts/oxlint-plugin-effect-tests.ts` | [t3code](https://github.com/pingdotgg/t3code) `oxlint-plugin-t3code/rules/no-manual-effect-runtime-in-tests.ts`, via rat-stack | Adapted. |
| `scripts/oxlint-plugin-xstate-effect.ts` | [statelyai/xstate](https://github.com/statelyai/xstate) `scripts/oxlint-plugin-xstate-effect.mjs` at `xstate@6.0.0-alpha.58` (commit `0748e1b`), MIT, via rat-stack | Ported onto the typed `@oxlint/plugins` API with the same behavior. |
| `tools/oxlint/anti-slop/` | [dmmulroy/anti-slop](https://github.com/dmmulroy/anti-slop) at `c44ef22`, MIT, via rat-stack | Vendored and owned; see `UPSTREAM.md` there. Its files keep upstream's comments. |
