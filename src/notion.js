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

  queryDataSource(dataSourceId, body = {}) {
    if (this.client.dataSources?.query) {
      return collectPaginated((args) => this.client.dataSources.query(args), {
        data_source_id: dataSourceId,
        page_size: 100,
        ...body,
      });
    }
    return collectPaginated((args) => this.client.databases.query(args), {
      database_id: dataSourceId,
      page_size: 100,
      ...body,
    });
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
}

module.exports = { createNotionClient, NotionGatewayApi, collectPaginated };
