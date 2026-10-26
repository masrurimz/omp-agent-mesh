import { Effect, FileSystem, Schema } from "effect";

const MeshConfig = Schema.Struct({ roots: Schema.Array(Schema.String) });
const decodeConfig = Schema.decodeUnknownEffect(Schema.fromJsonString(MeshConfig));

const DEFAULT_ROOTS: ReadonlyArray<string> = ["~/work/*"];

export const loadRoots = (home: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const text = yield* fs.readFileString(`${home}/.omp/agent/mesh.json`);
    return (yield* decodeConfig(text)).roots;
  }).pipe(Effect.orElseSucceed(() => DEFAULT_ROOTS));

export const underRoots = (cwd: string, roots: ReadonlyArray<string>, home: string): boolean =>
  roots.some((pattern) => {
    const expanded = pattern.replace(/^~\//, `${home}/`).replace(/\/+$/, "");
    if (expanded.endsWith("/*")) {
      const base = expanded.slice(0, -2);
      return cwd === base || cwd.startsWith(`${base}/`);
    }
    if (expanded.endsWith("*")) return cwd.startsWith(expanded.slice(0, -1));
    return cwd === expanded;
  });
