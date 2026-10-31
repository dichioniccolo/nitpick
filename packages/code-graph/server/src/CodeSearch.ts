import { codeFile, codeRef, codeSymbol } from "@nitpick/code-graph-tables";
import { Database } from "@nitpick/postgres";
import { and, asc, eq, ilike, or, sql } from "drizzle-orm";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

const resultLimit = 25;

/** `%`, `_` and `\` in a model-supplied query would otherwise act as ILIKE wildcards. */
const escapeLike = (text: string): string => text.replace(/[\\%_]/g, "\\$&");

export interface SymbolHit {
  readonly path: string;
  readonly name: string;
  readonly kind: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly signature: string;
  readonly parent: string | null;
}

export interface TextHit {
  readonly path: string;
  readonly line: number;
  readonly text: string;
}

export interface ReferenceHit {
  readonly path: string;
  readonly line: number;
  readonly kind: string;
  readonly enclosing: string | null;
}

const linesMatching = (
  path: string,
  content: string,
  needle: string,
  limit: number,
): ReadonlyArray<TextHit> => {
  const lower = needle.toLowerCase();
  const hits: Array<TextHit> = [];

  for (const [index, text] of content.split("\n").entries()) {
    if (hits.length >= limit) break;

    if (text.toLowerCase().includes(lower))
      hits.push({ path, line: index + 1, text: text.trim().slice(0, 200) });
  }

  return hits;
};

/** Read-only graph queries. Every method takes the repository id, so callers bind one tenant. */
export class CodeSearch extends Context.Service<
  CodeSearch,
  {
    readonly symbols: (
      repositoryId: number,
      query: string,
    ) => Effect.Effect<ReadonlyArray<SymbolHit>>;
    readonly text: (repositoryId: number, query: string) => Effect.Effect<ReadonlyArray<TextHit>>;
    readonly references: (
      repositoryId: number,
      name: string,
    ) => Effect.Effect<ReadonlyArray<ReferenceHit>>;
    readonly outline: (
      repositoryId: number,
      path: string,
    ) => Effect.Effect<ReadonlyArray<SymbolHit>>;
  }
>()("@nitpick/code-graph/CodeSearch") {
  static readonly layer = Layer.effect(
    CodeSearch,
    Effect.gen(function* () {
      const db = yield* Database;

      const symbolColumns = {
        path: codeSymbol.path,
        name: codeSymbol.name,
        kind: codeSymbol.kind,
        startLine: codeSymbol.startLine,
        endLine: codeSymbol.endLine,
        signature: codeSymbol.signature,
        parent: codeSymbol.parent,
      };

      return {
        symbols: (repositoryId, query) =>
          db
            .select(symbolColumns)
            .from(codeSymbol)
            .where(
              and(
                eq(codeSymbol.repositoryId, repositoryId),
                ilike(codeSymbol.name, `%${escapeLike(query)}%`),
              ),
            )
            .orderBy(sql`length(${codeSymbol.name})`, asc(codeSymbol.path))
            .limit(resultLimit)
            .pipe(Effect.orDie),
        text: (repositoryId, query) =>
          db
            .select({ path: codeFile.path, content: codeFile.content })
            .from(codeFile)
            .where(
              and(
                eq(codeFile.repositoryId, repositoryId),
                or(
                  ilike(codeFile.content, `%${escapeLike(query)}%`),
                  ilike(codeFile.path, `%${escapeLike(query)}%`),
                ),
              ),
            )
            .orderBy(asc(codeFile.path))
            .limit(resultLimit)
            .pipe(
              Effect.orDie,
              Effect.map((files) =>
                files
                  .flatMap((file) => linesMatching(file.path, file.content, query, 5))
                  .slice(0, resultLimit * 2),
              ),
            ),
        references: (repositoryId, name) =>
          db
            .select({
              path: codeRef.path,
              line: codeRef.line,
              kind: codeRef.kind,
              enclosing: codeRef.enclosing,
            })
            .from(codeRef)
            .where(and(eq(codeRef.repositoryId, repositoryId), eq(codeRef.name, name)))
            .orderBy(asc(codeRef.path), asc(codeRef.line))
            .limit(resultLimit * 2)
            .pipe(Effect.orDie),
        outline: (repositoryId, path) =>
          db
            .select(symbolColumns)
            .from(codeSymbol)
            .where(and(eq(codeSymbol.repositoryId, repositoryId), eq(codeSymbol.path, path)))
            .orderBy(asc(codeSymbol.startLine))
            .limit(200)
            .pipe(Effect.orDie),
      };
    }),
  );
}
