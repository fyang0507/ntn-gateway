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

test("parseGatewayBlocks extracts database links with the preceding heading as title", () => {
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
    lineIndex: 0,
  });
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
