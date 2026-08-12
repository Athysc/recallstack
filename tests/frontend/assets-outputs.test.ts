import assert from "node:assert/strict";
import test from "node:test";
import { assetLocation, clipFilename, formatAssetSize, isImageFilename, orphanAssetNames, referencedAssets } from "../../src/features/assets/catalog.ts";
import { groupOutputFiles, outputDocumentPath } from "../../src/features/outputs/files.ts";

test("asset helpers resolve archive paths and markdown references", () => {
  assert.deepEqual(assetLocation("project/notes/Test.md", "ignored"), { parentParts: ["project", "notes"], prefix: "assets/" });
  assert.deepEqual(assetLocation("project/notes/archived/Test.md", "ignored"), { parentParts: ["project", "notes"], prefix: "../assets/" });
  assert.equal(clipFilename(new Date(2026, 7, 10, 9, 5, 3)), "clip-20260810-090503.png");
  assert.deepEqual([...referencedAssets("![a](assets/a%20b.png) [b](../assets/b.pdf)")], ["a b.png", "b.pdf"]);
  assert.deepEqual(orphanAssetNames(["z.png", "a.png"], new Set(["z.png"])), ["a.png"]);
  assert.equal(isImageFilename("PHOTO.JPEG"), true);
  assert.equal(formatAssetSize(1536), "1.5 KB");
});

test("outputs helpers group and construct stable editor paths", () => {
  const files = [
    { name: "z.md", mtime: 1, subPath: "nested/z.md" },
    { name: "a.png", mtime: 2, subPath: "a.png" },
  ] as never[];
  const grouped = groupOutputFiles(files, "mtime");
  assert.equal(grouped.get("markdown")?.[0].name, "z.md");
  assert.equal(grouped.get("image")?.[0].name, "a.png");
  assert.equal(outputDocumentPath("openbrain", "reports", "nested/z.md"), "openbrain/outputs/reports/nested/z.md");
});
