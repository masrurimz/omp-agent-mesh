import type { Reservation } from "./peer.ts";

export const claimPaths = (
  current: readonly Reservation[],
  added: readonly Reservation[]
): readonly Reservation[] => [
  ...current.filter((r) => !added.some((a) => a.pattern === r.pattern)),
  ...added,
];

export const releasePaths = (
  current: readonly Reservation[],
  paths: readonly string[] | undefined
): readonly Reservation[] =>
  paths !== undefined && paths.length > 0
    ? current.filter((r) => !paths.includes(r.pattern))
    : [];
