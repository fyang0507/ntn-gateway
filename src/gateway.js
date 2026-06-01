const { GatewayError } = require("./errors");
const { blockPlainText, canonicalId, compactId, plainTextFromRichText } = require("./text");
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
      mentions.push({ mention: item.mention, name: (item.plain_text || "").trim() });
    }
  }
  return mentions;
}

function pageTitle(page) {
  const titleProperty = Object.values(page.properties || {}).find((property) => property.type === "title");
  return plainTextFromRichText(titleProperty?.title || []).trim() || "Untitled page";
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
  const pageCandidates = new Map();
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

    if (block.type === "link_to_page") {
      const link = block.link_to_page || {};
      if (link.type === "database_id" && !databaseCandidates.has(compactId(link.database_id))) {
        // The block carries no name; resolve it later and render on its own line
        // rather than gluing the id onto the preceding heading.
        databaseCandidates.set(compactId(link.database_id), {
          id: link.database_id,
          database_id: link.database_id,
          title: currentHeading || "Linked database",
          source: "link_to_page_database",
          lineIndex: pushLine(contentLines, ""),
          ownsLine: true,
        });
      } else if (link.type === "page_id" && !pageCandidates.has(compactId(link.page_id))) {
        pageCandidates.set(compactId(link.page_id), {
          id: canonicalId(link.page_id),
          title: currentHeading || "Linked page",
          source: "link_to_page",
          lineIndex: pushLine(contentLines, ""),
          ownsLine: true,
        });
      }
      continue;
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

    for (const { mention, name } of collectMentions(block)) {
      // A mention that is alone on its line owns that line, so it renders as a
      // bullet ("- Name: id" / "- Name [[id]]") consistent with link_to_page links.
      const aloneOnLine = Boolean(name) && contentLineIndex !== undefined && text.trim() === name.trim();
      const databaseId = mentionedDatabaseId(mention);
      if (databaseId) {
        const isDatabaseMention = mention.type === "database";
        const candidate = {
          id: databaseId,
          database_id: isDatabaseMention ? databaseId : undefined,
          title: name || currentHeading || text || "Mentioned database",
          source: "database_mention",
          lineIndex: contentLineIndex ?? currentHeadingLineIndex,
        };
        if (aloneOnLine) candidate.ownsLine = true;
        databaseCandidates.set(compactId(databaseId), candidate);
      } else if (mention.type === "page" && mention.page?.id) {
        const candidate = {
          id: canonicalId(mention.page.id),
          title: name || currentHeading || "Linked page",
          source: "page_mention",
          lineIndex: contentLineIndex ?? currentHeadingLineIndex,
        };
        if (aloneOnLine) candidate.ownsLine = true;
        pageCandidates.set(compactId(mention.page.id), candidate);
      }
    }
  }

  return {
    content: markdownFromLines(contentLines),
    contentLines,
    databaseCandidates: [...databaseCandidates.values()],
    pageCandidates: [...pageCandidates.values()],
  };
}

function publicUnresolvedDatabase(entry) {
  return {
    title: entry.title,
    id: entry.id,
    error: entry.error,
  };
}

function renderGatewayContent(contentLines, { databases, unresolvedDatabases, pages, unresolvedPages }) {
  const lines = [...contentLines];

  const setLine = (entry, line) => {
    if (Number.isInteger(entry.lineIndex)) lines[entry.lineIndex] = line;
  };
  const appendToLine = (entry, suffix) => {
    if (!Number.isInteger(entry.lineIndex) || !lines[entry.lineIndex]) return;
    lines[entry.lineIndex] = `${lines[entry.lineIndex]}${suffix}`;
  };

  for (const database of databases) {
    if (database.ownsLine) {
      setLine(database, `- ${database.title}: ${database.id}`);
    } else if (!compactId(lines[database.lineIndex] || "").includes(compactId(database.id))) {
      appendToLine(database, `: ${database.id}`);
    }
  }
  for (const page of pages) {
    const reference = `[[${page.id}]]`;
    if (page.ownsLine) {
      setLine(page, `- ${page.title} ${reference}`);
    } else if (!(lines[page.lineIndex] || "").includes(reference)) {
      appendToLine(page, ` ${reference}`);
    }
  }
  for (const database of unresolvedDatabases) {
    if (database.ownsLine) setLine(database, `- ${database.title} (unresolved: ${database.error})`);
    else appendToLine(database, ` (unresolved: ${database.error})`);
  }
  for (const page of unresolvedPages) {
    if (page.ownsLine) setLine(page, `- ${page.title} (unresolved: ${page.error})`);
    else appendToLine(page, ` (unresolved: ${page.error})`);
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
    return {
      ok: true,
      value: { ...await resolve(candidate), lineIndex: candidate.lineIndex, ownsLine: candidate.ownsLine },
    };
  } catch (error) {
    return { ok: false, value: { ...candidate, error: error.message } };
  }
}

function publicUnresolvedPage(entry) {
  return {
    title: entry.title,
    id: entry.id,
    error: entry.error,
  };
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
    const settledDatabases = await Promise.all(
      parsed.databaseCandidates.map((candidate) => settleCandidate(candidate, (item) => this.resolveCandidate(item)))
    );
    const settledPages = await Promise.all(
      (parsed.pageCandidates || []).map((candidate) => settleCandidate(candidate, (item) => this.resolvePage(item)))
    );
    const databases = settledDatabases.filter((result) => result.ok).map((result) => result.value);
    const unresolvedDatabases = settledDatabases.filter((result) => !result.ok).map((result) => result.value);
    const pages = settledPages.filter((result) => result.ok).map((result) => result.value);
    const unresolvedPages = settledPages.filter((result) => !result.ok).map((result) => result.value);

    return {
      gateway: {
        id: page.id,
        last_edited_time: page.last_edited_time,
      },
      content: renderGatewayContent(parsed.contentLines, { databases, unresolvedDatabases, pages, unresolvedPages }),
      unresolved_databases: unresolvedDatabases.map(publicUnresolvedDatabase),
      unresolved_pages: unresolvedPages.map(publicUnresolvedPage),
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

  async resolvePage(candidate) {
    const page = await this.api.retrievePage(candidate.id);
    return {
      id: canonicalId(page.id),
      title: pageTitle(page),
      kind: "page",
      source: candidate.source,
      url: page.url,
    };
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
    // The Gateway page itself has a workspace parent (no data source), but agents are told
    // to operate on it directly, so allow it by id match instead of failing scope.
    if (compactId(page.id) === compactId(this.config.gatewayPageId)) {
      return { id: page.id, title: "Gateway page", gateway: true };
    }
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
