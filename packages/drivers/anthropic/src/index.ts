import Anthropic, { APIConnectionError, APIError, RateLimitError } from "@anthropic-ai/sdk";
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

const toError = (cause: unknown): ClaudeError => {
  if (cause instanceof RateLimitError)
    return new ClaudeError({ status: 429, retryable: true, cause });

  if (cause instanceof APIConnectionError)
    return new ClaudeError({ status: null, retryable: true, cause });

  if (cause instanceof APIError) {
    const status = cause.status ?? null;

    return new ClaudeError({ status, retryable: status !== null && status >= 500, cause });
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
            catch: toError,
          }).pipe(Effect.withSpan("claude.turn")),
      };
    }),
  );
}
