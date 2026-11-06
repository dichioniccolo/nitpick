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

const of = (...severities: ReadonlyArray<"P0" | "P1" | "P2">) =>
  severities.map((severity) => ({ severity }));

describe("checkConclusion", () => {
  it("fails at or above failOn and passes below it", () => {
    const at = (failOn: "P0" | "P1" | "P2") => ({ failOn, minConfidence: 5 });
    assert.strictEqual(checkConclusion(of("P1", "P2"), 5, at("P0")), "success");
    assert.strictEqual(checkConclusion(of("P0"), 5, at("P0")), "failure");
    assert.strictEqual(checkConclusion(of("P1"), 5, at("P1")), "failure");
    assert.strictEqual(checkConclusion(of("P0"), 5, at("P1")), "failure");
    assert.strictEqual(checkConclusion(of("P2"), 5, at("P1")), "success");
    assert.strictEqual(checkConclusion(of("P2"), 5, at("P2")), "failure");
    assert.strictEqual(checkConclusion([], 5, at("P2")), "success");
  });

  it("fails below minConfidence whatever the findings, and 1 turns that off", () => {
    const gate = { failOn: "P0", minConfidence: 5 } as const;
    assert.strictEqual(checkConclusion([], 4, gate), "failure");
    assert.strictEqual(checkConclusion([], 5, gate), "success");
    assert.strictEqual(checkConclusion([], 4.6, gate), "success");
    assert.strictEqual(checkConclusion([], 3, { ...gate, minConfidence: 3 }), "success");
    assert.strictEqual(checkConclusion([], 1, { failOn: "never", minConfidence: 1 }), "success");
  });

  it("never fails on findings with failOn never", () => {
    const gate = { failOn: "never", minConfidence: 5 } as const;
    assert.strictEqual(checkConclusion(of("P0", "P0"), 5, gate), "success");
  });
});

describe("check output", () => {
  it("counts findings in the title and sanitizes the summary", () => {
    const output = completedCheckOutput({
      summary: "cc @octocat",
      confidence: 9,
      findings: of("P0", "P2", "P2"),
      gate: { failOn: "P1", minConfidence: 5 },
      reviewUrl: "https://nitpick.test/app/reviews/1",
    });

    assert.strictEqual(output.title, "1 P0, 2 P2");
    assert.include(output.summary, "@​octocat");
    assert.include(output.summary, "5/5");
    assert.include(
      output.summary,
      "Fails on P1 findings or worse or a confidence score below 5/5.",
    );
    assert.include(output.summary, "(https://nitpick.test/app/reviews/1)");
  });

  it("reads clean when nothing was found", () => {
    const output = completedCheckOutput({
      summary: "ok",
      confidence: 5,
      findings: [],
      gate: { failOn: "never", minConfidence: 1 },
      reviewUrl: "u",
    });

    assert.strictEqual(output.title, "No issues found");
    assert.include(output.summary, "reports only; it never fails");
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
  it.effect("defaults on at P0 and merges a partial block by key", () =>
    Effect.gen(function* () {
      const decode = S.decodeUnknownEffect(S.fromJsonString(RepoConfig));
      assert.deepStrictEqual(resolveConfig(yield* decode("{}")).checks, {
        enabled: true,
        failOn: "P0",
        minConfidence: 5,
      });
      assert.deepStrictEqual(resolveConfig(yield* decode('{"checks":{"failOn":"P1"}}')).checks, {
        enabled: true,
        failOn: "P1",
        minConfidence: 5,
      });
      assert.strictEqual(
        resolveConfig(yield* decode('{"checks":{"minConfidence":3}}')).checks.minConfidence,
        3,
      );
      assert.strictEqual(
        resolveConfig(yield* decode('{"checks":{"failOn":"never"}}')).checks.minConfidence,
        1,
      );
      assert.strictEqual(
        resolveConfig(yield* decode('{"checks":{"failOn":"never","minConfidence":4}}')).checks
          .minConfidence,
        4,
      );
      assert.isTrue(Exit.isFailure(yield* Effect.exit(decode('{"checks":{"minConfidence":6}}'))));
      assert.isTrue(Exit.isFailure(yield* Effect.exit(decode('{"checks":{"minConfidence":4.5}}'))));
      // Files written before P0-P3 keep working.
      assert.strictEqual(
        resolveConfig(yield* decode('{"checks":{"failOn":"critical"}}')).checks.failOn,
        "P0",
      );
      assert.strictEqual(
        resolveConfig(yield* decode('{"checks":{"failOn":"major"}}')).checks.failOn,
        "P1",
      );
      assert.strictEqual(
        resolveConfig(yield* decode('{"checks":{"failOn":"minor"}}')).checks.failOn,
        "P2",
      );
      assert.isFalse(resolveConfig(yield* decode("{}")).triggerOnOpen);
      const bad = yield* Effect.exit(decode('{"checks":{"failOn":"blocker"}}'));
      assert.isTrue(Exit.isFailure(bad));
    }),
  );
});
