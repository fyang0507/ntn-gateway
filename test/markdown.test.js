const test = require("node:test");
const assert = require("node:assert/strict");
const { markdownToBlocks, markdownFromBlocks, normalizeLanguage } = require("../src/markdown");

test("markdownToBlocks turns headings and bullets into native Notion blocks", () => {
  const blocks = markdownToBlocks("## Status\n- a\n- b");

  assert.deepEqual(blocks.map((block) => block.type), ["heading_2", "bulleted_list_item", "bulleted_list_item"]);
  assert.equal(blocks[0].heading_2.rich_text[0].text.content, "Status");
  assert.equal(blocks[1].bulleted_list_item.rich_text[0].text.content, "a");
  assert.equal(blocks[2].bulleted_list_item.rich_text[0].text.content, "b");
});

test("markdownToBlocks parses to-do, numbered, quote, and divider blocks", () => {
  const blocks = markdownToBlocks("- [ ] open\n- [x] done\n\n1. one\n\n> quoted\n\n---");

  assert.deepEqual(blocks.map((block) => block.type), [
    "to_do",
    "to_do",
    "numbered_list_item",
    "quote",
    "divider",
  ]);
  assert.equal(blocks[0].to_do.checked, false);
  assert.equal(blocks[1].to_do.checked, true);
  assert.equal(blocks[3].quote.rich_text[0].text.content, "quoted");
});

test("markdownToBlocks builds fenced code blocks with a normalized language", () => {
  const blocks = markdownToBlocks("```js\nconst x = 1;\nconst y = 2;\n```");

  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type, "code");
  assert.equal(blocks[0].code.language, "javascript");
  assert.equal(blocks[0].code.rich_text[0].text.content, "const x = 1;\nconst y = 2;");
});

test("markdownToBlocks nests indented list items as block children", () => {
  const blocks = markdownToBlocks("- parent\n  - child\n    - grandchild");

  assert.equal(blocks.length, 1);
  const child = blocks[0].bulleted_list_item.children[0];
  assert.equal(child.bulleted_list_item.rich_text[0].text.content, "child");
  assert.equal(child.bulleted_list_item.children[0].bulleted_list_item.rich_text[0].text.content, "grandchild");
});

test("markdownToBlocks parses inline annotations and links", () => {
  const blocks = markdownToBlocks("plain **bold** _italic_ `code` [label](https://example.com)");

  assert.deepEqual(blocks[0].paragraph.rich_text, [
    { type: "text", text: { content: "plain " } },
    { type: "text", text: { content: "bold" }, annotations: { bold: true } },
    { type: "text", text: { content: " " } },
    { type: "text", text: { content: "italic" }, annotations: { italic: true } },
    { type: "text", text: { content: " " } },
    { type: "text", text: { content: "code" }, annotations: { code: true } },
    { type: "text", text: { content: " " } },
    { type: "text", text: { content: "label", link: { url: "https://example.com" } } },
  ]);
});

test("markdownFromBlocks serializes a Notion block tree back to clean Markdown", () => {
  const blocks = [
    { type: "heading_2", heading_2: { rich_text: [{ plain_text: "Status" }] } },
    { type: "bulleted_list_item", bulleted_list_item: { rich_text: [{ plain_text: "a" }] } },
    { type: "bulleted_list_item", bulleted_list_item: { rich_text: [{ plain_text: "b" }] } },
  ];

  assert.equal(markdownFromBlocks(blocks), "## Status\n\n- a\n- b");
});

test("markdownFromBlocks preserves link labels and annotations", () => {
  const blocks = [
    {
      type: "paragraph",
      paragraph: {
        rich_text: [
          { plain_text: "See " },
          { plain_text: "the docs", href: "https://example.com" },
          { plain_text: " then " },
          { plain_text: "stop", annotations: { bold: true } },
        ],
      },
    },
  ];

  assert.equal(markdownFromBlocks(blocks), "See [the docs](https://example.com) then **stop**");
});

test("markdownFromBlocks renders nested list items with indentation", () => {
  const blocks = [
    {
      type: "bulleted_list_item",
      bulleted_list_item: {
        rich_text: [{ plain_text: "parent" }],
        children: [
          { type: "bulleted_list_item", bulleted_list_item: { rich_text: [{ plain_text: "child" }] } },
        ],
      },
    },
  ];

  assert.equal(markdownFromBlocks(blocks), "- parent\n  - child");
});

test("a block round-trips Markdown -> blocks -> Markdown", () => {
  const source = "## Status\n\n- a\n- b\n\n> note\n\n```python\nx = 1\n```";
  assert.equal(markdownFromBlocks(markdownToBlocks(source)), source);
});

test("markdownFromBlocks numbers consecutive numbered list items sequentially", () => {
  const blocks = [
    { type: "numbered_list_item", numbered_list_item: { rich_text: [{ plain_text: "one" }] } },
    { type: "numbered_list_item", numbered_list_item: { rich_text: [{ plain_text: "two" }] } },
    { type: "numbered_list_item", numbered_list_item: { rich_text: [{ plain_text: "three" }] } },
    { type: "paragraph", paragraph: { rich_text: [{ plain_text: "break" }] } },
    { type: "numbered_list_item", numbered_list_item: { rich_text: [{ plain_text: "restart" }] } },
  ];

  assert.equal(markdownFromBlocks(blocks), "1. one\n2. two\n3. three\n\nbreak\n\n1. restart");
});

test("nested numbered lists restart numbering at each level", () => {
  const blocks = markdownToBlocks("1. one\n   1. sub one\n   2. sub two\n2. two");
  assert.equal(markdownFromBlocks(blocks), "1. one\n  1. sub one\n  2. sub two\n2. two");
});

test("a labeled source link becomes a bookmark whose caption preserves the label", () => {
  const blocks = markdownToBlocks("Source: [Anthropic News](https://www.anthropic.com/news)");

  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type, "bookmark");
  assert.equal(blocks[0].bookmark.url, "https://www.anthropic.com/news");
  assert.deepEqual(blocks[0].bookmark.caption, [{ type: "text", text: { content: "Anthropic News" } }]);
});

test("a bare source URL becomes a caption-less bookmark", () => {
  const blocks = markdownToBlocks("https://www.anthropic.com");

  assert.equal(blocks[0].type, "bookmark");
  assert.deepEqual(blocks[0].bookmark, { url: "https://www.anthropic.com" });
});

test("a labeled bookmark round-trips its label through Markdown", () => {
  const blocks = markdownToBlocks("[Anthropic News](https://www.anthropic.com/news)");
  const markdown = markdownFromBlocks(blocks);

  assert.equal(markdown, "[Anthropic News](https://www.anthropic.com/news)");
  assert.deepEqual(markdownToBlocks(markdown)[0].bookmark.caption, [
    { type: "text", text: { content: "Anthropic News" } },
  ]);
});

test("normalizeLanguage maps aliases and falls back to plain text", () => {
  assert.equal(normalizeLanguage("ts"), "typescript");
  assert.equal(normalizeLanguage("sh"), "shell");
  assert.equal(normalizeLanguage("totally-made-up"), "plain text");
  assert.equal(normalizeLanguage(""), "plain text");
});
