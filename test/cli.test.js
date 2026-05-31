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

test("page create fails closed on invalid option values", async () => {
  await assert.rejects(
    dispatch(
      ["page", "create", "--database", dataSourceId, "--title", "Bad status", "--properties", JSON.stringify({ Status: "Maybe" }), "--dry-run"],
      context()
    ),
    /Invalid option/
  );
});

test("page get rejects pages outside Gateway-approved parents", async () => {
  await assert.rejects(
    dispatch(["page", "get", pageId], context({ pageParent: { type: "data_source_id", data_source_id: "99999999-9999-9999-9999-999999999999" } })),
    /not exposed by the Gateway registry/
  );
});

test("page get returns compact properties, full markdown content, and body preview", async () => {
  const result = await dispatch(["page", "get", pageId], context());

  assert.equal(result.id, pageId);
  assert.equal(result.properties.Status.value, "In progress");
  assert.equal(result.content, "Body preview");
  assert.deepEqual(result.body_preview, ["Body preview"]);
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
  assert.deepEqual(result.queried.map((entry) => entry.id), [dataSourceId, secondDataSourceId]);
  assert.equal(result.groups.commitments.length, 2);
});

test("aggregate pages rejects single-database filters", async () => {
  await assert.rejects(
    dispatch(["aggregate", "pages", "--database", dataSourceId], context()),
    /cross-database command/
  );
});

test("aggregate pages skips databases with no matching requested status options", async () => {
  const result = await dispatch(["aggregate", "pages", "--status", "Blocked"], context());

  assert.equal(result.queried[0].skipped, "no_matching_status_options");
  assert.equal(result.groups.commitments.length, 0);
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
          return {
            has_more: false,
            results: options.pageBlocks || [{ type: "paragraph", paragraph: { rich_text: [{ plain_text: "Body preview" }] } }],
          };
        },
        append: async ({ children }) => ({ results: children }),
      },
    },
    dataSources: {
      retrieve: async ({ data_source_id }) => {
        if (options.onDataSourceRetrieve) await options.onDataSourceRetrieve(data_source_id);
        return dataSource(data_source_id);
      },
      query: async ({ data_source_id }) => {
        if (options.queriedDataSourceIds) options.queriedDataSourceIds.push(data_source_id);
        return { has_more: false, results: [notionPage(pageId, pageParent)] };
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

function dataSource(id) {
  return {
    id,
    object: "data_source",
    title: [{ plain_text: "Technical Projects" }],
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
        multi_select: { options: [{ name: "Agent" }] },
      },
      Due: { id: "due", type: "date", date: {} },
    },
  };
}

function notionPage(id, parent) {
  return {
    id,
    url: `https://notion.so/${id}`,
    parent,
    properties: {
      Name: { type: "title", title: [{ plain_text: "Gateway task" }] },
      Status: { type: "status", status: { name: "In progress" } },
      Due: { type: "date", date: { start: "2026-05-20" } },
    },
  };
}
