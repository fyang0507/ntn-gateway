const test = require("node:test");
const assert = require("node:assert/strict");
const { dispatch } = require("../src/cli");
const { CommandHandlers } = require("../src/commands");
const { GatewayService } = require("../src/gateway");
const { NotionGatewayApi } = require("../src/notion");

const gatewayId = "11111111-1111-1111-1111-111111111111";
const dataSourceId = "22222222-2222-2222-2222-222222222222";
const secondDataSourceId = "77777777-7777-7777-7777-777777777777";
const pageId = "33333333-3333-3333-3333-333333333333";

test("database schema rejects IDs absent from Gateway registry", async () => {
  await assert.rejects(
    dispatch(["database", "schema", "99999999-9999-9999-9999-999999999999"], context()),
    /not exposed by the Gateway registry/
  );
});

test("database create dry-run reminds agents to add the database as an inline mention", async () => {
  const result = await dispatch(["database", "create", "--title", "New area", "--dry-run"], context());

  assert.equal(result.dry_run, true);
  assert.equal(result.plan.title, "New area");
  assert.match(result.reminder, /inline @mention/);
  assert.match(result.reminder, /canonical data source ID/);
});

test("page create dry-run validates options and emits SDK request body", async () => {
  const result = await dispatch(
    ["page", "create", "--database", dataSourceId, "--title", "Ship gateway", "--properties", JSON.stringify({ Status: "In progress", Tags: ["Agent"] }), "--dry-run"],
    context()
  );

  assert.equal(result.dry_run, true);
  assert.deepEqual(result.plan.request.parent, { type: "data_source_id", data_source_id: dataSourceId });
  assert.deepEqual(result.plan.request.properties.Name.title[0].text.content, "Ship gateway");
  assert.deepEqual(result.plan.request.properties.Status, { status: { name: "In progress" } });
  assert.deepEqual(result.plan.request.properties.Tags, { multi_select: [{ name: "Agent" }] });
});

test("page create dry-run accepts body content", async () => {
  const result = await dispatch(
    ["page", "create", "--database", dataSourceId, "--title", "Ship gateway", "--content", "First\n\nSecond", "--dry-run"],
    context()
  );

  assert.equal(result.dry_run, true);
  assert.deepEqual(
    result.plan.request.children.map((block) => block.paragraph.rich_text[0].text.content),
    ["First", "Second"]
  );
});

test("page create dry-run converts source links to bookmark blocks", async () => {
  const sourceUrl = "https://claude.com/blog/using-claude-code-the-unreasonable-effectiveness-of-html";
  const result = await dispatch(
    ["page", "create", "--database", dataSourceId, "--title", "Ship gateway", "--content", `Source: [Using Claude Code](${sourceUrl})\n\nNotes`, "--dry-run"],
    context()
  );

  assert.equal(result.dry_run, true);
  assert.deepEqual(result.plan.request.children[0], {
    object: "block",
    type: "bookmark",
    bookmark: { url: sourceUrl, caption: [{ type: "text", text: { content: "Using Claude Code" } }] },
  });
  assert.equal(result.plan.request.children[1].paragraph.rich_text[0].text.content, "Notes");
});

test("page create dry-run keeps a bare source URL as a caption-less bookmark", async () => {
  const sourceUrl = "https://claude.com/blog/using-claude-code-the-unreasonable-effectiveness-of-html";
  const result = await dispatch(
    ["page", "create", "--database", dataSourceId, "--title", "Ship gateway", "--content", sourceUrl, "--dry-run"],
    context()
  );

  assert.deepEqual(result.plan.request.children[0], {
    object: "block",
    type: "bookmark",
    bookmark: { url: sourceUrl },
  });
});

test("page create dry-run converts inline markdown links to rich text links", async () => {
  const sourceUrl = "https://claude.com/blog/using-claude-code-the-unreasonable-effectiveness-of-html";
  const result = await dispatch(
    ["page", "create", "--database", dataSourceId, "--title", "Ship gateway", "--content", `Read [the article](${sourceUrl}) carefully.`, "--dry-run"],
    context()
  );

  assert.deepEqual(result.plan.request.children[0].paragraph.rich_text, [
    { type: "text", text: { content: "Read " } },
    { type: "text", text: { content: "the article", link: { url: sourceUrl } } },
    { type: "text", text: { content: " carefully." } },
  ]);
});

test("page create dry-run accepts body content from stdin", async () => {
  const result = await dispatch(
    ["page", "create", "--database", dataSourceId, "--title", "Ship gateway", "--stdin", "--dry-run"],
    context({ stdin: streamFrom("First\n\nSecond") })
  );

  assert.equal(result.dry_run, true);
  assert.deepEqual(
    result.plan.request.children.map((block) => block.paragraph.rich_text[0].text.content),
    ["First", "Second"]
  );
});

test("page create dry-run accepts piped body content without stdin flag", async () => {
  const result = await dispatch(
    ["page", "create", "--database", dataSourceId, "--title", "Ship gateway", "--dry-run"],
    context({ stdin: streamFrom("First\n\nSecond", { piped: true }) })
  );

  assert.equal(result.dry_run, true);
  assert.deepEqual(
    result.plan.request.children.map((block) => block.paragraph.rich_text[0].text.content),
    ["First", "Second"]
  );
});

test("page create success reminds agents to track new databases on the Gateway page", async () => {
  const result = await dispatch(
    ["page", "create", "--database", dataSourceId, "--title", "New database"],
    context()
  );

  assert.equal(result.page.id, "44444444-4444-4444-4444-444444444444");
  assert.match(result.reminder, /canonical data source ID/);
  assert.match(result.reminder, /Gateway page/);
});

test("page create is terse by default and omits the request echo", async () => {
  const result = await dispatch(
    ["page", "create", "--database", dataSourceId, "--title", "New database"],
    context()
  );

  assert.equal(result.page.id, "44444444-4444-4444-4444-444444444444");
  assert.equal(result.plan, undefined);
  assert.match(result.hint, /--verbose/);
});

test("page create --verbose echoes the full SDK request body and drops the hint", async () => {
  const result = await dispatch(
    ["page", "create", "--database", dataSourceId, "--title", "New database"],
    context(),
    { verbose: true }
  );

  assert.equal(result.page.id, "44444444-4444-4444-4444-444444444444");
  assert.equal(result.plan.database.id, dataSourceId);
  assert.deepEqual(result.plan.request.parent, { type: "data_source_id", data_source_id: dataSourceId });
  assert.equal(result.hint, undefined);
});

test("page create fails closed on invalid option values", async () => {
  await assert.rejects(
    dispatch(
      ["page", "create", "--database", dataSourceId, "--title", "Bad status", "--properties", JSON.stringify({ Status: "Maybe" }), "--dry-run"],
      context()
    ),
    /Invalid option/
  );
});

test("writing an existing select/multi_select option needs no flag and succeeds", async () => {
  const result = await dispatch(
    ["page", "create", "--database", dataSourceId, "--title", "Existing options", "--properties", JSON.stringify({ Priority: "High", Tags: ["Agent", "Research"] }), "--dry-run"],
    context()
  );

  assert.equal(result.dry_run, true);
  assert.deepEqual(result.plan.request.properties.Priority, { select: { name: "High" } });
  assert.deepEqual(result.plan.request.properties.Tags, { multi_select: [{ name: "Agent" }, { name: "Research" }] });
  // No new options were introduced, so the plan omits new_options entirely.
  assert.equal(result.plan.new_options, undefined);
});

test("a new select value without --allow-new-options fails with property_new_option carrying new + existing", async () => {
  const error = await dispatch(
    ["page", "create", "--database", dataSourceId, "--title", "New select", "--properties", JSON.stringify({ Priority: "Urgent" }), "--dry-run"],
    context()
  ).then(() => null, (err) => err);

  assert.ok(error, "expected the write to reject");
  assert.equal(error.code, "property_new_option");
  assert.deepEqual(error.details.new, ["Urgent"]);
  assert.deepEqual(error.details.existing, ["Low", "High"]);
  assert.equal(error.details.property, "Priority");
  assert.match(error.message, /--allow-new-options/);
});

test("a new multi_select value without --allow-new-options fails with all unrecognized values in new", async () => {
  const error = await dispatch(
    ["page", "create", "--database", dataSourceId, "--title", "New tags", "--properties", JSON.stringify({ Tags: ["Agent", "Spike", "Triage"] }), "--dry-run"],
    context()
  ).then(() => null, (err) => err);

  assert.ok(error, "expected the write to reject");
  assert.equal(error.code, "property_new_option");
  assert.deepEqual(error.details.new, ["Spike", "Triage"]);
  assert.deepEqual(error.details.existing, ["Agent", "Research"]);
});

test("a new select/multi_select value WITH --allow-new-options passes through unchanged", async () => {
  const result = await dispatch(
    ["page", "create", "--database", dataSourceId, "--title", "Create options", "--properties", JSON.stringify({ Priority: "Urgent", Tags: ["Spike"] }), "--allow-new-options", "--dry-run"],
    context()
  );

  assert.equal(result.dry_run, true);
  // coerceProperty already emits { name }; Notion auto-creates the option on write.
  assert.deepEqual(result.plan.request.properties.Priority, { select: { name: "Urgent" } });
  assert.deepEqual(result.plan.request.properties.Tags, { multi_select: [{ name: "Spike" }] });
});

test("dry-run plan previews which new options would be created under new_options", async () => {
  const result = await dispatch(
    ["page", "create", "--database", dataSourceId, "--title", "Preview options", "--properties", JSON.stringify({ Priority: "Urgent", Tags: ["Agent", "Spike"] }), "--allow-new-options", "--dry-run"],
    context()
  );

  assert.deepEqual(result.plan.new_options, [
    { property: "Priority", values: ["Urgent"] },
    { property: "Tags", values: ["Spike"] },
  ]);
});

test("page properties update dry-run reports new_options and applies with --allow-new-options", async () => {
  const result = await dispatch(
    ["page", "properties", "update", pageId, "--properties", JSON.stringify({ Priority: "Urgent" }), "--allow-new-options", "--dry-run"],
    context()
  );

  assert.deepEqual(result.plan.new_options, [{ property: "Priority", values: ["Urgent"] }]);

  const applied = await dispatch(
    ["page", "properties", "update", pageId, "--properties", JSON.stringify({ Priority: "Urgent" }), "--allow-new-options"],
    context()
  );
  assert.equal(applied.page.id, pageId);
});

test("a new status value still fails closed with property_option_invalid even with --allow-new-options", async () => {
  const error = await dispatch(
    ["page", "create", "--database", dataSourceId, "--title", "New status", "--properties", JSON.stringify({ Status: "Maybe" }), "--allow-new-options", "--dry-run"],
    context()
  ).then(() => null, (err) => err);

  assert.ok(error, "expected the write to reject");
  assert.equal(error.code, "property_option_invalid");
  assert.equal(error.details.value, "Maybe");
});

test("an unknown property name still fails with property_unknown regardless of --allow-new-options", async () => {
  const error = await dispatch(
    ["page", "create", "--database", dataSourceId, "--title", "Bad name", "--properties", JSON.stringify({ Nonexistent: "x" }), "--allow-new-options", "--dry-run"],
    context()
  ).then(() => null, (err) => err);

  assert.ok(error, "expected the write to reject");
  assert.equal(error.code, "property_unknown");
  assert.deepEqual(error.details.unknown, ["Nonexistent"]);
});

test("page get rejects pages outside Gateway-approved parents", async () => {
  await assert.rejects(
    dispatch(["page", "get", pageId], context({ pageParent: { type: "data_source_id", data_source_id: "99999999-9999-9999-9999-999999999999" } })),
    /not exposed by the Gateway registry/
  );
});

test("page get returns typed properties and full markdown content", async () => {
  const result = await dispatch(["page", "get", pageId], context());

  assert.equal(result.id, pageId);
  assert.equal(result.url, `https://notion.so/${pageId}`);
  assert.equal(result.properties.Status.value, "In progress");
  assert.equal(result.content, "Body preview");
  assert.equal(result.properties["Agent Notes"].value, "Saved for next month");
  assert.equal(result.last_edited_time, "2026-05-25T10:00:00.000Z");
  // Drops the redundant body_preview and the archived flag when the page is not archived.
  assert.equal(result.body_preview, undefined);
  assert.equal(result.archived, undefined);
});

test("page get returns the full body as clean Markdown blocks", async () => {
  const result = await dispatch(
    ["page", "get", pageId],
    context({
      pageBlocks: [
        { type: "heading_2", heading_2: { rich_text: [{ plain_text: "Status" }] } },
        { type: "bulleted_list_item", bulleted_list_item: { rich_text: [{ plain_text: "a" }] } },
        { type: "bulleted_list_item", bulleted_list_item: { rich_text: [{ plain_text: "b" }] } },
      ],
    })
  );

  assert.equal(result.content, "## Status\n\n- a\n- b");
});

test("block append converts markdown headings and bullets into native blocks", async () => {
  const result = await dispatch(
    ["block", "append", pageId, "--content", "## Status\n- a\n- b", "--dry-run"],
    context()
  );

  assert.deepEqual(
    result.request.children.map((block) => block.type),
    ["heading_2", "bulleted_list_item", "bulleted_list_item"]
  );
  assert.equal(result.request.children[0].heading_2.rich_text[0].text.content, "Status");
});

test("block append is terse by default: page_id, count, and block ids only", async () => {
  const result = await dispatch(
    ["block", "append", pageId, "--content", "First\n\nSecond"],
    context()
  );

  assert.equal(result.page_id, pageId);
  assert.equal(result.appended_count, 2);
  assert.equal(result.block_ids.length, 2);
  assert.equal(result.response, undefined);
  assert.match(result.hint, /--verbose/);
});

test("block append --verbose includes the full API response and drops the hint", async () => {
  const result = await dispatch(
    ["block", "append", pageId, "--content", "First\n\nSecond"],
    context(),
    { verbose: true }
  );

  assert.equal(result.appended_count, 2);
  assert.equal(result.response.results.length, 2);
  assert.equal(result.hint, undefined);
});

test("page get succeeds on the Gateway page itself (workspace parent, id match)", async () => {
  const result = await dispatch(["page", "get", gatewayId], context());

  assert.equal(result.id, gatewayId);
});

test("block append succeeds on the Gateway page itself", async () => {
  const result = await dispatch(
    ["block", "append", gatewayId, "--content", "First\n\nSecond"],
    context()
  );

  assert.equal(result.page_id, gatewayId);
  assert.equal(result.appended_count, 2);
});

test("page properties update on the Gateway page is rejected with a clear error", async () => {
  await assert.rejects(
    dispatch(
      ["page", "properties", "update", gatewayId, "--properties", JSON.stringify({ Status: "Done" })],
      context()
    ),
    /no database properties/
  );
});

test("page body replace dry-run returns a diff and counts without mutating", async () => {
  const deletedBlockIds = [];
  const result = await dispatch(
    ["page", "body", "replace", pageId, "--content", "## New\n- one", "--dry-run"],
    context({ deletedBlockIds, pageBlocks: pageBlocksWithIds() })
  );

  assert.equal(result.dry_run, true);
  assert.equal(result.page.id, pageId);
  assert.ok(Array.isArray(result.diff));
  // Diff is rendered-vs-rendered: the old heading/bullet are removed, the new ones added.
  assert.ok(result.diff.includes("-## Status"));
  assert.ok(result.diff.includes("+## New"));
  assert.equal(result.removed_block_count, 2);
  assert.equal(result.new_block_count, 2);
  assert.equal(deletedBlockIds.length, 0);
});

test("page body replace dry-run shows no diff churn for an identical body", async () => {
  // Supplying Markdown that re-renders to the same blocks should produce no +/- lines.
  const result = await dispatch(
    ["page", "body", "replace", pageId, "--content", "## Status\n- a", "--dry-run"],
    context({ pageBlocks: pageBlocksWithIds() })
  );

  assert.ok(result.diff.every((line) => line.startsWith(" ")));
});

test("page body replace counts nested children in the destroyed total", async () => {
  // 1 top-level toggle with 2 children = 3 destroyed blocks, but only 1 top-level delete.
  const deletedBlockIds = [];
  const result = await dispatch(
    ["page", "body", "replace", pageId, "--content", "## New", "--confirm"],
    context({
      deletedBlockIds,
      pageBlocks: [{ id: "block-toggle", type: "toggle", has_children: true, toggle: { rich_text: [{ plain_text: "More" }] } }],
      childBlocks: {
        "block-toggle": [
          { id: "block-child-1", type: "bulleted_list_item", bulleted_list_item: { rich_text: [{ plain_text: "x" }] } },
          { id: "block-child-2", type: "bulleted_list_item", bulleted_list_item: { rich_text: [{ plain_text: "y" }] } },
        ],
      },
    })
  );

  assert.equal(result.deleted_count, 3);
  assert.deepEqual(deletedBlockIds, ["block-toggle"]);
});

test("page body replace rejects empty/whitespace content before any mutation", async () => {
  const deletedBlockIds = [];
  await assert.rejects(
    dispatch(
      ["page", "body", "replace", pageId, "--content", "   \n  ", "--confirm"],
      context({ deletedBlockIds, pageBlocks: pageBlocksWithIds() })
    ),
    /No block content/
  );
  assert.equal(deletedBlockIds.length, 0);
});

test("page body replace refuses to apply without --confirm", async () => {
  await assert.rejects(
    dispatch(
      ["page", "body", "replace", pageId, "--content", "## New"],
      context({ pageBlocks: pageBlocksWithIds() })
    ),
    /--confirm/
  );
});

test("page body replace with --confirm appends new blocks and deletes all originals", async () => {
  const deletedBlockIds = [];
  const result = await dispatch(
    ["page", "body", "replace", pageId, "--content", "## New\n- one", "--confirm"],
    context({ deletedBlockIds, pageBlocks: pageBlocksWithIds() })
  );

  assert.equal(result.page_id, pageId);
  assert.equal(result.appended_count, 2);
  assert.equal(result.deleted_count, 2);
  assert.deepEqual(deletedBlockIds, ["block-aaa", "block-bbb"]);
  assert.match(result.hint, /--verbose/);
  assert.equal(result.response, undefined);
});

test("page body replace --verbose includes the append response and drops the hint", async () => {
  const result = await dispatch(
    ["page", "body", "replace", pageId, "--content", "## New", "--confirm"],
    context({ pageBlocks: pageBlocksWithIds() }),
    { verbose: true }
  );

  assert.ok(result.response.results.length >= 1);
  assert.equal(result.hint, undefined);
});

test("page body replace warns when the current body holds a child_database block", async () => {
  const result = await dispatch(
    ["page", "body", "replace", pageId, "--content", "## New", "--dry-run"],
    context({
      pageBlocks: [
        { id: "block-ccc", type: "child_database", child_database: { title: "Registry" } },
        { id: "block-bbb", type: "bulleted_list_item", bulleted_list_item: { rich_text: [{ plain_text: "b" }] } },
      ],
    })
  );

  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /child_database/);
  assert.match(result.warnings[0], /1 block/);
});

test("page properties update is terse by default and omits the change plan", async () => {
  const result = await dispatch(
    ["page", "properties", "update", pageId, "--properties", JSON.stringify({ Status: "Done" })],
    context()
  );

  assert.equal(result.page.id, pageId);
  assert.equal(result.plan, undefined);
  assert.match(result.hint, /--verbose/);
});

test("page properties update --verbose returns the change plan and drops the hint", async () => {
  const result = await dispatch(
    ["page", "properties", "update", pageId, "--properties", JSON.stringify({ Status: "Done" })],
    context(),
    { verbose: true }
  );

  assert.equal(result.page.id, pageId);
  assert.equal(result.plan.request.properties.Status.status.name, "Done");
  assert.equal(result.hint, undefined);
});

test("page properties update dry-run validates and returns a change plan", async () => {
  const result = await dispatch(
    ["page", "properties", "update", pageId, "--properties", JSON.stringify({ Status: "Done" }), "--dry-run"],
    context()
  );

  assert.equal(result.plan.dry_run, true);
  assert.equal(result.plan.request.properties.Status.status.name, "Done");
});

test("page update remains a compatibility alias for property updates", async () => {
  const result = await dispatch(
    ["page", "update", pageId, "--properties", JSON.stringify({ Status: "Done" }), "--dry-run"],
    context()
  );

  assert.equal(result.plan.dry_run, true);
  assert.equal(result.plan.request.properties.Status.status.name, "Done");
});

test("block append dry-run converts stdin text into append blocks", async () => {
  const result = await dispatch(
    ["block", "append", pageId, "--stdin", "--dry-run"],
    context({ stdin: streamFrom("First\n\nSecond") })
  );

  assert.equal(result.dry_run, true);
  assert.equal(result.request.children.length, 2);
});

test("block append dry-run accepts piped content without stdin flag", async () => {
  const result = await dispatch(
    ["block", "append", pageId, "--dry-run"],
    context({ stdin: streamFrom("First\n\nSecond", { piped: true }) })
  );

  assert.equal(result.dry_run, true);
  assert.equal(result.request.children.length, 2);
});

test("block append dry-run accepts content like page create", async () => {
  const result = await dispatch(
    ["block", "append", pageId, "--content", "First\n\nSecond", "--dry-run"],
    context()
  );

  assert.equal(result.dry_run, true);
  assert.deepEqual(
    result.request.children.map((block) => block.paragraph.rich_text[0].text.content),
    ["First", "Second"]
  );
});

test("content input rejects ambiguous sources", async () => {
  await assert.rejects(
    dispatch(
      ["block", "append", pageId, "--content", "First", "--stdin", "--dry-run"],
      context({ stdin: streamFrom("Second") })
    ),
    /cannot be used together/
  );
});

test("aggregate pages groups normalized results across the Gateway registry", async () => {
  const queriedDataSourceIds = [];
  const result = await dispatch(
    ["aggregate", "pages", "--status", "In progress"],
    context({ blocks: [...gatewayBlocks(), gatewayTableRow("Reference", secondDataSourceId)], queriedDataSourceIds })
  );

  assert.deepEqual(queriedDataSourceIds, [dataSourceId, secondDataSourceId]);
  assert.deepEqual(result.databases.map((entry) => entry.id), [dataSourceId, secondDataSourceId]);
  assert.equal(result.databases[0].by_status["In progress"].length, 1);
  assert.equal(result.databases[1].by_status["In progress"].length, 1);
});

test("aggregate pages groups rows by live Notion status and drops status from each record", async () => {
  const result = await dispatch(["aggregate", "pages", "--status", "In progress"], context());

  const db = result.databases[0];
  assert.equal(db.id, dataSourceId);
  const summary = db.by_status["In progress"][0];
  assert.deepEqual(Object.keys(summary).sort(), ["agent_notes", "id", "last_edited", "title"]);
  assert.equal(summary.id, pageId);
  assert.equal(summary.url, undefined);
  assert.equal(summary.title, "Gateway task");
  assert.equal(summary.status, undefined);
  assert.equal(summary.agent_notes, "Saved for next month");
  assert.equal(summary.last_edited, "2026-05-25");
  assert.match(result.hint, /--verbose/);
});

test("aggregate pages --verbose returns full normalized pages grouped by status", async () => {
  const result = await dispatch(
    ["aggregate", "pages", "--status", "In progress"],
    context(),
    { verbose: true }
  );

  const page = result.databases[0].by_status["In progress"][0];
  assert.equal(page.properties.Status.value, "In progress");
  // Full normalized page (not the compact aggregate summary) carries url/parent.
  assert.equal(page.url, `https://notion.so/${pageId}`);
});

test("aggregate pages applies a default per-database limit for context protection", async () => {
  const result = await dispatch(["aggregate", "pages"], context());

  assert.equal(result.limit, 10);
  assert.equal(result.databases[0].truncated, false);
  assert.equal(result.truncated, undefined);
});

test("aggregate pages caps per-database results and flags truncation with an actionable note", async () => {
  const many = Array.from({ length: 30 }, (_, index) =>
    notionPage(`page-${index}`, { type: "data_source_id", data_source_id: dataSourceId })
  );
  const result = await dispatch(["aggregate", "pages", "--limit", "5"], context({ queryResults: many }));

  assert.equal(result.limit, 5);
  assert.equal(result.databases[0].result_count, 5);
  assert.equal(result.databases[0].truncated, true);
  assert.equal(result.databases[0].by_status["In progress"].length, 5);
  assert.equal(result.truncated, true);
  assert.match(result.note, /--limit/);
});

test("aggregate pages hides completed work by default and queries only active statuses", async () => {
  let filter;
  const result = await dispatch(["aggregate", "pages"], context({ onQuery: (args) => { filter = args.filter; } }));

  const serialized = JSON.stringify(filter);
  assert.match(serialized, /In progress/);
  assert.match(serialized, /Not started/);
  assert.doesNotMatch(serialized, /Done/);
  assert.match(result.status_hint, /--all/);
});

test("aggregate pages --all includes every status and drops the completed-work hint", async () => {
  let filter = "unset";
  const result = await dispatch(["aggregate", "pages", "--all"], context({ onQuery: (args) => { filter = args.filter; } }));

  assert.equal(filter, undefined);
  assert.equal(result.status_hint, undefined);
});

test("an explicit --status request suppresses the completed-work hint", async () => {
  const result = await dispatch(["aggregate", "pages", "--status", "Done"], context());

  assert.equal(result.status_hint, undefined);
});

test("aggregate pages rejects a non-positive --limit", async () => {
  await assert.rejects(
    dispatch(["aggregate", "pages", "--limit", "0"], context()),
    /positive integer/
  );
});

test("aggregate pages rejects the single-database --database flag", async () => {
  await assert.rejects(
    dispatch(["aggregate", "pages", "--database", dataSourceId], context()),
    /--databases/
  );
});

test("aggregate pages can scope to a subset of databases by id", async () => {
  const result = await dispatch(
    ["aggregate", "pages", "--databases", secondDataSourceId],
    context({ blocks: [...gatewayBlocks(), gatewayTableRow("Reference", secondDataSourceId)] })
  );

  assert.deepEqual(result.databases.map((entry) => entry.id), [secondDataSourceId]);
});

test("aggregate pages --databases also matches by title", async () => {
  const result = await dispatch(["aggregate", "pages", "--databases", "Technical Projects"], context());

  assert.deepEqual(result.databases.map((entry) => entry.id), [dataSourceId]);
});

test("aggregate pages fails closed when --databases names an unapproved database", async () => {
  await assert.rejects(
    dispatch(["aggregate", "pages", "--databases", "99999999-9999-9999-9999-999999999999"], context()),
    /not in the Gateway registry/
  );
});

test("aggregate pages skips databases with no matching requested status options", async () => {
  const result = await dispatch(["aggregate", "pages", "--status", "Blocked"], context());

  assert.equal(result.databases[0].skipped, "no_matching_status_options");
  assert.equal(result.databases[0].by_status, undefined);
});

test("aggregate pages --date-filter builds property and timestamp clauses", async () => {
  let filter;
  await dispatch(
    [
      "aggregate",
      "pages",
      "--all",
      "--date-filter",
      JSON.stringify({
        start: { after: "2026-01-01" },
        end: { before: "2026-06-30" },
        edited: { after: "2026-05-01" },
        created: { before: "2026-05-31" },
      }),
    ],
    context({ onQuery: (args) => { filter = args.filter; } })
  );

  // --all drops the status filter, so the date clauses stand alone, AND-combined in field order.
  assert.deepEqual(filter, {
    and: [
      { property: "Start Date", date: { on_or_after: "2026-01-01" } },
      { property: "End Date", date: { on_or_before: "2026-06-30" } },
      { timestamp: "last_edited_time", last_edited_time: { on_or_after: "2026-05-01" } },
      { timestamp: "created_time", created_time: { on_or_before: "2026-05-31" } },
    ],
  });
});

test("aggregate pages --date-filter AND-combines with the status filter", async () => {
  let filter;
  await dispatch(
    ["aggregate", "pages", "--date-filter", JSON.stringify({ start: { after: "2026-01-01" } })],
    context({ onQuery: (args) => { filter = args.filter; } })
  );

  const serialized = JSON.stringify(filter);
  assert.match(serialized, /"Start Date"/);
  assert.match(serialized, /on_or_after/);
  // The default active-status filter is still present alongside the date clause.
  assert.match(serialized, /In progress/);
});

test("aggregate pages echoes the parsed date_filter in filters", async () => {
  const result = await dispatch(
    ["aggregate", "pages", "--all", "--date-filter", JSON.stringify({ end: { before: "2026-06-30" } })],
    context()
  );

  assert.deepEqual(result.filters.date_filter, { end: { before: "2026-06-30" } });
});

test("aggregate pages rejects an unknown date-filter field", async () => {
  await assert.rejects(
    dispatch(["aggregate", "pages", "--date-filter", JSON.stringify({ due: { after: "2026-01-01" } })], context()),
    /Unknown date field "due"/
  );
});

test("aggregate pages rejects a malformed date-filter bound value", async () => {
  await assert.rejects(
    dispatch(["aggregate", "pages", "--date-filter", JSON.stringify({ start: { after: "2026/01/01" } })], context()),
    /YYYY-MM-DD/
  );
});

test("aggregate pages rejects an invalid date-filter bound name", async () => {
  await assert.rejects(
    dispatch(["aggregate", "pages", "--date-filter", JSON.stringify({ start: { on: "2026-01-01" } })], context()),
    /valid bound/
  );
});

test("aggregate pages rejects a non-object date-filter", async () => {
  await assert.rejects(
    dispatch(["aggregate", "pages", "--date-filter", JSON.stringify(["start"])], context()),
    /must be a JSON object/
  );
});

test("aggregate pages rejects --date-filter without a value", async () => {
  await assert.rejects(
    dispatch(["aggregate", "pages", "--date-filter"], context()),
    /--date-filter requires a JSON object/
  );
});

test("aggregate pages excludes the Connections database from the default sweep", async () => {
  const connectionsId = "88888888-8888-8888-8888-888888888888";
  const queriedDataSourceIds = [];
  const result = await dispatch(
    ["aggregate", "pages", "--all"],
    context({
      blocks: [...gatewayBlocks(), gatewayTableRow("Connections", connectionsId)],
      dataSourceTitles: { [connectionsId]: "Connections" },
      queriedDataSourceIds,
    })
  );

  assert.deepEqual(result.databases.map((entry) => entry.id), [dataSourceId]);
  assert.deepEqual(queriedDataSourceIds, [dataSourceId]);
  assert.deepEqual(result.skipped, [{ id: connectionsId, title: "Connections", reason: "non_ticketing_db" }]);
});

test("aggregate pages includes Connections when it is named explicitly in --databases", async () => {
  const connectionsId = "88888888-8888-8888-8888-888888888888";
  const result = await dispatch(
    ["aggregate", "pages", "--all", "--databases", "Connections"],
    context({
      blocks: [...gatewayBlocks(), gatewayTableRow("Connections", connectionsId)],
      dataSourceTitles: { [connectionsId]: "Connections" },
    })
  );

  assert.deepEqual(result.databases.map((entry) => entry.id), [connectionsId]);
  assert.equal(result.skipped, undefined);
});

test("aggregate pages surfaces a per-database query error without aborting the sweep", async () => {
  const result = await dispatch(
    ["aggregate", "pages", "--all"],
    context({
      blocks: [...gatewayBlocks(), gatewayTableRow("Reference", secondDataSourceId)],
      onQuery: (args) => {
        if (args.data_source_id === secondDataSourceId) {
          throw new Error("Could not find property with name or id: Start Date");
        }
      },
    })
  );

  assert.equal(result.databases[0].id, dataSourceId);
  assert.ok(result.databases[0].by_status);
  assert.equal(result.databases[1].id, secondDataSourceId);
  assert.match(result.databases[1].error, /Could not find property/);
});

test("workflow presets are not part of the CLI surface", async () => {
  await assert.rejects(
    dispatch(["workflow", "run", "morning-brief", "--date", "today"], context()),
    /Unknown command/
  );
});

test("Gateway database links are resolved to canonical data source IDs", async () => {
  const linkedDatabaseId = "55555555-5555-5555-5555-555555555555";
  const linkedDataSourceId = "66666666-6666-6666-6666-666666666666";
  const result = await dispatch(
    ["show"],
    context({
      blocks: [
        gatewayBlocks()[0],
        gatewayBlocks()[1],
        {
          type: "heading_1",
          heading_1: { rich_text: [{ plain_text: "Linked Projects" }] },
        },
        {
          type: "link_to_page",
          link_to_page: { type: "database_id", database_id: linkedDatabaseId },
        },
      ],
      databaseSources: {
        [linkedDatabaseId]: { id: linkedDataSourceId, name: "Linked Projects" },
      },
    })
  );

  assert.equal(result.databases, undefined);
  assert.equal(result.gateway.url, undefined);
  assert.equal(result.gateway_markdown, undefined);
  assert.doesNotMatch(result.content, /Gateway Registry/);
  // The linked database gets its own line with the resolved data-source name + canonical id,
  // and the id is NOT glued onto the heading.
  assert.match(result.content, /# Linked Projects\n- Technical Projects: 66666666-6666-6666-6666-666666666666/);
  assert.doesNotMatch(result.content, /# Linked Projects: /);
});

test("Gateway page links render as resolved title plus a [[page-id]] reference", async () => {
  const linkedPageId = "cb43fc31-7a14-4cc2-b1d4-864c169e1a12";
  const result = await dispatch(
    ["show"],
    context({
      blocks: [
        { type: "heading_1", heading_1: { rich_text: [{ plain_text: "Related work" }] } },
        { type: "link_to_page", link_to_page: { type: "page_id", page_id: linkedPageId } },
      ],
    })
  );

  // notionPage() titles non-gateway pages "Gateway task"; the id is NOT glued onto the heading.
  assert.match(result.content, /# Related work\n- Gateway task \[\[cb43fc31-7a14-4cc2-b1d4-864c169e1a12\]\]/);
  assert.doesNotMatch(result.content, /# Related work: /);
});

test("show resolves Gateway references in parallel", async () => {
  let active = 0;
  let maxActive = 0;
  const result = await dispatch(
    ["show"],
    context({
      blocks: [
        gatewayBlocks()[0],
        gatewayTableRow("Technical Projects", dataSourceId),
        gatewayTableRow("Reference", secondDataSourceId),
      ],
      onDataSourceRetrieve: async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 10));
        active -= 1;
      },
    })
  );

  assert.equal(result.databases, undefined);
  assert.equal(maxActive, 2);
  assert.equal(result.gateway_markdown, undefined);
  assert.doesNotMatch(result.content, /Gateway Registry/);
  assert.match(result.content, /Technical Projects: 22222222-2222-2222-2222-222222222222/);
  assert.match(result.content, /77777777-7777-7777-7777-777777777777/);
});

function context(options = {}) {
  const api = new NotionGatewayApi(mockClient(options));
  const gateway = new GatewayService(api, { gatewayPageId: gatewayId });
  const handlers = new CommandHandlers({ api, gateway, stdin: options.stdin });
  return { handlers };
}

function streamFrom(text, options = {}) {
  const { Readable } = require("node:stream");
  const stream = Readable.from([text]);
  if (options.piped) stream.isTTY = false;
  return stream;
}

function mockClient(options = {}) {
  const pageParent = options.pageParent || { type: "data_source_id", data_source_id: dataSourceId };
  const databaseSources = options.databaseSources || {};
  return {
    pages: {
      retrieve: async ({ page_id }) => {
        if (page_id === gatewayId) return gatewayPage();
        return notionPage(page_id, pageParent);
      },
      create: async (request) => notionPage("44444444-4444-4444-4444-444444444444", request.parent),
      update: async ({ page_id }) => notionPage(page_id, pageParent),
    },
    blocks: {
      children: {
        list: async ({ block_id }) => {
          if (block_id === gatewayId) {
            return { has_more: false, results: options.blocks || gatewayBlocks() };
          }
          if (options.childBlocks && options.childBlocks[block_id]) {
            return { has_more: false, results: options.childBlocks[block_id] };
          }
          return {
            has_more: false,
            results: options.pageBlocks || [{ type: "paragraph", paragraph: { rich_text: [{ plain_text: "Body preview" }] } }],
          };
        },
        append: async ({ children }) => ({
          results: children.map((child, index) => ({ ...child, id: `block-${index}` })),
        }),
      },
      delete: async ({ block_id }) => {
        if (options.deletedBlockIds) options.deletedBlockIds.push(block_id);
        return { id: block_id, archived: true };
      },
    },
    dataSources: {
      retrieve: async ({ data_source_id }) => {
        if (options.onDataSourceRetrieve) await options.onDataSourceRetrieve(data_source_id);
        return dataSource(data_source_id, (options.dataSourceTitles || {})[data_source_id]);
      },
      query: async (args) => {
        if (options.queriedDataSourceIds) options.queriedDataSourceIds.push(args.data_source_id);
        if (options.onQuery) options.onQuery(args);
        return {
          has_more: Boolean(options.queryHasMore),
          results: options.queryResults || [notionPage(pageId, pageParent)],
        };
      },
    },
    databases: {
      retrieve: async ({ database_id }) => ({
        id: database_id,
        object: "database",
        title: [{ plain_text: "Linked Projects" }],
        data_sources: [databaseSources[database_id] || { id: dataSourceId, name: "Technical Projects" }],
      }),
    },
  };
}

function pageBlocksWithIds() {
  return [
    { id: "block-aaa", type: "heading_2", heading_2: { rich_text: [{ plain_text: "Status" }] } },
    { id: "block-bbb", type: "bulleted_list_item", bulleted_list_item: { rich_text: [{ plain_text: "a" }] } },
  ];
}

function gatewayPage() {
  return {
    id: gatewayId,
    url: "https://notion.so/gateway",
    properties: {
      Name: { type: "title", title: [{ plain_text: "Gateway" }] },
    },
  };
}

function gatewayBlocks() {
  return [
    { type: "heading_2", heading_2: { rich_text: [{ plain_text: "Operating rules" }] } },
    { type: "bulleted_list_item", bulleted_list_item: { rich_text: [{ plain_text: "Use Gateway registry only." }] } },
    gatewayTableRow("Technical Projects", dataSourceId),
  ];
}

function gatewayTableRow(title, id) {
  return {
    type: "table_row",
    table_row: {
      cells: [
        [{ plain_text: title }],
        [{ plain_text: id }],
        [{ plain_text: "55555555-5555-5555-5555-555555555555" }],
      ],
    },
  };
}

function dataSource(id, title = "Technical Projects") {
  return {
    id,
    object: "data_source",
    title: [{ plain_text: title }],
    properties: {
      Name: { id: "title", type: "title", title: {} },
      Status: {
        id: "status",
        type: "status",
        status: { options: [{ name: "Not started" }, { name: "In progress" }, { name: "Done" }] },
      },
      Tags: {
        id: "tags",
        type: "multi_select",
        multi_select: { options: [{ name: "Agent" }, { name: "Research" }] },
      },
      Priority: {
        id: "priority",
        type: "select",
        select: { options: [{ name: "Low" }, { name: "High" }] },
      },
      "Start Date": { id: "start", type: "date", date: {} },
      "End Date": { id: "end", type: "date", date: {} },
    },
  };
}

function notionPage(id, parent) {
  return {
    id,
    url: `https://notion.so/${id}`,
    parent,
    last_edited_time: "2026-05-25T10:00:00.000Z",
    properties: {
      Name: { type: "title", title: [{ plain_text: "Gateway task" }] },
      Status: { type: "status", status: { name: "In progress" } },
      Due: { type: "date", date: { start: "2026-05-20" } },
      "Agent Notes": { type: "rich_text", rich_text: [{ plain_text: "Saved for next month" }] },
    },
  };
}
