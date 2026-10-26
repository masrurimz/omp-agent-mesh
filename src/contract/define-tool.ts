import { Effect, Schema } from "effect";
import { InvalidInput } from "../domain/errors.ts";

export interface MeshToolContract<I, O, F extends { readonly message: string }> {
  readonly name: string;
  readonly label: string;
  readonly description: string;
  readonly input: Schema.Decoder<I>;
  readonly failure: Schema.Schema<F>;
  readonly render: (output: O) => string;
}

export interface ToolParameters {
  readonly type: "object";
  readonly properties: Readonly<Record<string, unknown>>;
  readonly required: ReadonlyArray<string>;
}

const JsonObject = Schema.Struct({
  properties: Schema.Record(Schema.String, Schema.Unknown),
  required: Schema.optionalKey(Schema.Array(Schema.String)),
});
const InputDocument = Schema.Struct({ anyOf: Schema.Array(JsonObject) });
const EnumOnly = Schema.Struct({
  type: Schema.Literal("string"),
  enum: Schema.Array(Schema.String),
});

const decodeDocument = Schema.decodeUnknownSync(InputDocument);
const decodeEnumOnly = Schema.decodeUnknownOption(EnumOnly);

const sameJson = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

const unify = (variants: ReadonlyArray<unknown>): unknown => {
  const distinct = variants.filter((v, i) => variants.findIndex((w) => sameJson(v, w)) === i);
  const [only, second] = distinct;
  if (!second) return only;
  const enums = distinct.flatMap((v) => {
    const parsed = decodeEnumOnly(v);
    return parsed._tag === "Some" ? [parsed.value.enum] : [];
  });
  if (enums.length === distinct.length) return { type: "string", enum: enums.flat() };
  return { anyOf: distinct };
};

// The wire schema must be one object: providers reject a top-level anyOf. Each variant
// of the input union contributes its properties; a key is required only when every
// variant requires it. Per-action strictness is enforced when the input is decoded.
export const toToolParameters = (input: Schema.Constraint): ToolParameters => {
  const { anyOf } = decodeDocument(Schema.toJsonSchemaDocument(input).schema);
  const variants = new Map<string, Array<unknown>>();
  for (const member of anyOf) {
    for (const [key, schema] of Object.entries(member.properties)) {
      variants.set(key, [...(variants.get(key) ?? []), schema]);
    }
  }
  const required = [...variants.keys()].filter((key) =>
    anyOf.every((member) => member.required?.includes(key)),
  );
  return {
    type: "object",
    properties: Object.fromEntries([...variants].map(([key, schemas]) => [key, unify(schemas)])),
    required,
  };
};

export const defineMeshTool = <I, O, F extends { readonly message: string }, C, R>(
  contract: MeshToolContract<I, O, F>,
  handler: (input: I, call: C) => Effect.Effect<O, F, R>,
) => {
  const decode = Schema.decodeUnknownEffect(contract.input);
  const isContractFailure = Schema.is(contract.failure);

  return {
    name: contract.name,
    label: contract.label,
    description: contract.description,
    parameters: toToolParameters(contract.input),
    run: (raw: unknown, call: C): Effect.Effect<string, never, R> =>
      decode(raw).pipe(
        Effect.mapError((error) => new InvalidInput({ detail: error.message })),
        Effect.flatMap((input) => handler(input, call)),
        Effect.map(contract.render),
        Effect.catch((error) =>
          isContractFailure(error) || error instanceof InvalidInput
            ? Effect.succeed(error.message)
            : Effect.die(error),
        ),
      ),
  };
};
