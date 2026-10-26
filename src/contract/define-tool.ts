import { Array as Arr, Effect, Option, Schema } from "effect";

import { InvalidInput } from "../domain/invalid-input.ts";

export interface MeshToolContract<
  I,
  O,
  F extends { readonly message: string },
> {
  readonly name: string;
  readonly label: string;
  readonly description: string;
  readonly input: Schema.Decoder<I>;
  readonly failure: Schema.Schema<F>;
  readonly render: (output: O) => string;
}

export interface ToolParameters {
  readonly type: "object";
  readonly properties: Schema.JsonObject;
  readonly required: readonly string[];
}

const ObjectNode = Schema.Struct({
  properties: Schema.JsonObject,
  required: Schema.optionalKey(Schema.Array(Schema.String)),
});

const InputDocument = Schema.Struct({ anyOf: Schema.Array(ObjectNode) });

const EnumOnly = Schema.Struct({
  enum: Schema.Array(Schema.String),
  type: Schema.Literal("string"),
});

const decodeDocument = Schema.decodeUnknownSync(InputDocument);

const decodeEnumOnly = Schema.decodeUnknownOption(EnumOnly);

const sameJson = (a: Schema.Json, b: Schema.Json): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

const unify = (
  variants: Arr.NonEmptyReadonlyArray<Schema.Json>
): Schema.Json => {
  const distinct = Arr.dedupeWith(variants, sameJson);
  const [only] = distinct;

  if (distinct.length === 1) {
    return only;
  }

  const enums = distinct.flatMap((variant) => {
    const parsed = decodeEnumOnly(variant);

    return Option.isSome(parsed) ? [parsed.value.enum] : [];
  });

  if (enums.length === distinct.length) {
    return { enum: enums.flat(), type: "string" };
  }

  return { anyOf: distinct };
};

export const toToolParameters = (input: Schema.Constraint): ToolParameters => {
  const { anyOf } = decodeDocument(Schema.toJsonSchemaDocument(input).schema);
  const variants = new Map<string, Arr.NonEmptyReadonlyArray<Schema.Json>>();

  for (const member of anyOf) {
    for (const [key, schema] of Object.entries(member.properties)) {
      const seen = variants.get(key);
      variants.set(key, seen === undefined ? [schema] : [...seen, schema]);
    }
  }

  const required = [...variants.keys()].filter((key) =>
    anyOf.every((member) => member.required?.includes(key) === true)
  );

  return {
    properties: Object.fromEntries(
      [...variants].map(([key, schemas]) => [key, unify(schemas)])
    ),
    required,
    type: "object",
  };
};

export const defineMeshTool = <
  I,
  O,
  F extends { readonly message: string },
  C,
  R,
>(
  contract: MeshToolContract<I, O, F>,
  handler: (input: I, call: C) => Effect.Effect<O, F, R>
) => {
  const decode = Schema.decodeUnknownEffect(contract.input);
  const isContractFailure = Schema.is(contract.failure);
  const isInvalidInput = Schema.is(InvalidInput);

  return {
    description: contract.description,
    label: contract.label,
    name: contract.name,
    parameters: toToolParameters(contract.input),
    run: (raw: Schema.Json, call: C): Effect.Effect<string, never, R> =>
      decode(raw).pipe(
        Effect.mapError((issue) => new InvalidInput({ detail: issue.message })),
        Effect.flatMap((input) => handler(input, call)),
        Effect.map(contract.render),
        Effect.matchEffect({
          onFailure: (failure) =>
            isContractFailure(failure) || isInvalidInput(failure)
              ? Effect.succeed(failure.message)
              : Effect.die(failure),
          onSuccess: Effect.succeed,
        })
      ),
  };
};
