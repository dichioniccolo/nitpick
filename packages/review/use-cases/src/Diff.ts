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

const anySegment = "*";
const anyPath = "**";
const anyChar = "?";

/**
 * Tokens of a gitignore-style glob: a star, a double star, `?`, otherwise one
 * literal character. A double star takes a following slash with it. A bare name
 * matches at any depth: a double star plus `/`, against the path behind a `/`.
 */
const globTokens = (glob: string): ReadonlyArray<string> => {
  const body = glob.startsWith("/") ? glob.slice(1) : glob;
  const tokens: Array<string> = glob.includes("/") ? [] : [anyPath, "/"];
  let index = 0;

  while (index < body.length) {
    if (body.startsWith(anyPath, index)) {
      tokens.push(anyPath);
      index += body.charAt(index + 2) === "/" ? 3 : 2;
    } else {
      tokens.push(body.charAt(index));
      index += 1;
    }
  }

  return tokens;
};

/**
 * Walk `tokens` over `text` tracking every token position reachable so far, so
 * the cost is at most characters times tokens whatever the glob. A match may
 * end before a `/`, which covers everything under a matched directory.
 */
const matchesTokens = (tokens: ReadonlyArray<string>, text: string): boolean => {
  const size = tokens.length;
  let active = Array.from({ length: size + 1 }, () => false);
  let next = Array.from({ length: size + 1 }, () => false);

  // A star may match nothing, so reaching one reaches the token after it too.
  const reach = (states: Array<boolean>, from: number): void => {
    let position = from;
    states[position] = true;

    while (tokens[position] === anySegment || tokens[position] === anyPath) {
      position += 1;
      states[position] = true;
    }
  };

  reach(active, 0);

  for (let index = 0; index <= text.length; index += 1) {
    const char = text.charAt(index);

    if (active[size] === true && (index === text.length || char === "/")) return true;

    if (index === text.length) return false;
    next.fill(false);
    let alive = false;

    for (let position = 0; position < size; position += 1) {
      if (active[position] !== true) continue;
      const token = tokens[position];
      const inSegment = char !== "/";

      if (token === anyPath || (token === anySegment && inSegment)) {
        reach(next, position);
        alive = true;
      } else if ((token === anyChar && inSegment) || token === char) {
        reach(next, position + 1);
        alive = true;
      }
    }

    if (!alive) return false;
    [active, next] = [next, active];
  }

  return false;
};

export const isIgnored = (path: string, globs: ReadonlyArray<string>): boolean =>
  globs.some((raw) => {
    // A trailing slash only says "directory"; everything under it already matches.
    const glob = raw.replace(/\/$/, "");

    return matchesTokens(globTokens(glob), glob.includes("/") ? path : `/${path}`);
  });
