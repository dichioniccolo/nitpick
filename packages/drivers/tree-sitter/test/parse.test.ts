import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { TreeSitter } from "../src/index.ts";

const samples = {
  typescript: `import { a } from "./a";
export class Billing {
  charge(id: string) {
    return audit(id);
  }
}
export const refund = (id: string) => { new Billing().charge(id); };
interface Plan { id: string }
type Id = string;`,
  tsx: `import React from "react";
export function Card() { return <div>{format()}</div>; }`,
  javascript: `import x from "x";
function main() { helper(); }`,
  python: `from app.db import session
class Repo:
    def save(self, row):
        return session.add(row)`,
  go: `package main
import "fmt"
type Server struct{}
func (s *Server) Run() { fmt.Println("x") }
func main() { Start() }`,
  rust: `use std::fs;
struct Cache;
trait Store {}
fn load() { fs::read("x"); helper(); }`,
  java: `import java.util.List;
class Svc { void run() { other(); new Thing(); } }`,
} as const;

describe("TreeSitter", () => {
  it.effect("extracts definitions and references for every language", () =>
    Effect.gen(function* () {
      const treeSitter = yield* TreeSitter;

      for (const [language, source] of Object.entries(samples)) {
        // SAFETY: Object.entries of `samples` yields its own keys.
        const parsed = yield* treeSitter.parse(language as keyof typeof samples, source);
        assert.isAbove(parsed.symbols.length, 0, `${language} symbols`);
        assert.isAbove(parsed.refs.length, 0, `${language} refs`);
      }
    }).pipe(Effect.scoped, Effect.provide(TreeSitter.layer)),
  );

  it.effect("links a method to its class and a call to its enclosing symbol", () =>
    Effect.gen(function* () {
      const treeSitter = yield* TreeSitter;
      const parsed = yield* treeSitter.parse("typescript", samples.typescript);
      const charge = parsed.symbols.find((symbol) => symbol.name === "charge");
      assert.strictEqual(charge?.parent, "Billing");
      const audit = parsed.refs.find((ref) => ref.name === "audit");
      assert.strictEqual(audit?.enclosing, "charge");
      assert.isTrue(parsed.refs.some((ref) => ref.kind === "import" && ref.name === "./a"));
    }).pipe(Effect.scoped, Effect.provide(TreeSitter.layer)),
  );
});
