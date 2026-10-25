import { isAbsolute, resolve } from "node:path";

// A scheme URI (xd://pi_messenger, skill://name) addresses a tool, not a file on disk.
// Resolving one against cwd invents a path that matches no real file or reservation.
const SCHEME_URI = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//;

export const absolutize = (cwd: string, pattern: string): string => {
  if (isAbsolute(pattern) || SCHEME_URI.test(pattern)) return pattern;
  const abs = resolve(cwd, pattern);
  return pattern.endsWith("/") ? `${abs}/` : abs;
};

export const matchesReservation = (filePath: string, pattern: string): boolean => {
  if (pattern.endsWith("/")) return filePath.startsWith(pattern);
  return filePath === pattern;
};
