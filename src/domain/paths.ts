// @effect-diagnostics nodeBuiltinImport:off -- Pure path arithmetic on host filesystem paths; Effect's Path service would push a requirement into plain domain functions.
import path from "node:path";

import { Schema } from "effect";

export const folderName = (cwd: string): string => {
  const name = path.basename(cwd);

  return name === "" ? cwd : name;
};

const SCHEME_URI = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//u;

export const absolutize = (cwd: string, pattern: string): string => {
  if (path.isAbsolute(pattern) || SCHEME_URI.test(pattern)) {
    return pattern;
  }

  const abs = path.resolve(cwd, pattern);

  return pattern.endsWith("/") ? `${abs}/` : abs;
};

export const matchesReservation = (
  filePath: string,
  pattern: string
): boolean => {
  if (pattern.endsWith("/")) {
    return filePath.startsWith(pattern);
  }

  return filePath === pattern;
};

export const displayPath = (cwd: string, filePath: string): string => {
  if (!path.isAbsolute(filePath)) {
    return filePath;
  }

  const rel = path.relative(cwd, filePath);

  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel)
    ? rel
    : filePath;
};

const HASHLINE_HEADER = /^\[(?<path>.+?)#[0-9A-Za-z]{4}\]\s*$/gmu;

const PATCH_HEADER = /^\*\*\* (?:Add|Update|Delete) File: (?<path>.+?)\s*$/gmu;

export const EditInputSchema = Schema.Struct({
  input: Schema.optional(Schema.String),
  path: Schema.optional(Schema.String),
});

export type EditInput = typeof EditInputSchema.Type;

export const decodeEditInput = Schema.decodeUnknownOption(EditInputSchema);

export const editedPaths = (input: EditInput): readonly string[] => {
  const found: string[] = [];

  if (input.path !== undefined && input.path !== "") {
    found.push(input.path);
  }

  if (input.input !== undefined) {
    for (const header of [HASHLINE_HEADER, PATCH_HEADER]) {
      for (const match of input.input.matchAll(header)) {
        const headerPath = match.groups?.path;

        if (headerPath !== undefined && headerPath !== "") {
          found.push(headerPath);
        }
      }
    }
  }

  return [...new Set(found)];
};
