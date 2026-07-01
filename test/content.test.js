const test = require("node:test");
const assert = require("node:assert/strict");
const { shapeContent } = require("../src/content");

const BODY = "# Title\nintro line\n\n## Alpha\n- a1\n- a2\n\n## Beta\n- b1\n### Beta sub\n- b2";

test("default (no options) returns the full body unchanged with empty meta", () => {
  const { content, meta } = shapeContent(BODY, {});
  assert.equal(content, BODY);
  assert.deepEqual(meta, {});
});

test("content:full is a no-op equivalent to default", () => {
  assert.equal(shapeContent(BODY, { content: "full" }).content, BODY);
});

test("content:none omits content and reports totals", () => {
  const { content, meta } = shapeContent(BODY, { content: "none" });
  assert.equal(content, undefined);
  assert.equal(meta.content_omitted, true);
  assert.equal(meta.content_lines_total, BODY.split("\n").length);
  assert.equal(meta.content_chars_total, BODY.length);
  assert.match(meta.content_hint, /--content full/);
});

test("content:preview truncates a long body on a line boundary and flags truncation", () => {
  const long = Array.from({ length: 100 }, (_, i) => `line ${i}`).join("\n");
  const { content, meta } = shapeContent(long, { content: "preview" });
  assert.ok(content.length <= 400);
  assert.ok(!content.endsWith("line")); // cut on a newline, not mid-line
  assert.equal(meta.content_truncated, true);
  assert.equal(meta.content_chars_total, long.length);
  assert.match(meta.content_note, /whole body/);
});

test("maxContentChars truncates to N chars", () => {
  const { content, meta } = shapeContent(BODY, { maxContentChars: 7 });
  assert.equal(content, BODY.slice(0, 7));
  assert.equal(meta.content_truncated, true);
});

test("headLines returns the first N lines", () => {
  const { content, meta } = shapeContent(BODY, { headLines: 2 });
  assert.equal(content, "# Title\nintro line");
  assert.equal(meta.content_truncated, true);
});

test("tailLines returns the last N lines", () => {
  const { content } = shapeContent(BODY, { tailLines: 1 });
  assert.equal(content, "- b2");
});

test("section returns from the matching heading through the next same-or-higher heading", () => {
  const { content, meta } = shapeContent(BODY, { section: "alpha" });
  assert.equal(meta.content_section_found, true);
  assert.equal(content, "## Alpha\n- a1\n- a2\n");
});

test("section stops before the next same-level heading but keeps deeper subsections", () => {
  const { content } = shapeContent(BODY, { section: "beta" });
  assert.ok(content.startsWith("## Beta"));
  assert.ok(content.includes("### Beta sub"));
  assert.ok(!content.includes("## Alpha"));
});

test("section not found returns empty content and content_section_found:false", () => {
  const { content, meta } = shapeContent(BODY, { section: "zzz" });
  assert.equal(content, "");
  assert.equal(meta.content_section_found, false);
});

test("find returns matching lines with context and a count", () => {
  const { content, meta } = shapeContent(BODY, { find: "a1" });
  assert.equal(meta.content_find_matches, 1);
  assert.ok(content.includes("- a1"));
  // 2 lines of context each side
  assert.ok(content.includes("## Alpha"));
});

test("find merges adjacent matches and separates non-adjacent groups", () => {
  const body = "hit\nx\ny\nz\nq\nw\nhit";
  const { content, meta } = shapeContent(body, { find: "hit" });
  assert.equal(meta.content_find_matches, 2);
  // The two hits are far apart, so the groups are separated by the marker.
  assert.ok(content.includes("\n\n...\n\n"));
  // A line (z) was dropped between the groups, so truncation must be reported even though the
  // "\n\n...\n\n" separators inflate content.length past the body length.
  assert.equal(meta.content_truncated, true);
  assert.equal(meta.content_lines_total, body.split("\n").length);
  assert.equal(meta.content_chars_total, body.length);
  assert.ok(meta.content_note);
});

test("find with no matches returns empty content and zero matches", () => {
  const { content, meta } = shapeContent(BODY, { find: "nomatch" });
  assert.equal(content, "");
  assert.equal(meta.content_find_matches, 0);
});
