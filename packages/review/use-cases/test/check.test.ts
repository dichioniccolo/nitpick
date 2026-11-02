import { assert, describe, it } from "@effect/vitest";
import { RepoConfig, resolveConfig } from "@nitpick/review-domain";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as S from "effect/Schema";

import {
  carriedCheckOutput,
  checkConclusion,
  completedCheckOutput,
  skippedCheckOutput,
  truncateSummary,
} from "../src/index.ts";

const of = (...severities: ReadonlyArray<"critical" | "major" | "minor">) =>
  severities.map((severity) => ({ severity }));

describe("checkConclusion", () => {
  it("fails at or above failOn and passes below it", () => {
    assert.strictEqual(checkConclusion(of("major", "minor"), "critical"), "success");
    assert.strictEqual(checkConclusion(of("critical"), "critical"), "failure");
    assert.strictEqual(checkConclusion(of("major"), "major"), "failure");
    assert.strictEqual(checkConclusion(of("critical"), "major"), "failure");
    assert.strictEqual(checkConclusion(of("minor"), "major"), "success");
    assert.strictEqual(checkConclusion(of("minor"), "minor"), "failure");
    assert.strictEqual(checkConclusion([], "minor"), "success");
  });

  it("never fails with failOn never", () => {
    assert.strictEqual(checkConclusion(of("critical", "critical"), "never"), "success");
  });
});

describe("check output", () => {
  it("counts findings in the title and sanitizes the summary", () => {
    const output = completedCheckOutput({
      summary: "cc @octocat",
      confidence: 9,
      findings: of("critical", "minor", "minor"),
      failOn: "major",
      reviewUrl: "https://nitpick.test/app/reviews/1",
    });

    assert.strictEqual(output.title, "1 critical, 2 minor");
    assert.include(output.summary, "@​octocat");
    assert.include(output.summary, "5/5");
    assert.include(output.summary, "major findings or worse");
    assert.include(output.summary, "(https://nitpick.test/app/reviews/1)");
  });

  it("reads clean when nothing was found", () => {
    const output = completedCheckOutput({
      summary: "ok",
      confidence: 5,
      findings: [],
      failOn: "never",
      reviewUrl: "u",
    });

    assert.strictEqual(output.title, "No issues found");
    assert.include(output.summary, "reports only");
  });

  it("truncates under GitHub's limit and leaves short text alone", () => {
    assert.strictEqual(truncateSummary("short"), "short");
    const cut = truncateSummary("x".repeat(70_000));
    assert.isAtMost(cut.length, 65_535);
    assert.isTrue(cut.endsWith("truncated."));
  });

  it("names the reason and the carried commit", () => {
    assert.include(skippedCheckOutput("label @x").summary, "label @​x");
    assert.strictEqual(
      carriedCheckOutput("abcdef1234", "failure").title,
      "Carried from abcdef1: failure",
    );
  });
});

describe("checks config", () => {
  it.effect("defaults on at critical and merges a partial block by key", () =>
    Effect.gen(function* () {
      const decode = S.decodeUnknownEffect(S.fromJsonString(RepoConfig));
      assert.deepStrictEqual(resolveConfig(yield* decode("{}")).checks, {
        enabled: true,
        failOn: "critical",
      });
      assert.deepStrictEqual(resolveConfig(yield* decode('{"checks":{"failOn":"major"}}')).checks, {
        enabled: true,
        failOn: "major",
      });
      const bad = yield* Effect.exit(decode('{"checks":{"failOn":"blocker"}}'));
      assert.isTrue(Exit.isFailure(bad));
    }),
  );
});
