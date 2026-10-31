import { assert, describe, it } from "@effect/vitest";
import { AnthropicError, APIConnectionError, APIError, APIUserAbortError } from "@anthropic-ai/sdk";

import { toClaudeError } from "../src/index.ts";

/** What the SDK's SSE decoder throws for an `event: error` frame: no HTTP status. */
const streamError = (type: NonNullable<APIError["type"]>) =>
  new APIError(undefined, { type: "error", error: { type } }, undefined, new Headers(), type);

const wrapped = (message: string, cause: Error) => {
  const error = new AnthropicError(message);
  error.cause = cause;

  return error;
};

describe("toClaudeError", () => {
  it.each(["overloaded_error", "api_error", "rate_limit_error"] as const)(
    "retries a mid-stream %s",
    (type) => {
      const error = toClaudeError(streamError(type));
      assert.isTrue(error.retryable);
      assert.isNull(error.status);
    },
  );

  it("does not retry a mid-stream client error", () => {
    assert.isFalse(toClaudeError(streamError("invalid_request_error")).retryable);
  });

  it("retries dropped connections", () => {
    assert.isTrue(toClaudeError(new APIConnectionError({})).retryable);
    assert.isTrue(toClaudeError(wrapped("terminated", new TypeError("terminated"))).retryable);

    assert.isTrue(
      toClaudeError(
        new AnthropicError("stream ended without producing a Message with role=assistant"),
      ).retryable,
    );
  });

  it("classifies HTTP statuses", () => {
    const http = (status: number) =>
      toClaudeError(APIError.generate(status, undefined, undefined, new Headers()));

    assert.isTrue(http(429).retryable);
    assert.isTrue(http(529).retryable);
    assert.strictEqual(http(529).status, 529);
    assert.isFalse(http(400).retryable);
    assert.isFalse(http(401).retryable);
  });

  it("does not retry a local failure", () => {
    assert.isFalse(
      toClaudeError(new AnthropicError("Unable to parse tool parameter JSON")).retryable,
    );
    assert.isFalse(toClaudeError(new APIUserAbortError()).retryable);
    assert.isFalse(toClaudeError(new Error("nope")).retryable);
  });
});
