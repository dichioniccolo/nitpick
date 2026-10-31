import Anthropic, {
  AnthropicError,
  APIConnectionError,
  APIError,
  APIUserAbortError,
} from "@anthropic-ai/sdk";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";

export class ClaudeError extends Data.TaggedError("ClaudeError")<{
  readonly status: number | null;
  /** Rate limits, overload and connection drops: the job queue retries these. */
  readonly retryable: boolean;
  readonly cause: unknown;
}> {}

export type Message = Anthropic.Beta.BetaMessage;

export type MessageParam = Anthropic.Beta.BetaMessageParam;

export type Tool = Anthropic.Beta.BetaTool;

export type ContentBlockParam = Anthropic.Beta.BetaContentBlockParam;

export type ToolResult = Anthropic.Beta.BetaToolResultBlockParam;

export interface TurnRequest {
  readonly system: string;
  readonly tools: ReadonlyArray<Tool>;
  readonly messages: ReadonlyArray<MessageParam>;
}

/** `error.type` values worth another attempt, as carried by an HTTP body or a mid-stream SSE `error` event. */
const retryableTypes: ReadonlySet<string> = new Set([
  "overloaded_error",
  "api_error",
  "rate_limit_error",
  "timeout_error",
]);

/** What `BetaMessageStream` throws when the connection dies before `message_stop`. */
const truncated = /^(stream ended without|request ended without)/;

/**
 * Classify anything `finalMessage()` rejects with. The stream's own errors have
 * no HTTP status: an SSE `error` event is an `APIError` with `status` undefined
 * and the kind in `type`, and a dropped socket is a bare `AnthropicError`
 * wrapping the transport error in `cause`.
 */
export const toClaudeError = (cause: unknown): ClaudeError => {
  if (cause instanceof APIUserAbortError)
    return new ClaudeError({ status: null, retryable: false, cause });

  if (cause instanceof APIConnectionError)
    return new ClaudeError({ status: null, retryable: true, cause });

  if (cause instanceof APIError) {
    const status = cause.status ?? null;

    const retryable =
      (status !== null && (status === 429 || status >= 500)) ||
      (cause.type !== null && retryableTypes.has(cause.type));

    return new ClaudeError({ status, retryable, cause });
  }

  if (cause instanceof AnthropicError) {
    const retryable = cause.cause instanceof Error || truncated.test(cause.message);

    return new ClaudeError({ status: null, retryable, cause });
  }

  return new ClaudeError({ status: null, retryable: false, cause });
};

export class Claude extends Context.Service<
  Claude,
  {
    readonly model: string;
    readonly turn: (request: TurnRequest) => Effect.Effect<Message, ClaudeError>;
  }
>()("@nitpick/anthropic/Claude") {
  static readonly layer = Layer.effect(
    Claude,
    Effect.gen(function* () {
      const apiKey = yield* Config.Redacted("ANTHROPIC_API_KEY");

      const model = yield* Config.String("ANTHROPIC_MODEL").pipe(
        Config.withDefault("claude-opus-5-5"),
      );

      const client = new Anthropic({ apiKey: Redacted.value(apiKey) });

      return {
        model,
        turn: ({ system, tools, messages }) =>
          Effect.tryPromise({
            try: (signal) =>
              client.beta.messages
                .stream(
                  {
                    model,
                    max_tokens: 32_000,
                    betas: ["server-side-fallback-2026-07-01"],
                    fallbacks: "default",
                    thinking: { type: "adaptive" },
                    output_config: { effort: "high" },
                    cache_control: { type: "ephemeral" },
                    system,
                    tools: [...tools],
                    messages: [...messages],
                  },
                  { signal },
                )
                .finalMessage(),
            catch: toClaudeError,
          }).pipe(Effect.withSpan("claude.turn")),
      };
    }),
  );
}
