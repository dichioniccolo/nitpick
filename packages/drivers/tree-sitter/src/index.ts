import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import {
  type CodeRef,
  type CodeSymbol,
  type Language as Lang,
  type ParsedFile,
  SymbolKind,
} from "@nitpick/code-graph-domain";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as S from "effect/Schema";
import { Language, Parser, Query } from "web-tree-sitter";

import { grammarFiles, queries } from "./queries.ts";

export class ParseError extends Data.TaggedError("ParseError")<{
  readonly language: string;
  readonly cause: unknown;
}> {}

interface Grammar {
  readonly language: Language;
  readonly query: Query;
}

const isSymbolKind = S.is(SymbolKind);

const signatureOf = (text: string): string => (text.split("\n", 1)[0] ?? "").trim().slice(0, 200);

interface Span {
  readonly name: string;
  readonly startLine: number;
  readonly endLine: number;
}

/** The smallest of `spans` that holds `line`. */
const innermost = (spans: ReadonlyArray<Span>, line: number, self?: Span): Span | null => {
  let best: Span | null = null;

  for (const span of spans) {
    if (span === self || line < span.startLine || line > span.endLine) continue;

    if (best === null || span.endLine - span.startLine < best.endLine - best.startLine) best = span;
  }

  return best;
};

const extract = (parser: Parser, grammar: Grammar, source: string): ParsedFile => {
  parser.setLanguage(grammar.language);
  const tree = parser.parse(source);

  if (tree === null) return { symbols: [], refs: [] };

  try {
    const defined: Array<Omit<CodeSymbol, "parent"> & Span> = [];
    const raw: Array<Omit<CodeRef, "enclosing">> = [];

    for (const match of grammar.query.matches(tree.rootNode)) {
      const nameCapture = match.captures.find((capture) => capture.name.endsWith(".name"));

      if (nameCapture === undefined) continue;
      const [kind] = nameCapture.name.split(".");
      const name = nameCapture.node.text;

      if (kind === "call") {
        raw.push({ name, kind: "call", line: nameCapture.node.startPosition.row + 1 });
      } else if (kind === "import") {
        raw.push({
          name: name.replace(/^"|"$/g, ""),
          kind: "import",
          line: nameCapture.node.startPosition.row + 1,
        });
      } else if (isSymbolKind(kind)) {
        const definition =
          match.captures.find((capture) => capture.name.endsWith(".def"))?.node ?? nameCapture.node;

        defined.push({
          name,
          kind,
          startLine: definition.startPosition.row + 1,
          endLine: definition.endPosition.row + 1,
          signature: signatureOf(definition.text),
        });
      }
    }

    return {
      symbols: defined.map((symbol) => ({
        ...symbol,
        parent: innermost(defined, symbol.startLine, symbol)?.name ?? null,
      })),
      refs: raw.map((ref) => ({ ...ref, enclosing: innermost(defined, ref.line)?.name ?? null })),
    };
  } finally {
    tree.delete();
  }
};

/** The folder holding the runtime and grammar `.wasm` files; the worker image sets it. */
const GrammarDirectory = Config.option(Config.String("TREE_SITTER_GRAMMARS"));

export class TreeSitter extends Context.Service<
  TreeSitter,
  { readonly parse: (language: Lang, source: string) => Effect.Effect<ParsedFile, ParseError> }
>()("@nitpick/tree-sitter/TreeSitter") {
  static readonly layer = Layer.effect(
    TreeSitter,
    Effect.gen(function* () {
      const configured = yield* GrammarDirectory;

      // A bundle has no node_modules to resolve, so the image copies every .wasm to one folder.
      const require = createRequire(import.meta.url);

      const directory = Option.getOrElse(configured, () =>
        join(dirname(require.resolve("tree-sitter-wasms/package.json")), "out"),
      );

      const runtimeDirectory = Option.getOrElse(configured, () =>
        dirname(require.resolve("web-tree-sitter")),
      );

      yield* Effect.tryPromise({
        try: () => Parser.init({ locateFile: (file: string) => join(runtimeDirectory, file) }),
        catch: (cause) => new ParseError({ language: "runtime", cause }),
      });

      const parser = yield* Effect.acquireRelease(
        Effect.sync(() => new Parser()),
        (instance) => Effect.sync(() => instance.delete()),
      );

      const grammars = new Map<Lang, Grammar>();

      const grammarOf = (language: Lang) =>
        Effect.suspend(() => {
          const known = grammars.get(language);

          if (known !== undefined) return Effect.succeed(known);

          return Effect.tryPromise({
            try: async () => {
              const loaded = await Language.load(join(directory, grammarFiles[language]));
              const grammar = { language: loaded, query: new Query(loaded, queries[language]) };
              grammars.set(language, grammar);

              return grammar;
            },
            catch: (cause) => new ParseError({ language, cause }),
          });
        });

      return {
        parse: (language, source) =>
          Effect.flatMap(grammarOf(language), (grammar) =>
            Effect.try({
              try: () => extract(parser, grammar, source),
              catch: (cause) => new ParseError({ language, cause }),
            }),
          ),
      };
    }),
  );
}
