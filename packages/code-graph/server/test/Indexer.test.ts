import { assert, describe, it } from "@effect/vitest";
import { parseTar } from "nanotar";

import { selectSources } from "../src/Indexer.ts";

const encoder = new TextEncoder();

/** A file entry as `git archive` writes it: paths over 100 bytes split into `prefix` and `name`. */
const ustarEntry = (prefix: string, name: string, content: string): Uint8Array => {
  const body = encoder.encode(content);
  const entry = new Uint8Array(512 + Math.ceil(body.length / 512) * 512);
  entry.set(encoder.encode(name), 0);
  entry.set(encoder.encode(body.length.toString(8).padStart(11, "0")), 124);
  entry.set(encoder.encode("0"), 156);
  entry.set(encoder.encode("ustar\u000000"), 257);
  entry.set(encoder.encode(prefix), 345);
  entry.set(body, 512);

  return entry;
};

const archive = (entries: ReadonlyArray<Uint8Array>): Uint8Array => {
  const output = new Uint8Array(entries.reduce((sum, entry) => sum + entry.length, 1024));
  let offset = 0;

  for (const entry of entries) {
    output.set(entry, offset);
    offset += entry.length;
  }

  return output;
};

describe("selectSources", () => {
  it("keeps the directories of paths stored in the ustar prefix", () => {
    const root = `owner-repo-${"a".repeat(40)}`;

    const entries = parseTar(
      archive([
        ustarEntry(`${root}/packages/one/src`, "index.ts", "one"),
        ustarEntry(`${root}/packages/two/src`, "index.ts", "two"),
        ustarEntry("", `${root}/LICENSE`, "MIT"),
      ]),
    );

    assert.deepStrictEqual(selectSources(entries), [
      { path: "packages/one/src/index.ts", content: "one" },
      { path: "packages/two/src/index.ts", content: "two" },
      { path: "LICENSE", content: "MIT" },
    ]);
  });

  it("skips entries outside the archive root", () => {
    assert.deepStrictEqual(selectSources([{ name: "index.ts", data: encoder.encode("lost") }]), []);
  });
});
