import { CodeSearch } from "@nitpick/code-graph-server";
import { GitHub, type RepoRef } from "@nitpick/github";
import type { Json } from "@nitpick/review-domain";
import * as Effect from "effect/Effect";
import * as S from "effect/Schema";

import { type AgentTool, decoder, objectSchema } from "./Agent.ts";

const maxReadLines = 400;
const maxToolChars = 20_000;

const clip = (text: string): string =>
  text.length <= maxToolChars
    ? text
    : `${text.slice(0, maxToolChars)}\n[cut at ${maxToolChars} characters]`;

const asJson = <A>(value: A): string => clip(JSON.stringify(value));

const tool = <A, I>(
  name: string,
  description: string,
  properties: { readonly [key: string]: Json },
  required: ReadonlyArray<string>,
  schema: S.Codec<A, I>,
  run: (input: A) => Effect.Effect<string, Error>,
): AgentTool => {
  const decode = decoder(schema);

  return {
    definition: {
      name,
      description,
      eager_input_streaming: true,
      input_schema: objectSchema(properties, required),
    },
    run: (input) => Effect.flatMap(decode(input), run),
  };
};

const Query = S.Struct({ query: S.String });
const Name = S.Struct({ name: S.String });
const Path = S.Struct({ path: S.String });

const Side = S.Literals(["head", "base"]);

const Read = S.Struct({
  path: S.String,
  startLine: S.optional(S.Int),
  endLine: S.optional(S.Int),
  ref: S.optional(Side),
});

const List = S.Struct({ path: S.String, ref: S.optional(Side) });
const None = S.Struct({});

const text = { type: "string" } as const;
const integer = { type: "integer" } as const;

const side = {
  type: "string",
  enum: ["head", "base"],
  description: "head (default) is the PR's commit, base is the commit it merges into.",
} as const;

const maxCommitMessage = 500;

/** The pull request the tools read: its number, and the two commits it compares. */
export interface ToolTarget {
  readonly prNumber: number;
  readonly headSha: string;
  readonly baseSha: string;
}

/**
 * The agent's read-only tools, bound to one repository and pull request. The
 * graph is the indexed default branch; `read_file` and `list_directory` read
 * the PR's head or base commit, so the agent can compare before and after.
 */
export const toolsFor = Effect.fnUntraced(function* (
  repositoryId: number,
  ref: RepoRef,
  target: ToolTarget,
) {
  const search = yield* CodeSearch;
  const github = yield* GitHub;

  const shaOf = (which: typeof Side.Type | undefined) =>
    which === "base" ? target.baseSha : target.headSha;

  return [
    tool(
      "search_symbols",
      "Find functions, classes and types by part of their name. Returns path, line span and signature.",
      { query: text },
      ["query"],
      Query,
      ({ query }) => Effect.map(search.symbols(repositoryId, query), asJson),
    ),
    tool(
      "search_text",
      "Find a literal string in file contents or paths, case-insensitively.",
      { query: text },
      ["query"],
      Query,
      ({ query }) => Effect.map(search.text(repositoryId, query), asJson),
    ),
    tool(
      "find_references",
      "List every call site of an exact name, or files importing an exact module path, with the enclosing symbol.",
      { name: text },
      ["name"],
      Name,
      ({ name }) => Effect.map(search.references(repositoryId, name), asJson),
    ),
    tool(
      "file_outline",
      "List the symbols defined in a file.",
      { path: text },
      ["path"],
      Path,
      ({ path }) => Effect.map(search.outline(repositoryId, path), asJson),
    ),
    tool(
      "read_file",
      `Read a file at the PR's head or base commit, with line numbers. Returns at most ${maxReadLines} lines per call.`,
      { path: text, startLine: integer, endLine: integer, ref: side },
      ["path"],
      Read,
      ({ path, startLine = 1, endLine, ref: which }) =>
        github.fileText(ref, path, shaOf(which)).pipe(
          Effect.mapError(
            (error) => new Error(`GitHub read failed for ${path}: ${error.status ?? "network"}`),
          ),
          Effect.map((content) => {
            if (content === null) return `${path} does not exist at this commit.`;
            const lines = content.split("\n");
            const first = Math.max(1, startLine);
            const last = Math.min(lines.length, endLine ?? lines.length, first + maxReadLines - 1);

            const body = lines
              .slice(first - 1, last)
              .map((line, index) => `${first + index} ${line}`)
              .join("\n");

            return clip(`${path} lines ${first}-${last} of ${lines.length}\n${body}`);
          }),
        ),
    ),
    tool(
      "list_directory",
      'List a directory at the PR\'s head or base commit. The root is "".',
      { path: text, ref: side },
      ["path"],
      List,
      ({ path, ref: which }) =>
        github.listDirectory(ref, path, shaOf(which)).pipe(
          Effect.mapError(
            (error) => new Error(`GitHub list failed for ${path}: ${error.status ?? "network"}`),
          ),
          Effect.map((entries) =>
            entries === null
              ? `${path} is not a directory at this commit.`
              : clip(entries.map((entry) => `${entry.type} ${entry.name}`).join("\n")),
          ),
        ),
    ),
    tool(
      "pr_commits",
      "List the pull request's commits, oldest first, with author and message.",
      {},
      [],
      None,
      () =>
        github.pullCommits(ref, target.prNumber).pipe(
          Effect.mapError(
            (error) => new Error(`GitHub commit list failed: ${error.status ?? "network"}`),
          ),
          Effect.map((commits) =>
            asJson(
              commits.map((commit) => ({
                sha: commit.sha.slice(0, 12),
                author: commit.author,
                message: commit.message.slice(0, maxCommitMessage),
              })),
            ),
          ),
        ),
    ),
  ];
});
