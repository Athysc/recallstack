import assert from "node:assert/strict";
import test from "node:test";

import { externalHttpUrl } from "../../src/services/external-links.ts";

test("http and https URLs are external", () => {
  assert.equal(externalHttpUrl("https://example.com/a?b=1"), "https://example.com/a?b=1");
  assert.equal(externalHttpUrl(" HTTP://Example.com "), "http://example.com/");
});

test("internal, relative and non-web schemes are not external", () => {
  for (const href of ["#heading", "#recallstack-open=notes/a.md", "notes/a.md", "../assets/x.png", "mailto:a@b.c", "javascript:alert(1)", "file:///etc/passwd", "blob:http://x/1", "data:text/html,hi", "//example.com", "", null, undefined]) {
    assert.equal(externalHttpUrl(href as string), null, String(href));
  }
});
