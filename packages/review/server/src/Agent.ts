import {
  Claude,
  type ClaudeError,
  type ContentBlockParam,
  type MessageParam,
  type Tool,
  type ToolResult,
} from "@nitpick/anthropic";
import type { Json } from "@nitpick/review-domain";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";
import * as Result from "effect/Result";
import * as S from "effect/Schema";

/** The run ended without a result. The tokens it spent until then still count toward the review. */
export class AgentError extends Data.TaggedError("AgentError")<{
  readonly reason: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
}> {}

/** A read-only tool. Handlers close over one repository, so the model cannot pick another. */
export interface AgentTool {
  readonly definition: Tool;
  readonly run: (input: Json) => Effect.Effect<string, Error>;
}

export interface AgentRun<A> {
  readonly system: string;
  readonly prompt: string;
  readonly tools: ReadonlyArray<AgentTool>;
  /** The tool whose valid input is the result and ends the run. */
  readonly finish: {
    readonly definition: Tool;
    readonly decode: (input: Json) => Effect.Effect<A, Error>;
  };
  readonly maxTurns: number;
}

export interface AgentResult<A> {
  readonly value: A;
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export const objectSchema = (
  properties: { readonly [key: string]: Json },
  required: ReadonlyArray<string>,
): Tool["input_schema"] => ({
  type: "object",
  properties,
  required: [...required],
  additionalProperties: false,
});

/** Postgres text cannot hold NUL, and a query carrying one fails as a defect, not a tool error. */
const stripNul = (input: Json): Json => {
  if (Predicate.isString(input)) return input.replaceAll("\u0000", "");

  if (Array.isArray(input)) return input.map(stripNul);

  return Predicate.isObject(input)
    ? Object.fromEntries(Object.entries(input).map(([key, value]) => [key, stripNul(value)]))
    : input;
};

/** Tool inputs stream as generated, so they are unchecked until decoded here. */
export const decoder = <A, I>(schema: S.Codec<A, I>) => {
  // SAFETY: these schemas are plain structs, which need no decoding services.
  const decode = S.decodeUnknownEffect(schema as S.Codec<A, unknown>);

  return (input: Json): Effect.Effect<A, Error> =>
    decode(stripNul(input)).pipe(
      Effect.mapError((issue) => new Error(`Invalid input: ${String(issue)}`)),
    );
};

const inputOf = (call: { readonly input: unknown }): Json =>
  // SAFETY: the SDK parsed this from the API's JSON; a schema decodes it before use.
  call.input as Json;

const toolError = (id: string, message: string): ToolResult => ({
  type: "tool_result",
  tool_use_id: id,
  content: message,
  is_error: true,
});

/**
 * The agent loop. Response content goes back unchanged, thinking blocks
 * included, since editing history invalidates them. All results of a turn
 * return in one user message. The last turns carry a reminder to finish, as
 * this model rejects a forced `tool_choice`.
 */
// SAFETY: Effect.fn loses the generic; the assertion restates its inferred signature.
export const runAgent = Effect.fn("review.agent.run")(function* <A>(run: AgentRun<A>) {
  const claude = yield* Claude;
  const tools = new Map(run.tools.map((tool) => [tool.definition.name, tool]));
  const definitions = [...run.tools.map((tool) => tool.definition), run.finish.definition];
  const finishName = run.finish.definition.name;
  const messages: Array<MessageParam> = [{ role: "user", content: run.prompt }];
  let inputTokens = 0;
  let outputTokens = 0;

  for (let turn = 1; turn <= run.maxTurns; turn += 1) {
    const response = yield* claude.turn({ system: run.system, tools: definitions, messages });
    inputTokens +=
      response.usage.input_tokens +
      (response.usage.cache_read_input_tokens ?? 0) +
      (response.usage.cache_creation_input_tokens ?? 0);
    outputTokens += response.usage.output_tokens;

    if (response.stop_reason === "refusal") {
      return yield* new AgentError({
        reason: `refused: ${response.stop_details?.category ?? "unspecified"}`,
        inputTokens,
        outputTokens,
      });
    }

    if (response.stop_reason === "max_tokens")
      return yield* new AgentError({ reason: "hit max_tokens", inputTokens, outputTokens });

    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason === "pause_turn") continue;

    const calls = response.content.flatMap((block) => (block.type === "tool_use" ? [block] : []));

    const reminder: Array<ContentBlockParam> =
      turn >= run.maxTurns - 2
        ? [
            {
              type: "text",
              text: `Stop investigating. Call ${finishName} now with what you have confirmed.`,
            },
          ]
        : [];

    if (calls.length === 0) {
      messages.push({
        role: "user",
        content:
          reminder.length > 0
            ? reminder
            : [{ type: "text", text: `Finish by calling ${finishName}.` }],
      });
      continue;
    }

    const finishCall = calls.find((call) => call.name === finishName);

    if (finishCall !== undefined) {
      const decoded = yield* run.finish.decode(inputOf(finishCall)).pipe(Effect.result);

      if (Result.isSuccess(decoded)) return { value: decoded.success, inputTokens, outputTokens };
    }

    const results = yield* Effect.forEach(
      calls,
      (call) => {
        if (call.name === finishName) {
          return run.finish.decode(inputOf(call)).pipe(
            Effect.match({
              onFailure: (error) => toolError(call.id, error.message),
              onSuccess: () => toolError(call.id, "Not accepted."),
            }),
          );
        }

        const tool = tools.get(call.name);

        if (tool === undefined)
          return Effect.succeed(toolError(call.id, `Unknown tool ${call.name}.`));

        return tool.run(inputOf(call)).pipe(
          Effect.match({
            onFailure: (error) => toolError(call.id, error.message),
            onSuccess: (content): ToolResult => ({
              type: "tool_result",
              tool_use_id: call.id,
              content,
            }),
          }),
        );
      },
      { concurrency: 4 },
    );

    messages.push({ role: "user", content: [...results, ...reminder] });
  }

  return yield* new AgentError({
    reason: `no ${finishName} call in ${run.maxTurns} turns`,
    inputTokens,
    outputTokens,
  });
}) as <A>(run: AgentRun<A>) => Effect.Effect<AgentResult<A>, AgentError | ClaudeError, Claude>;
