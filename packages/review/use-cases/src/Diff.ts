/** A file in a pull request, as GitHub's list-files endpoint returns it. */
export interface PullFile {
  readonly path: string;
  readonly status: string;
  /** Absent for binary files and diffs GitHub truncates. */
  readonly patch?: string | undefined;
}

const hunkHeader = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/** The new-file lines of `patch` a review comment can attach to: additions and context. */
export const commentableLines = (patch: string): ReadonlySet<number> => {
  const lines = new Set<number>();
  let next = 0;

  for (const text of patch.split("\n")) {
    const hunk = hunkHeader.exec(text);

    if (hunk !== null) {
      next = Number(hunk[1]);
    } else if (next > 0 && !text.startsWith("-") && !text.startsWith("\\")) {
      lines.add(next);
      next += 1;
    }
  }

  return lines;
};

/** `patch` with new-file line numbers in a left gutter, so the agent cites real lines. */
export const annotatePatch = (patch: string): string => {
  const output: Array<string> = [];
  let next = 0;

  for (const text of patch.split("\n")) {
    const hunk = hunkHeader.exec(text);

    if (hunk !== null) {
      next = Number(hunk[1]);
      output.push(text);
    } else if (text.startsWith("-") || text.startsWith("\\")) {
      output.push(`      ${text}`);
    } else if (next > 0) {
      output.push(`${String(next).padStart(5)} ${text}`);
      next += 1;
    }
  }

  return output.join("\n");
};

const regexChars = /[.+^${}()|[\]\\]/g;

/** Compile a gitignore-style glob: `*`, `**`, `?`, and a bare name matches at any depth. */
export const globToRegExp = (glob: string): RegExp => {
  const anchored = glob.includes("/");

  const body = glob
    .replace(/^\//, "")
    .replace(regexChars, "\\$&")
    .replace(/\*\*\/?|\*|\?/g, (token) => {
      if (token === "*") return "[^/]*";

      if (token === "?") return "[^/]";

      return ".*";
    });

  return new RegExp(`^${anchored ? "" : "(?:.*/)?"}${body}(?:/.*)?$`);
};

export const isIgnored = (path: string, globs: ReadonlyArray<string>): boolean =>
  globs.some((glob) => globToRegExp(glob).test(path));
