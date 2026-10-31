import { Readable } from "node:stream";
import { buffer } from "node:stream/consumers";
import { gzipSync } from "node:zlib";

import { assert, describe, it } from "@effect/vitest";
import { pack } from "tar-stream";

import { readSources } from "../src/Indexer.ts";

const root = `owner-repo-${"a".repeat(40)}`;

const tarball = async (files: ReadonlyArray<readonly [string, string]>): Promise<Uint8Array> => {
  const archive = pack();

  for (const [name, content] of files) archive.entry({ name }, content);
  archive.finalize();

  return gzipSync(await buffer(Readable.from(archive)));
};

describe("readSources", () => {
  it("keeps full paths whether tar splits them into a prefix or a pax header", async () => {
    const prefixed = `${root}/packages/one/src/index.ts`;
    const sibling = `${root}/packages/two/src/index.ts`;
    const deep = `${root}/${"directory/".repeat(30)}Connected Services/a=b/file.ts`;

    const sources = await readSources(
      await tarball([
        [prefixed, "one"],
        [sibling, "two"],
        [deep, "deep"],
        [`${root}/LICENSE`, "MIT"],
      ]),
    );

    assert.deepStrictEqual(
      sources.map((source) => source.path),
      [
        "packages/one/src/index.ts",
        "packages/two/src/index.ts",
        deep.slice(root.length + 1),
        "LICENSE",
      ],
    );
  });

  it("skips binaries, build output, and entries outside the archive root", async () => {
    const sources = await readSources(
      await tarball([
        ["index.ts", "lost"],
        [`${root}/dist/app.js`, "built"],
        [`${root}/logo.bin`, "\u0000binary"],
        [`${root}/app.ts`, "kept"],
      ]),
    );

    assert.deepStrictEqual(sources, [{ path: "app.ts", content: "kept" }]);
  });

  it("keeps one row for a repeated path", async () => {
    const sources = await readSources(
      await tarball([
        [`${root}/app.ts`, "first"],
        [`${root}/app.ts`, "second"],
      ]),
    );

    assert.deepStrictEqual(sources, [{ path: "app.ts", content: "second" }]);
  });

  it("rejects a corrupt archive", async () => {
    const failure = await readSources(new Uint8Array([1, 2, 3])).then(
      () => "resolved",
      () => "rejected",
    );

    assert.strictEqual(failure, "rejected");
  });
});
