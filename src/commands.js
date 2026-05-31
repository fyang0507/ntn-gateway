const { GatewayError } = require("./errors");
const { normalizeSchema, normalizePage } = require("./normalize");
const { buildPageProperties } = require("./properties");
const { blockPlainText } = require("./text");
const { markdownFromBlocks } = require("./markdown");
const { readJsonArg, readContentInput, blocksFromInput } = require("./io");

const MAX_BLOCK_DEPTH = 4;
const { buildAggregateQuery, firstPropertyOfType } = require("./query");

function bodyPreviewFromBlocks(blocks, limit = 8) {
  return blocks.map(blockPlainText).filter(Boolean).slice(0, limit);
}

function pageStatus(page) {
  for (const property of Object.values(page.properties || {})) {
    if (property.type === "status") return property.status?.name;
    if (property.type === "select" && /status/i.test(property.name || "")) return property.select?.name;
  }
  return undefined;
}

function classifyPage(page) {
  const status = Object.values(page.properties || {}).find((property) => property.type === "status")?.status?.name || "";
  const normalized = status.toLowerCase();
  if (["done", "complete", "completed"].includes(normalized)) return "completed_work";
  if (["not started", "planned", "backlog", "todo", "to do"].includes(normalized)) return "planning_candidates";
  return "commitments";
}

const DATABASE_TRACKING_REMINDER = "If this creates a new database for future agent work, add its canonical data source ID to the Gateway page so ntn-gateway can track it.";

class CommandHandlers {
  constructor({ api, gateway, stdin }) {
    this.api = api;
    this.gateway = gateway;
    this.stdin = stdin;
  }

  show() {
    return this.gateway.show();
  }

  async schema(dataSourceId) {
    await this.gateway.assertAllowedDataSource(dataSourceId);
    const schema = await this.api.retrieveDataSource(dataSourceId);
    return normalizeSchema(schema);
  }

  databaseCreate(title, dryRun) {
    if (!dryRun) {
      throw new GatewayError("dry_run_required", "Database creation is proposal-only in the first pass; pass --dry-run.");
    }
    return {
      dry_run: true,
      plan: {
        title,
        note: "Create the database in Notion, expose its canonical data source ID on the Gateway page, then operate through ntn-gateway.",
      },
    };
  }

  async pageGet(pageId) {
    const page = await this.api.retrievePage(pageId);
    await this.gateway.assertAllowedPage(page);
    const blocks = await this.retrieveBlockTree(pageId);
    return normalizePage(page, {
      content: markdownFromBlocks(blocks),
      preview: bodyPreviewFromBlocks(blocks),
    });
  }

  async retrieveBlockTree(blockId, depth = 0) {
    const blocks = await this.api.retrieveBlocks(blockId);
    if (depth >= MAX_BLOCK_DEPTH) return blocks;
    for (const block of blocks) {
      if (block.has_children && block[block.type]) {
        block[block.type].children = await this.retrieveBlockTree(block.id, depth + 1);
      }
    }
    return blocks;
  }

  async pageCreate(dataSourceId, title, propertiesArg, options = {}) {
    await this.gateway.assertAllowedDataSource(dataSourceId);
    const schema = normalizeSchema(await this.api.retrieveDataSource(dataSourceId));
    const input = readJsonArg(propertiesArg);
    const body = {
      parent: { type: "data_source_id", data_source_id: dataSourceId },
      properties: buildPageProperties(schema, title, input),
    };
    const content = await readContentInput(options, this.stdin);
    if (content !== undefined) {
      body.children = blocksFromInput(content);
    }
    if (options.dryRun) {
      return {
        dry_run: true,
        plan: { database: { id: dataSourceId, title: schema.title }, request: body },
      };
    }
    const page = await this.api.createPage(body);
    return {
      plan: { database: { id: dataSourceId, title: schema.title }, request: body },
      page: normalizePage(page),
      reminder: DATABASE_TRACKING_REMINDER,
    };
  }

  async pagePropertiesUpdate(pageId, propertiesArg, dryRun) {
    const current = await this.api.retrievePage(pageId);
    const registryEntry = await this.gateway.assertAllowedPage(current);
    const dataSourceId = current.parent.data_source_id || current.parent.database_id;
    const schema = normalizeSchema(await this.api.retrieveDataSource(dataSourceId));
    const input = readJsonArg(propertiesArg);
    const body = { properties: buildPageProperties(schema, undefined, input) };
    const plan = {
      page: normalizePage(current),
      database: { id: dataSourceId, title: registryEntry.title },
      request: body,
      dry_run: Boolean(dryRun),
    };
    if (dryRun) return { plan };
    const page = await this.api.updatePage(pageId, body);
    return { plan, page: normalizePage(page) };
  }

  async blockAppend(pageId, options = {}) {
    const page = await this.api.retrievePage(pageId);
    await this.gateway.assertAllowedPage(page);
    const raw = await readContentInput(options, this.stdin);
    if (raw === undefined) {
      throw new GatewayError("argument_missing", "block append requires --content or stdin.");
    }
    const children = blocksFromInput(raw);
    if (options.dryRun) {
      return {
        dry_run: true,
        page: { id: pageId },
        request: { block_id: pageId, children },
      };
    }
    const response = await this.api.appendBlocks(pageId, children);
    return {
      page: { id: pageId },
      appended_count: children.length,
      response,
    };
  }

  async aggregatePages(options) {
    const registry = await this.gateway.registry();
    const groups = {
      commitments: [],
      completed_work: [],
      stale_work: [],
      planning_candidates: [],
    };
    const queried = [];

    for (const entry of registry) {
      const schema = normalizeSchema(await this.api.retrieveDataSource(entry.id));
      const query = buildAggregateQuery(schema, options);
      if (query.__skip) {
        queried.push({ id: entry.id, title: entry.title, result_count: 0, skipped: "no_matching_status_options" });
        continue;
      }
      const results = await this.api.queryDataSource(entry.id, query);
      const dateName = firstPropertyOfType(schema, "date", ["Date", "Start Date", "Due", "Completed"]);
      queried.push({ id: entry.id, title: entry.title, result_count: results.length });

      for (const page of results) {
        const normalized = normalizePage(page);
        const group = classifyPage(page);
        groups[group].push({ database: { id: entry.id, title: entry.title }, page: normalized });

        if (options.since && dateName) {
          const value = normalized.properties[dateName]?.value?.start;
          const status = pageStatus(page);
          if (value && value < options.since && status && !["Done", "Complete", "Completed"].includes(status)) {
            groups.stale_work.push({ database: { id: entry.id, title: entry.title }, page: normalized });
          }
        }
      }
    }

    return { filters: options, queried, groups };
  }

}

module.exports = { CommandHandlers, bodyPreviewFromBlocks };
