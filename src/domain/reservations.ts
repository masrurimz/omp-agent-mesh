import type { Reservation } from "./peer.ts";

export const claimPaths = (
  current: ReadonlyArray<Reservation>,
  added: ReadonlyArray<Reservation>,
): ReadonlyArray<Reservation> => [
  ...current.filter((r) => !added.some((a) => a.pattern === r.pattern)),
  ...added,
];

export const releasePaths = (
  current: ReadonlyArray<Reservation>,
  paths: ReadonlyArray<string> | undefined,
): ReadonlyArray<Reservation> =>
  paths?.length ? current.filter((r) => !paths.includes(r.pattern)) : [];
