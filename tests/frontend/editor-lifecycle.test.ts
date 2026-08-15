import assert from "node:assert/strict";
import test from "node:test";
import { assetMarkdownLink, isScreenshotItem, joinDroppedAssetLinks } from "../../src/features/editor/assets.ts";
import { nativeDraftPath, rewriteAssetLinks, toggleMarkdownCheckbox } from "../../src/features/editor/lifecycle.ts";

test("asset links are rewritten outside fenced code only", () => {
  const source = "![one](assets/a.png)\n```md\n![code](assets/b.png)\n```";
  assert.equal(rewriteAssetLinks(source, "](assets/", "](../assets/"), "![one](../assets/a.png)\n```md\n![code](assets/b.png)\n```");
});

test("draft and dropped-asset helpers preserve editor conventions", () => {
  assert.equal(nativeDraftPath("project/notes/a.md", "Data/personal/"), "Data/personal/project/notes/a.md");
  assert.equal(nativeDraftPath("outputs/category/a.md", "Data/personal/"), "outputs/category/a.md");
  assert.equal(assetMarkdownLink("a.png", "assets/a.png", true), "![a.png](assets/a.png)");
  assert.equal(joinDroppedAssetLinks(["[a](a)", "[b](b)"], true), "\n[a](a)\n[b](b)");
  assert.equal(isScreenshotItem({ name: "image.png" }), true);
  assert.equal(isScreenshotItem({ name: "diagram.png" }), false);
});

test("checkbox toggling ignores fenced examples", () => {
  const source = "- [ ] first\n```\n- [ ] example\n```\n- [ ] second";
  assert.equal(toggleMarkdownCheckbox(source, 1, true), "- [ ] first\n```\n- [ ] example\n```\n- [x] second");
});
