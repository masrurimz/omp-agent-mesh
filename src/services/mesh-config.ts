import { homedir } from "node:os";
import { join } from "node:path";
import { Config, ConfigProvider, Context, Effect, FileSystem, Layer, Schema } from "effect";
import { DEFAULT_ROOTS } from "../domain/roots.ts";

export interface MeshConfigValues {
  readonly home: string;
  readonly meshDir: string;
  readonly roots: ReadonlyArray<string>;
}

const RootsConfig = Config.Array(Schema.String, "roots").pipe(Config.withDefault(DEFAULT_ROOTS));
const decodeJson = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));

export class MeshConfig extends Context.Service<MeshConfig>()(
  "omp-agent-mesh/services/MeshConfig",
  {
    make: Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const home = yield* Config.String("HOME").pipe(Config.withDefault(homedir()));
      const meshDir = yield* Config.String("OMP_AGENT_MESH_DIR").pipe(
        Config.withDefault(join(home, ".omp/agent/mesh")),
      );
      const configPath = join(home, ".omp/agent/mesh.json");

      const roots = fs.readFileString(configPath).pipe(
        Effect.flatMap(decodeJson),
        Effect.map(ConfigProvider.fromUnknown),
        Effect.orElseSucceed(() => ConfigProvider.fromUnknown({})),
        Effect.flatMap((provider) => RootsConfig.parse(provider)),
        Effect.orElseSucceed(() => DEFAULT_ROOTS),
      );

      return { home, meshDir, roots };
    }).pipe(Effect.orDie),
  },
) {
  static readonly layer = Layer.effect(this, this.make);

  static readonly configLayer = (values: MeshConfigValues) =>
    Layer.succeed(this, {
      home: values.home,
      meshDir: values.meshDir,
      roots: Effect.succeed(values.roots),
    });
}
