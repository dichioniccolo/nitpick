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
    const at = (failOn: "critical" | "major" | "minor") => ({ failOn, minConfidence: 5 });
    assert.strictEqual(checkConclusion(of("major", "minor"), 5, at("critical")), "success");
    assert.strictEqual(checkConclusion(of("critical"), 5, at("critical")), "failure");
    assert.strictEqual(checkConclusion(of("major"), 5, at("major")), "failure");
    assert.strictEqual(checkConclusion(of("critical"), 5, at("major")), "failure");
    assert.strictEqual(checkConclusion(of("minor"), 5, at("major")), "success");
    assert.strictEqual(checkConclusion(of("minor"), 5, at("minor")), "failure");
    assert.strictEqual(checkConclusion([], 5, at("minor")), "success");
  });

  it("fails below minConfidence whatever the findings, and 1 turns that off", () => {
    const gate = { failOn: "critical", minConfidence: 5 } as const;
    assert.strictEqual(checkConclusion([], 4, gate), "failure");
    assert.strictEqual(checkConclusion([], 5, gate), "success");
    assert.strictEqual(checkConclusion([], 4.6, gate), "success");
    assert.strictEqual(checkConclusion([], 3, { ...gate, minConfidence: 3 }), "success");
    assert.strictEqual(checkConclusion([], 1, { failOn: "never", minConfidence: 1 }), "success");
  });

  it("never fails on findings with failOn never", () => {
    const gate = { failOn: "never", minConfidence: 5 } as const;
    assert.strictEqual(checkConclusion(of("critical", "critical"), 5, gate), "success");
  });
});

describe("check output", () => {
  it("counts findings in the title and sanitizes the summary", () => {
    const output = completedCheckOutput({
      summary: "cc @octocat",
      confidence: 9,
      findings: of("critical", "minor", "minor"),
      gate: { failOn: "major", minConfidence: 5 },
      reviewUrl: "https://nitpick.test/app/reviews/1",
    });

    assert.strictEqual(output.title, "1 critical, 2 minor");
    assert.include(output.summary, "@​octocat");
    assert.include(output.summary, "5/5");
    assert.include(
      output.summary,
      "Fails on major findings or worse or a confidence score below 5/5.",
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
  it.effect("defaults on at critical and merges a partial block by key", () =>
    Effect.gen(function* () {
      const decode = S.decodeUnknownEffect(S.fromJsonString(RepoConfig));
      assert.deepStrictEqual(resolveConfig(yield* decode("{}")).checks, {
        enabled: true,
        failOn: "critical",
        minConfidence: 5,
      });
      assert.deepStrictEqual(resolveConfig(yield* decode('{"checks":{"failOn":"major"}}')).checks, {
        enabled: true,
        failOn: "major",
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
      const bad = yield* Effect.exit(decode('{"checks":{"failOn":"blocker"}}'));
      assert.isTrue(Exit.isFailure(bad));
    }),
  );
});
