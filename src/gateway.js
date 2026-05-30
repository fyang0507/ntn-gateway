const { GatewayError } = require("./errors");
const { blockPlainText, canonicalId, compactId } = require("./text");
const { normalizeSchema } = require("./normalize");

const RULE_TYPES = new Set(["paragraph", "bulleted_list_item", "numbered_list_item", "to_do", "quote", "callout"]);
const HEADING_TYPES = new Set(["heading_1", "heading_2", "heading_3"]);
const ID_PATTERN = /[a-f0-9]{8}-?[a-f0-9]{4}-?[a-f0-9]{4}-?[a-f0-9]{4}-?[a-f0-9]{12}/ig;

function blockTextWithChildren(block) {
  return blockPlainText(block).trim();
}

function collectMentions(block) {
  const value = block[block.type];
  const richText = value?.rich_text || [];
  const mentions = [];
  for (const item of richText) {
    if (item.type === "mention" && item.mention) {
      mentions.push(item.mention);
    }
  }
  return mentions;
}

function mentionedDatabaseId(mention) {
  if (mention.type === "database") return mention.database?.id;
  if (mention.type === "link_preview" && mention.link_preview?.url) {
    const match = mention.link_preview.url.match(/[a-f0-9]{32}/i);
    return match ? canonicalId(match[0]) : undefined;
  }
  return undefined;
}

function idsFromText(text) {
  return [...text.matchAll(ID_PATTERN)].map((match) => canonicalId(match[0]));
}

function titleBeforeId(text, id) {
  const compact = compactId(id);
  const parts = text.split("|").map((part) => part.trim()).filter(Boolean);
  return parts.find((part) => compactId(part) !== compact && !idsFromText(part).length) || undefined;
}

function markdownLine(block, text) {
  switch (block.type) {
    case "bulleted_list_item":
      return `- ${text}`;
    case "numbered_list_item":
      return `1. ${text}`;
    case "to_do":
      return `- [ ] ${text}`;
    case "quote":
    case "callout":
      return `> ${text}`;
    default:
      return text;
  }
}

function markdownFromLines(lines) {
  return lines.join("\n");
}

function pushLine(lines, line) {
  lines.push(line);
  return lines.length - 1;
}

function parseGatewayBlocks(blocks) {
  const contentLines = [];
  const databaseCandidates = new Map();
  let currentHeading = "";
  let currentHeadingLineIndex;

  for (const block of blocks) {
    const text = blockTextWithChildren(block);
    let contentLineIndex;
    if (HEADING_TYPES.has(block.type) && text) {
      currentHeading = text;
      currentHeadingLineIndex = pushLine(contentLines, `${"#".repeat(Number(block.type.slice(-1)))} ${text}`);
      continue;
    }

    if (RULE_TYPES.has(block.type) && text) {
      contentLineIndex = pushLine(contentLines, markdownLine(block, text));
    }

    if (block.type === "child_database") {
      const title = block.child_database?.title || text || "Untitled database";
      contentLineIndex = contentLineIndex ?? pushLine(contentLines, `- ${title}`);
      databaseCandidates.set(compactId(block.id), {
        id: block.id,
        title,
        source: "child_database_block",
        lineIndex: contentLineIndex,
      });
    }

    if (block.type === "link_to_page" && block.link_to_page?.type === "database_id") {
      const databaseId = block.link_to_page.database_id;
      databaseCandidates.set(compactId(databaseId), {
        id: databaseId,
        database_id: databaseId,
        title: currentHeading || "Linked database",
        source: "link_to_page_database",
        lineIndex: currentHeadingLineIndex,
      });
    }

    const ids = idsFromText(text);
    const operativeIds = block.type === "table_row" ? ids.slice(0, 1) : ids;
    for (const id of operativeIds) {
      if (block.type === "table_row") {
        const title = titleBeforeId(text, id) || text || "Mentioned database";
        contentLineIndex = contentLineIndex ?? pushLine(contentLines, `- ${title}`);
      }
      databaseCandidates.set(compactId(id), {
        id,
        title: titleBeforeId(text, id) || text || "Mentioned database",
        source: block.type === "table_row" ? "gateway_table_row" : "gateway_text",
        lineIndex: contentLineIndex,
      });
    }

    for (const mention of collectMentions(block)) {
      const id = mentionedDatabaseId(mention);
      if (id) {
        const isDatabaseMention = mention.type === "database";
        databaseCandidates.set(compactId(id), {
          id,
          database_id: isDatabaseMention ? id : undefined,
          title: currentHeading || text || "Mentioned database",
          source: "database_mention",
          lineIndex: contentLineIndex ?? currentHeadingLineIndex,
        });
      }
    }
  }

  return {
    content: markdownFromLines(contentLines),
    contentLines,
    databaseCandidates: [...databaseCandidates.values()],
  };
}

function publicUnresolvedDatabase(entry) {
  return {
    title: entry.title,
    id: entry.id,
    error: entry.error,
  };
}

function addInlineDatabaseReferences(contentLines, databases, unresolved) {
  const lines = [...contentLines];
  for (const database of databases) {
    if (!Number.isInteger(database.lineIndex) || !lines[database.lineIndex]) continue;
    if (compactId(lines[database.lineIndex]).includes(compactId(database.id))) continue;
    lines[database.lineIndex] = `${lines[database.lineIndex]}: ${database.id}`;
  }
  for (const database of unresolved) {
    if (!Number.isInteger(database.lineIndex) || !lines[database.lineIndex]) continue;
    lines[database.lineIndex] = `${lines[database.lineIndex]} (unresolved: ${database.error})`;
  }
  return markdownFromLines(lines);
}

function summarizeDatabase(candidate, schema) {
  const normalized = normalizeSchema(schema);
  return {
    title: normalized.title || candidate.title,
    id: normalized.id,
    kind: normalized.kind,
    database_id: schema.database_id || schema.parent?.database_id || (normalized.kind === "database" ? normalized.id : undefined),
    source: candidate.source,
    url: schema.url,
  };
}

async function settleCandidate(candidate, resolve) {
  try {
    return { ok: true, value: { ...await resolve(candidate), lineIndex: candidate.lineIndex } };
  } catch (error) {
    return { ok: false, value: { ...candidate, error: error.message } };
  }
}

class GatewayService {
  constructor(api, config) {
    this.api = api;
    this.config = config;
  }

  async show() {
    const page = await this.api.retrievePage(this.config.gatewayPageId);
    const blocks = await this.api.retrieveBlocks(this.config.gatewayPageId);
    const parsed = parseGatewayBlocks(blocks);
    const settled = await Promise.all(
      parsed.databaseCandidates.map((candidate) => settleCandidate(candidate, (item) => this.resolveCandidate(item)))
    );
    const databases = settled.filter((result) => result.ok).map((result) => result.value);
    const unresolved = settled.filter((result) => !result.ok).map((result) => result.value);

    return {
      gateway: {
        id: page.id,
        last_edited_time: page.last_edited_time,
      },
      content: addInlineDatabaseReferences(parsed.contentLines, databases, unresolved),
      unresolved_databases: unresolved.map(publicUnresolvedDatabase),
    };
  }

  async registry() {
    const blocks = await this.api.retrieveBlocks(this.config.gatewayPageId);
    const parsed = parseGatewayBlocks(blocks);
    const settled = await Promise.all(
      parsed.databaseCandidates.map((candidate) => settleCandidate(candidate, (item) => this.resolveCandidate(item)))
    );
    return settled.filter((result) => result.ok).map((result) => result.value);
  }

  async resolveCandidate(candidate) {
    if (candidate.database_id) {
      const database = await this.api.retrieveDatabase(candidate.database_id);
      const dataSource = database.data_sources?.[0];
      if (!dataSource?.id) {
        throw new GatewayError("gateway_database_unresolved", "Linked database does not expose a data source ID.", {
          database_id: candidate.database_id,
        });
      }
      const schema = await this.api.retrieveDataSource(dataSource.id);
      return {
        ...summarizeDatabase({ ...candidate, id: dataSource.id, title: dataSource.name || candidate.title }, schema),
        database_id: database.id,
      };
    }

    const schema = await this.api.retrieveDataSource(candidate.id);
    return summarizeDatabase(candidate, schema);
  }

  async assertAllowedDataSource(dataSourceId) {
    const registry = await this.registry();
    const found = registry.find((entry) => compactId(entry.id) === compactId(dataSourceId));
    if (!found) {
      throw new GatewayError("gateway_scope_rejected", "The data source is not exposed by the Gateway registry.", {
        data_source_id: dataSourceId,
        allowed: registry.map((entry) => ({ title: entry.title, id: entry.id })),
      });
    }
    return found;
  }

  async assertAllowedParent(parentId) {
    const registry = await this.registry();
    const found = registry.find((entry) => compactId(entry.id) === compactId(parentId) || compactId(entry.database_id) === compactId(parentId));
    if (!found) {
      throw new GatewayError("gateway_scope_rejected", "The data source is not exposed by the Gateway registry.", {
        data_source_id: parentId,
        allowed: registry.map((entry) => ({ title: entry.title, id: entry.id, database_id: entry.database_id })),
      });
    }
    return found;
  }

  async assertAllowedPage(page) {
    const parentId = page.parent?.data_source_id || page.parent?.database_id;
    if (!parentId) {
      throw new GatewayError("gateway_scope_rejected", "The page does not belong to a data source exposed by the Gateway registry.", {
        page_id: page.id,
        parent: page.parent,
      });
    }
    return this.assertAllowedParent(parentId);
  }
}

module.exports = { GatewayService, parseGatewayBlocks };
