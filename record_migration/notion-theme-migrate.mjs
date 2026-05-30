#!/usr/bin/env node

import {existsSync, readFileSync} from 'node:fs';

const DEFAULTS = {
  sourceDb: '2c09782c4f4a810fbacff155b33c09e6',
  targetDb: '3619782c4f4a8027b3bfd0323e141d62',
  tag: 'Career & Job',
  sourceTitleProperty: 'Task',
  sourceTagProperty: 'Tasks',
  sourceDateProperty: 'Date',
  sourceStatusProperty: 'Status',
  targetTitleProperty: 'Name',
  targetStartDateProperty: 'Start Date',
  targetEndDateProperty: 'End Date',
  targetStatusProperty: 'Status',
};

const USAGE = `
Usage:
  node notion-theme-migrate.mjs count [options]
  node notion-theme-migrate.mjs migrate [options]
  node notion-theme-migrate.mjs reset-target [options]

Options:
  --source-db <id>       Source Notion database ID
  --target-db <id>       Target Notion database ID
  --tag <name>           Source tag/select value to migrate
  --start <YYYY-MM-DD>   Optional inclusive source date lower bound
  --before <YYYY-MM-DD>  Optional exclusive source date upper bound
  --copy-content         Copy page body blocks into the target pages
  --include-existing     In migrate mode, create rows even if title/date exists

Examples:
  node notion-theme-migrate.mjs count
  node notion-theme-migrate.mjs count --start 2026-05-01 --before 2026-06-01
  node notion-theme-migrate.mjs migrate
`;

function loadEnv() {
  if (!existsSync('.env')) return;
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)\s*$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (!command || command === '-h' || command === '--help') {
    return {help: true};
  }
  if (!['count', 'migrate', 'reset-target'].includes(command)) {
    throw new Error(`Unknown command: ${command}`);
  }

  const options = {...DEFAULTS, command, includeExisting: false, copyContent: false};
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    const next = () => {
      const value = rest[++i];
      if (!value) throw new Error(`Missing value for ${arg}`);
      return value;
    };
    if (arg === '--source-db') options.sourceDb = next();
    else if (arg === '--target-db') options.targetDb = next();
    else if (arg === '--tag') options.tag = next();
    else if (arg === '--start') options.start = next();
    else if (arg === '--before') options.before = next();
    else if (arg === '--copy-content') options.copyContent = true;
    else if (arg === '--include-existing') options.includeExisting = true;
    else throw new Error(`Unknown option: ${arg}`);
  }
  return options;
}

function plainTitle(property) {
  return (property?.title ?? []).map((part) => part.plain_text ?? '').join('');
}

function dateStart(row, propertyName) {
  return row.properties[propertyName]?.date?.start ?? '';
}

function rowKey(name, startDate) {
  return `${name}\u0000${startDate}`;
}

function sourceFilter(options) {
  const filters = [
    {property: options.sourceTagProperty, select: {equals: options.tag}},
  ];
  if (options.start) {
    filters.push({property: options.sourceDateProperty, date: {on_or_after: options.start}});
  }
  if (options.before) {
    filters.push({property: options.sourceDateProperty, date: {before: options.before}});
  }
  return {and: filters};
}

function summarizeSourceRow(row, options) {
  const name = plainTitle(row.properties[options.sourceTitleProperty]);
  const date = row.properties[options.sourceDateProperty]?.date;
  return {
    id: row.id,
    url: row.url,
    name,
    status: row.properties[options.sourceStatusProperty]?.status?.name ?? null,
    dateStart: date?.start ?? null,
    dateEnd: date?.end ?? null,
  };
}

async function notion(path, {method = 'GET', body} = {}) {
  const token = process.env.NOTION_API_KEY;
  if (!token) throw new Error('NOTION_API_KEY is missing. Add it to .env or the environment.');

  const response = await fetch(`https://api.notion.com/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await response.json();
  if (!response.ok) {
    throw new Error(`${response.status} ${json.code ?? ''}: ${json.message ?? JSON.stringify(json)}`);
  }
  return json;
}

async function queryAll(databaseId, body = {}) {
  const results = [];
  let cursor;
  do {
    const page = await notion(`/databases/${databaseId}/query`, {
      method: 'POST',
      body: {...body, page_size: 100, start_cursor: cursor},
    });
    results.push(...page.results);
    cursor = page.has_more ? page.next_cursor : undefined;
  } while (cursor);
  return results;
}

async function listBlockChildren(blockId) {
  const results = [];
  let cursor;
  do {
    const qs = new URLSearchParams({page_size: '100'});
    if (cursor) qs.set('start_cursor', cursor);
    const page = await notion(`/blocks/${blockId}/children?${qs.toString()}`);
    results.push(...page.results);
    cursor = page.has_more ? page.next_cursor : undefined;
  } while (cursor);
  return results;
}

function richTextToWritable(richText = []) {
  const writable = [];
  for (const part of richText) {
    const text = part.plain_text ?? '';
    const chunks = text.match(/[\s\S]{1,1900}/g) ?? [''];
    for (const content of chunks) {
      writable.push({
        type: 'text',
        text: {
          content,
          ...(part.href ? {link: {url: part.href}} : {}),
        },
        annotations: part.annotations,
      });
    }
  }
  return writable;
}

function copyFile(file) {
  if (!file) return undefined;
  if (file.type === 'external') return {type: 'external', external: {url: file.external.url}};
  if (file.type === 'file') return {type: 'external', external: {url: file.file.url}};
  return undefined;
}

function scrubBlockData(type, data = {}) {
  if (['image', 'video', 'file', 'pdf', 'audio'].includes(type)) {
    const copiedFile = copyFile(data);
    if (!copiedFile) return {};
    return {
      ...copiedFile,
      caption: richTextToWritable(data.caption ?? []),
    };
  }

  const clean = {};
  for (const [key, value] of Object.entries(data)) {
    if (['rich_text', 'caption'].includes(key)) clean[key] = richTextToWritable(value);
    else if (key === 'text') clean.rich_text = richTextToWritable(value);
    else if (key === 'checked') clean[key] = value;
    else if (key === 'language') clean[key] = value;
    else if (key === 'color') clean[key] = value;
    else if (key === 'icon' && type === 'callout') clean[key] = value;
    else if (['url', 'expression'].includes(key)) clean[key] = value;
  }
  return clean;
}

function fallbackBlock(block) {
  const type = block.type ?? 'unknown';
  const text = block[type]?.rich_text?.map((part) => part.plain_text).join('') ?? '';
  return {
    object: 'block',
    type: 'paragraph',
    paragraph: {
      rich_text: richTextToWritable([{plain_text: text || `[Unsupported block: ${type}]`}]),
      color: 'default',
    },
  };
}

async function toWritableBlock(block) {
  const type = block.type;
  const supportedTypes = new Set([
    'paragraph',
    'heading_1',
    'heading_2',
    'heading_3',
    'bulleted_list_item',
    'numbered_list_item',
    'to_do',
    'toggle',
    'quote',
    'callout',
    'code',
    'divider',
    'bookmark',
    'equation',
    'image',
    'video',
    'file',
    'pdf',
    'audio',
  ]);
  if (!supportedTypes.has(type)) return fallbackBlock(block);

  const writable = {
    object: 'block',
    type,
    [type]: scrubBlockData(type, block[type]),
  };

  if (block.has_children) {
    const children = await listBlockChildren(block.id);
    const writableChildren = [];
    for (const child of children) {
      writableChildren.push(await toWritableBlock(child));
    }
    if (writableChildren.length > 0 && !['divider', 'image', 'video', 'file', 'pdf', 'audio', 'bookmark', 'equation'].includes(type)) {
      writable[type].children = writableChildren;
    }
  }
  return writable;
}

async function sourcePageContent(pageId) {
  const children = await listBlockChildren(pageId);
  const writable = [];
  for (const child of children) {
    writable.push(await toWritableBlock(child));
  }
  return writable;
}

function chunk(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

async function appendChildren(blockId, children) {
  for (const batch of chunk(children, 100)) {
    await notion(`/blocks/${blockId}/children`, {
      method: 'PATCH',
      body: {children: batch},
    });
  }
}

async function gather(options) {
  const sourceRows = await queryAll(options.sourceDb, {
    filter: sourceFilter(options),
    sorts: [
      {property: options.sourceDateProperty, direction: 'ascending'},
      {property: options.sourceTitleProperty, direction: 'ascending'},
    ],
  });
  const targetRows = await queryAll(options.targetDb);
  const targetKeys = new Set(
    targetRows.map((row) => {
      const name = plainTitle(row.properties[options.targetTitleProperty]);
      const start = dateStart(row, options.targetStartDateProperty);
      return rowKey(name, start);
    }),
  );
  const source = sourceRows.map((row) => summarizeSourceRow(row, options));
  const toCreate = source.filter((row) => {
    if (options.includeExisting) return true;
    return !targetKeys.has(rowKey(row.name, row.dateStart ?? ''));
  });
  return {source, targetRows, toCreate};
}

async function createTargetPage(row, options) {
  if (!row.name || !row.dateStart) {
    throw new Error(`Source row is missing a title or date: ${row.url}`);
  }
  const properties = {
    [options.targetTitleProperty]: {title: [{text: {content: row.name}}]},
    [options.targetStartDateProperty]: {date: {start: row.dateStart}},
    [options.targetEndDateProperty]: {date: {start: row.dateEnd ?? row.dateStart}},
  };
  if (row.status) {
    properties[options.targetStatusProperty] = {status: {name: row.status}};
  }
  const page = await notion('/pages', {
    method: 'POST',
    body: {
      parent: {database_id: options.targetDb},
      properties,
    },
  });
  if (options.copyContent) {
    const children = await sourcePageContent(row.id);
    if (children.length > 0) await appendChildren(page.id, children);
  }
  return page;
}

async function archivePage(pageId) {
  return notion(`/pages/${pageId}`, {
    method: 'PATCH',
    body: {archived: true},
  });
}

function printSummary(summary, options) {
  const output = {
    tag: options.tag,
    dateRange: {
      startInclusive: options.start ?? null,
      beforeExclusive: options.before ?? null,
    },
    sourceEligibleCount: summary.source.length,
    targetExistingCount: summary.targetRows.length,
    alreadyInTargetByNameAndStartDate: summary.source.length - summary.toCreate.length,
    netNewToCreateCount: summary.toCreate.length,
    netNewItems: summary.toCreate.map((row) => ({
      name: row.name,
      status: row.status,
      startDate: row.dateStart,
      endDate: row.dateEnd ?? row.dateStart,
      sourceUrl: row.url,
    })),
  };
  console.log(JSON.stringify(output, null, 2));
}

async function main() {
  loadEnv();
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(USAGE.trim());
    return;
  }

  const summary = await gather(options);
  if (options.command === 'count') {
    printSummary(summary, options);
    return;
  }

  if (options.command === 'reset-target') {
    let archived = 0;
    for (const row of summary.targetRows) {
      await archivePage(row.id);
      archived += 1;
    }
    console.error(`Archived ${archived} target page(s).`);
    return;
  }

  let created = 0;
  for (const row of summary.toCreate) {
    await createTargetPage(row, options);
    created += 1;
  }
  printSummary({...summary, toCreate: []}, options);
  console.error(`Created ${created} page(s).`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
