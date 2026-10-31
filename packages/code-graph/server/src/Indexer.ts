import { createHash } from "node:crypto";
import { languageOf, type ParsedFile } from "@nitpick/code-graph-domain";
import {
  codeFile,
  codeRef,
  codeSymbol,
  installation,
  repository,
} from "@nitpick/code-graph-tables";
import { describeFailure, GitHub, type GitHubError, toRepoRef } from "@nitpick/github";
import { Database } from "@nitpick/postgres";
import { TreeSitter } from "@nitpick/tree-sitter";
import { and, eq, inArray, sql } from "drizzle-orm";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import { parseTarGzip } from "nanotar";

export class IndexTooLarge extends Data.TaggedError("IndexTooLarge")<{ readonly sizeKb: number }> {}

export class RepositoryNotFound extends Data.TaggedError("RepositoryNotFound")<{
  readonly id: number;
}> {}

export class TarballError extends Data.TaggedError("TarballError")<{ readonly cause: unknown }> {}

/** GitHub's reported size; a tarball is read into memory, so this bounds the worker's heap. */
const maxRepositoryKb = 150_000;
const maxFileBytes = 512_000;
const maxFiles = 20_000;
const insertBatch = 500;

const skippedDirectories =
  /(^|\/)(node_modules|vendor|third_party|dist|build|out|target|coverage|\.git|\.next|\.turbo|__pycache__|\.venv|venv)\//;

const skippedFiles = /(\.min\.(js|css)|\.map|\.lock|-lock\.json|-lock\.yaml|\.snap|\.svg|\.wasm)$/i;

export interface SourceFile {
  readonly path: string;
  readonly content: string;
}

/** Which tar entries are worth indexing: small text files outside build output. */
export const selectSources = (
  entries: ReadonlyArray<{ readonly name: string; readonly data?: Uint8Array | undefined }>,
): ReadonlyArray<SourceFile> => {
  const decoder = new TextDecoder("utf-8", { fatal: false });
  const sources: Array<SourceFile> = [];

  for (const entry of entries) {
    if (sources.length >= maxFiles) break;
    // GitHub prefixes every entry with `<owner>-<repo>-<sha>/`.
    const path = entry.name.slice(entry.name.indexOf("/") + 1);
    const data = entry.data;

    if (path === "" || path.endsWith("/") || data === undefined || data.length === 0) continue;

    if (
      data.length > maxFileBytes ||
      skippedDirectories.test(`/${path}`) ||
      skippedFiles.test(path)
    )
      continue;

    if (data.subarray(0, 8000).includes(0)) continue;
    sources.push({ path, content: decoder.decode(data) });
  }

  return sources;
};

const emptyFile: ParsedFile = { symbols: [], refs: [] };

const hashOf = (content: string): string => createHash("sha256").update(content).digest("hex");

const chunks = <A>(items: ReadonlyArray<A>, size: number): ReadonlyArray<ReadonlyArray<A>> => {
  const output: Array<ReadonlyArray<A>> = [];

  for (let start = 0; start < items.length; start += size)
    output.push(items.slice(start, start + size));

  return output;
};

export class Indexer extends Context.Service<
  Indexer,
  {
    /** Bring the graph up to the default branch. Unchanged files are not parsed again. */
    readonly indexRepository: (
      repositoryId: number,
    ) => Effect.Effect<
      void,
      IndexTooLarge | RepositoryNotFound | TarballError | GitHubError,
      never
    >;
  }
>()("@nitpick/code-graph/Indexer") {
  static readonly layer = Layer.effect(
    Indexer,
    Effect.gen(function* () {
      const db = yield* Database;
      const github = yield* GitHub;
      const treeSitter = yield* TreeSitter;

      const refresh = Effect.fn("code-graph.index.refresh")(function* (
        row: typeof repository.$inferSelect,
        sha: string,
      ) {
        const ref = toRepoRef(row.installationId, row.fullName);
        const sizeKb = yield* github.repositorySizeKb(ref);

        if (sizeKb > maxRepositoryKb) return yield* new IndexTooLarge({ sizeKb });

        const tarball = yield* github.tarball(ref, sha);

        const entries = yield* Effect.tryPromise({
          try: () => parseTarGzip(tarball),
          catch: (cause) => new TarballError({ cause }),
        });

        const sources = selectSources(entries);

        const existing = yield* db
          .select({ path: codeFile.path, hash: codeFile.hash })
          .from(codeFile)
          .where(eq(codeFile.repositoryId, row.id))
          .pipe(Effect.orDie);

        const known = new Map(existing.map((file) => [file.path, file.hash]));
        const present = new Set(sources.map((source) => source.path));
        const removed = existing.map((file) => file.path).filter((path) => !present.has(path));

        const changed = sources.filter(
          (source) => known.get(source.path) !== hashOf(source.content),
        );

        const parsed = yield* Effect.forEach(changed, (source) => {
          const language = languageOf(source.path);

          return (
            language === null
              ? Effect.succeed(emptyFile)
              : treeSitter.parse(language, source.content)
          ).pipe(
            // One grammar failure should not sink the repository; the file stays searchable as text.
            Effect.orElseSucceed(() => emptyFile),
            Effect.map((file) => ({ source, language, file })),
          );
        });

        const stale = [...removed, ...changed.map((source) => source.path)];
        yield* db
          .transaction((tx) =>
            Effect.gen(function* () {
              for (const paths of chunks(stale, insertBatch)) {
                const inPaths = (
                  column: typeof codeFile.path | typeof codeSymbol.path | typeof codeRef.path,
                ) => inArray(column, [...paths]);

                yield* tx
                  .delete(codeSymbol)
                  .where(and(eq(codeSymbol.repositoryId, row.id), inPaths(codeSymbol.path)));
                yield* tx
                  .delete(codeRef)
                  .where(and(eq(codeRef.repositoryId, row.id), inPaths(codeRef.path)));
                yield* tx
                  .delete(codeFile)
                  .where(and(eq(codeFile.repositoryId, row.id), inPaths(codeFile.path)));
              }

              for (const batch of chunks(parsed, 100)) {
                yield* tx.insert(codeFile).values(
                  batch.map(({ source, language }) => ({
                    repositoryId: row.id,
                    path: source.path,
                    hash: hashOf(source.content),
                    language,
                    // Postgres text cannot hold NUL, which selectSources only checks in the first 8 kB.
                    content: source.content.replaceAll("\u0000", ""),
                  })),
                );
              }

              const symbols = parsed.flatMap(({ source, file }) =>
                file.symbols.map((symbol) => ({
                  ...symbol,
                  repositoryId: row.id,
                  path: source.path,
                })),
              );

              for (const batch of chunks(symbols, insertBatch))
                yield* tx.insert(codeSymbol).values([...batch]);

              const refs = parsed.flatMap(({ source, file }) =>
                file.refs.map((item) => ({ ...item, repositoryId: row.id, path: source.path })),
              );

              for (const batch of chunks(refs, insertBatch))
                yield* tx.insert(codeRef).values([...batch]);
              yield* tx
                .update(repository)
                .set({
                  indexStatus: "ready",
                  indexedSha: sha,
                  indexedAt: sql`now()`,
                  indexError: null,
                  fileCount: sql`(select count(*) from code_file where "repositoryId" = ${row.id})`,
                  symbolCount: sql`(select count(*) from code_symbol where "repositoryId" = ${row.id})`,
                })
                .where(eq(repository.id, row.id));
            }),
          )
          .pipe(Effect.orDie);
      });

      return {
        indexRepository: Effect.fn("code-graph.index.run")(function* (repositoryId: number) {
          const [found] = yield* db
            .select({ row: repository, suspended: installation.suspended })
            .from(repository)
            .innerJoin(installation, eq(installation.id, repository.installationId))
            .where(eq(repository.id, repositoryId))
            .pipe(Effect.orDie);

          if (found === undefined) return yield* new RepositoryNotFound({ id: repositoryId });

          if (found.suspended) return;
          const { row } = found;

          yield* Effect.gen(function* () {
            const sha = yield* github.branchSha(
              toRepoRef(row.installationId, row.fullName),
              row.defaultBranch,
            );

            if (sha === row.indexedSha && row.indexStatus === "ready") return;
            yield* db
              .update(repository)
              .set({ indexStatus: "indexing" })
              .where(eq(repository.id, repositoryId))
              .pipe(Effect.orDie);
            yield* refresh(row, sha);
          }).pipe(
            // Finalizers run uninterruptibly, so a defect or a timeout also clears `indexing`.
            Effect.onExit((exit) =>
              Exit.isSuccess(exit)
                ? Effect.void
                : db
                    .update(repository)
                    .set({ indexStatus: "failed", indexError: describeFailure(exit.cause) })
                    .where(eq(repository.id, repositoryId))
                    .pipe(Effect.orDie),
            ),
          );
        }),
      };
    }),
  );
}
