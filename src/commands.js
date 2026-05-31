const { GatewayError } = require("./errors");
const { normalizeSchema, normalizePage } = require("./normalize");
const { buildPageProperties } = require("./properties");
const { canonicalId } = require("./text");
const { markdownFromBlocks } = require("./markdown");
const { readJsonArg, readContentInput, blocksFromInput } = require("./io");

const MAX_BLOCK_DEPTH = 4;
const { buildAggregateQuery, firstPropertyOfType } = require("./query");

function pageStatus(page) {
  for (const property of Object.values(page.properties || {})) {
    if (property.type === "status") return property.status?.name;
    if (property.type === "select" && /status/i.test(property.name || "")) return property.select?.name;
  }
  return undefined;
}

function pageTitle(normalized) {
  const entry = Object.values(normalized.properties || {}).find((property) => property.type === "title");
  return entry ? entry.value : undefined;
}

function agentNotes(normalized) {
  const entry = Object.entries(normalized.properties || {}).find(([name]) => /agent\s*notes?/i.test(name));
  return entry ? entry[1].value : undefined;
}

function compactPageSummary(page, normalized) {
  // Status is omitted on purpose: aggregate groups rows by status, so repeating it per record is noise.
  const summary = {
    id: page.id,
    title: pageTitle(normalized),
  };
  // Date-only (drop the time + offset) keeps the per-record footprint small in aggregate roll-ups.
  if (page.last_edited_time) summary.last_edited = page.last_edited_time.slice(0, 10);
  const notes = agentNotes(normalized);
  if (notes !== undefined && notes !== null && notes !== "") summary.agent_notes = notes;
  return summary;
}

const DATABASE_TRACKING_REMINDER = "After creating a database for future agent work, add it to the Gateway page as an inline @mention (type @ and pick the database, not a link-to-page block) so future agents can resolve its name and canonical data source ID via ntn-gateway show.";

const VERBOSE_HINT = "Terse view. Re-run with --verbose (or --format full) for the full Notion API request/response and full page properties.";

const DEFAULT_AGGREGATE_LIMIT = 10;

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
        note: "Create the database in Notion, then add it to the Gateway page so ntn-gateway can operate on it.",
      },
      reminder: DATABASE_TRACKING_REMINDER,
    };
  }

  async pageGet(pageId) {
    const page = await this.api.retrievePage(pageId);
    await this.gateway.assertAllowedPage(page);
    const blocks = await this.retrieveBlockTree(pageId);
    const result = normalizePage(page, { content: markdownFromBlocks(blocks) });
    // archived:false is the no-op common case; surface the flag only when the page is archived.
    if (!result.archived) delete result.archived;
    return result;
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
    const result = {
      page: normalizePage(page),
      reminder: DATABASE_TRACKING_REMINDER,
    };
    if (options.verbose) {
      result.plan = { database: { id: dataSourceId, title: schema.title }, request: body };
    } else {
      result.hint = VERBOSE_HINT;
    }
    return result;
  }

  async pagePropertiesUpdate(pageId, propertiesArg, dryRun, verbose = false) {
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
    const result = { page: normalizePage(page) };
    if (verbose) result.plan = plan;
    else result.hint = VERBOSE_HINT;
    return result;
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
    const result = {
      page_id: pageId,
      appended_count: children.length,
      block_ids: (response.results || []).map((block) => block.id).filter(Boolean),
    };
    if (options.verbose) result.response = response;
    else result.hint = VERBOSE_HINT;
    return result;
  }

  selectDatabases(registry, spec) {
    if (!spec) return registry;
    const tokens = spec.split(",").map((token) => token.trim()).filter(Boolean);
    const selected = [];
    for (const token of tokens) {
      const match = registry.find(
        (entry) => canonicalId(entry.id) === canonicalId(token) || entry.title.toLowerCase() === token.toLowerCase()
      );
      if (!match) {
        throw new GatewayError("argument_invalid", `Database "${token}" is not in the Gateway registry. Run ntn-gateway show to see approved databases.`);
      }
      if (!selected.includes(match)) selected.push(match);
    }
    return selected;
  }

  async aggregatePages(options) {
    const registry = this.selectDatabases(await this.gateway.registry(), options.databases);
    const limit = options.limit ?? DEFAULT_AGGREGATE_LIMIT;
    const databases = [];
    let truncatedAny = false;

    for (const entry of registry) {
      const schema = normalizeSchema(await this.api.retrieveDataSource(entry.id));
      const query = buildAggregateQuery(schema, options);
      if (query.__skip) {
        databases.push({ id: entry.id, title: entry.title, result_count: 0, skipped: "no_matching_status_options" });
        continue;
      }
      const { results, truncated } = await this.api.queryDataSource(entry.id, query, { limit });
      if (truncated) truncatedAny = true;

      // Group rows by database (named once), then by their live Notion status value.
      const byStatus = {};
      for (const page of results) {
        const normalized = normalizePage(page);
        const view = options.verbose ? normalized : compactPageSummary(page, normalized);
        const status = pageStatus(page) || "No status";
        (byStatus[status] ||= []).push(view);
      }

      const dbEntry = { id: entry.id, title: entry.title, result_count: results.length, truncated };
      if (Object.keys(byStatus).length > 0) dbEntry.by_status = byStatus;
      databases.push(dbEntry);
    }

    const result = { filters: options, limit, databases };
    if (truncatedAny) {
      result.truncated = true;
      result.note = `Results capped at ${limit} per database (most-recently-edited first). Narrow with --status/--since/--until or raise --limit to see more.`;
    }
    if (!options.status && !options.allStatus) {
      result.status_hint = 'Completed work is hidden by default. Pass --all for every status, or --status "Done" for just completed tasks.';
    }
    if (!options.verbose) result.hint = VERBOSE_HINT;
    return result;
  }

}

module.exports = { CommandHandlers };
