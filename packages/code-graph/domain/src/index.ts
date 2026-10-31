import * as S from "effect/Schema";

export const Language = S.Literals([
  "typescript",
  "tsx",
  "javascript",
  "python",
  "go",
  "rust",
  "java",
]);

export type Language = typeof Language.Type;

export const SymbolKind = S.Literals([
  "function",
  "method",
  "class",
  "interface",
  "type",
  "enum",
  "module",
]);

export type SymbolKind = typeof SymbolKind.Type;

export const RefKind = S.Literals(["call", "import"]);

export type RefKind = typeof RefKind.Type;

/** A named definition in a source file. Lines are 1-indexed and inclusive. */
export interface CodeSymbol {
  readonly name: string;
  readonly kind: SymbolKind;
  readonly startLine: number;
  readonly endLine: number;
  readonly signature: string;
  readonly parent: string | null;
}

/** A use of a name: a call site, or an imported module. */
export interface CodeRef {
  readonly name: string;
  readonly kind: RefKind;
  readonly line: number;
  /** The innermost symbol holding the reference, `null` at file scope. */
  readonly enclosing: string | null;
}

export interface ParsedFile {
  readonly symbols: ReadonlyArray<CodeSymbol>;
  readonly refs: ReadonlyArray<CodeRef>;
}

const extensions = new Map<string, Language>([
  ["ts", "typescript"],
  ["mts", "typescript"],
  ["cts", "typescript"],
  ["tsx", "tsx"],
  ["js", "javascript"],
  ["mjs", "javascript"],
  ["cjs", "javascript"],
  ["jsx", "javascript"],
  ["py", "python"],
  ["go", "go"],
  ["rs", "rust"],
  ["java", "java"],
]);

/** The language of `path` by extension, `null` for a file the indexer stores without parsing. */
export const languageOf = (path: string): Language | null => {
  const dot = path.lastIndexOf(".");

  return dot < 0 ? null : (extensions.get(path.slice(dot + 1).toLowerCase()) ?? null);
};
