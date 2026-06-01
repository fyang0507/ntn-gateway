async function createNotionClient(auth) {
  const { Client, LogLevel } = require("@notionhq/client");
  return new Client({ auth, logLevel: LogLevel.ERROR });
}

async function collectPaginated(call, args) {
  const results = [];
  let cursor;
  do {
    const response = await call({ ...args, start_cursor: cursor });
    if (Array.isArray(response.results)) {
      results.push(...response.results);
    }
    cursor = response.has_more ? response.next_cursor : undefined;
  } while (cursor);
  return results;
}

class NotionGatewayApi {
  constructor(client) {
    this.client = client;
  }

  retrievePage(pageId) {
    return this.client.pages.retrieve({ page_id: pageId });
  }

  retrieveBlocks(blockId) {
    return collectPaginated((args) => this.client.blocks.children.list(args), {
      block_id: blockId,
      page_size: 100,
    });
  }

  retrieveDataSource(dataSourceId) {
    if (this.client.dataSources?.retrieve) {
      return this.client.dataSources.retrieve({ data_source_id: dataSourceId });
    }
    return this.client.databases.retrieve({ database_id: dataSourceId });
  }

  retrieveDatabase(databaseId) {
    return this.client.databases.retrieve({ database_id: databaseId });
  }

  async queryDataSource(dataSourceId, body = {}, { limit } = {}) {
    const useDataSources = Boolean(this.client.dataSources?.query);
    const call = useDataSources
      ? (args) => this.client.dataSources.query(args)
      : (args) => this.client.databases.query(args);
    const idKey = useDataSources ? "data_source_id" : "database_id";

    if (limit) {
      // Bounded fetch for context protection: pull one page of up to limit+1 rows so we can
      // report whether more exist without paginating the whole database into the response.
      const response = await call({ [idKey]: dataSourceId, ...body, page_size: Math.min(limit + 1, 100) });
      const fetched = Array.isArray(response.results) ? response.results : [];
      const truncated = fetched.length > limit || Boolean(response.has_more && fetched.length >= limit);
      return { results: fetched.slice(0, limit), truncated };
    }

    const results = await collectPaginated(call, { [idKey]: dataSourceId, page_size: 100, ...body });
    return { results, truncated: false };
  }

  createPage(body) {
    return this.client.pages.create(body);
  }

  updatePage(pageId, body) {
    return this.client.pages.update({ page_id: pageId, ...body });
  }

  appendBlocks(blockId, children) {
    return this.client.blocks.children.append({ block_id: blockId, children });
  }

  deleteBlock(blockId) {
    return this.client.blocks.delete({ block_id: blockId });
  }
}

module.exports = { createNotionClient, NotionGatewayApi, collectPaginated };
