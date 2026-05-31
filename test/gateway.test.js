const test = require("node:test");
const assert = require("node:assert/strict");
const { parseGatewayBlocks } = require("../src/gateway");

test("parseGatewayBlocks extracts canonical data source IDs from Gateway table rows", () => {
  const parsed = parseGatewayBlocks([
    heading("Operating rules"),
    bullet("Only use databases exposed by this page."),
    {
      type: "table_row",
      table_row: {
        cells: [
          [{ plain_text: "Technical Projects" }],
          [{ plain_text: "3619782c4f4a80cdb950000b982ed568" }],
          [{ plain_text: "3619782c-4f4a-80f7-b8b7-fa51fef526ba" }],
        ],
      },
    },
  ]);

  assert.equal(parsed.content, "## Operating rules\n- Only use databases exposed by this page.\n- Technical Projects");
  assert.equal(parsed.databaseCandidates[0].title, "Technical Projects");
  assert.equal(parsed.databaseCandidates[0].id, "3619782c-4f4a-80cd-b950-000b982ed568");
});

test("parseGatewayBlocks gives a linked database its own line instead of gluing onto the heading", () => {
  const databaseId = "3619782c-4f4a-80f7-b8b7-fa51fef526ba";
  const parsed = parseGatewayBlocks([
    heading("Technical Projects"),
    {
      type: "link_to_page",
      link_to_page: {
        type: "database_id",
        database_id: databaseId,
      },
    },
  ]);

  assert.deepEqual(parsed.databaseCandidates[0], {
    id: databaseId,
    database_id: databaseId,
    title: "Technical Projects",
    source: "link_to_page_database",
    lineIndex: 1,
    ownsLine: true,
  });
  // The heading keeps its own line; the link owns a separate (placeholder) line.
  assert.equal(parsed.contentLines[0], "## Technical Projects");
  assert.notEqual(parsed.databaseCandidates[0].lineIndex, 0);
});

test("parseGatewayBlocks keeps a linked database's name when the heading already covers another database", () => {
  const parentingId = "23a9782c-4f4a-8088-aad7-d3580c9e110f";
  const homeImprovementId = "3619782c-4f4a-806f-b38e-ecc3ccf63d9f";
  const parsed = parseGatewayBlocks([
    heading("Family and Home"),
    {
      type: "paragraph",
      paragraph: {
        rich_text: [
          { type: "mention", plain_text: "Parenting", mention: { type: "database", database: { id: parentingId } } },
        ],
      },
    },
    { type: "link_to_page", link_to_page: { type: "database_id", database_id: homeImprovementId } },
  ]);

  const home = parsed.databaseCandidates.find((candidate) => candidate.id === homeImprovementId);
  // The linked database gets its own line; its id never lands on the heading line.
  assert.ok(home.ownsLine);
  assert.notEqual(home.lineIndex, 0);
  assert.equal(parsed.contentLines[0], "## Family and Home");
});

test("parseGatewayBlocks captures page links and page mentions as page candidates", () => {
  const pageId = "cb43fc31-7a14-4cc2-b1d4-864c169e1a12";
  const mentionedPageId = "3719782c-4f4a-8088-a128-ff8e4ba4271f";
  const parsed = parseGatewayBlocks([
    heading("Related"),
    { type: "link_to_page", link_to_page: { type: "page_id", page_id: pageId } },
    {
      type: "paragraph",
      paragraph: {
        rich_text: [
          { plain_text: "See " },
          { type: "mention", plain_text: "Roadmap", mention: { type: "page", page: { id: mentionedPageId } } },
        ],
      },
    },
  ]);

  const linked = parsed.pageCandidates.find((candidate) => candidate.id === pageId);
  assert.equal(linked.source, "link_to_page");
  assert.ok(linked.ownsLine);

  const mentioned = parsed.pageCandidates.find((candidate) => candidate.id === mentionedPageId);
  assert.equal(mentioned.source, "page_mention");
  assert.equal(mentioned.title, "Roadmap");
});

test("parseGatewayBlocks treats database mentions as database IDs to resolve", () => {
  const databaseId = "23d9782c-4f4a-801f-9520-ccc9cf94c8c6";
  const parsed = parseGatewayBlocks([
    heading("Writing"),
    {
      type: "paragraph",
      paragraph: {
        rich_text: [
          { plain_text: "Writing " },
          { type: "mention", plain_text: "Writing", mention: { type: "database", database: { id: databaseId } } },
        ],
      },
    },
  ]);

  assert.deepEqual(parsed.databaseCandidates[0], {
    id: databaseId,
    database_id: databaseId,
    title: "Writing",
    source: "database_mention",
    lineIndex: 1,
  });
});

test("parseGatewayBlocks renders Gateway free text as content", () => {
  const parsed = parseGatewayBlocks([
    heading("Agent Notes"),
    bullet("Inspect schemas just in time before writing rows."),
    bullet("Connections is intentionally unfinished for now. Do not infer a CRM schema."),
  ]);

  assert.equal(
    parsed.content,
    "## Agent Notes\n- Inspect schemas just in time before writing rows.\n- Connections is intentionally unfinished for now. Do not infer a CRM schema."
  );
});

function heading(text) {
  return { type: "heading_2", heading_2: { rich_text: [{ plain_text: text }] } };
}

function bullet(text) {
  return { type: "bulleted_list_item", bulleted_list_item: { rich_text: [{ plain_text: text }] } };
}
