import { isAbsolute, relative, resolve } from "node:path";

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

export const displayPath = (cwd: string, filePath: string): string => {
  if (!isAbsolute(filePath)) return filePath;
  const rel = relative(cwd, filePath);
  return rel && !rel.startsWith("..") && !isAbsolute(rel) ? rel : filePath;
};

const HASHLINE_HEADER = /^\[(.+?)#[0-9A-Za-z]{4}\]\s*$/gm;
const PATCH_HEADER = /^\*\*\* (?:Add|Update|Delete) File: (.+?)\s*$/gm;

// edit/write calls name their targets as a `path` field, or as headers inside a
// patch body (`[file#TAG]` hashline sections, `*** Update File: file` patches).
export const editedPaths = (input: unknown): ReadonlyArray<string> => {
  if (typeof input !== "object" || input === null) return [];
  const found: Array<string> = [];
  if ("path" in input && typeof input.path === "string" && input.path) found.push(input.path);
  if ("input" in input && typeof input.input === "string") {
    for (const header of [HASHLINE_HEADER, PATCH_HEADER]) {
      for (const match of input.input.matchAll(header)) {
        if (match[1]) found.push(match[1]);
      }
    }
  }
  return [...new Set(found)];
};
