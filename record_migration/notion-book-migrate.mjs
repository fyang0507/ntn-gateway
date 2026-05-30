#!/usr/bin/env node

import {existsSync, readFileSync} from 'node:fs';

const SOURCE_DBS = [
  {year: '2024', id: '25e4312411fe46cd80f73d1e5dd07371'},
  {year: '2025', id: '1609782c4f4a81848fe1c8731dd057d7'},
  {year: '2026', id: '2c09782c4f4a810fbacff155b33c09e6'},
];

const TARGET_DB = '3619782c4f4a8004ac3de09f8e9239f8';

function loadEnv() {
  if (!existsSync('.env')) return;
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)\s*$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
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

function plainTitle(property) {
  return (property?.title ?? []).map((part) => part.plain_text ?? '').join('');
}

function normalizeBookName(name) {
  return name
    .trim()
    .replace(/\s*[（(]\s*\d+\s*(?:\/\s*\d+)?\s*[）)]\s*$/, '')
    .trim();
}

function splitAuthor(name) {
  const pipeIndex = name.lastIndexOf(' | ');
  if (pipeIndex !== -1) {
    return {
      title: name.slice(0, pipeIndex).trim(),
      author: name.slice(pipeIndex + 3).trim(),
    };
  }

  const dashIndex = name.lastIndexOf(' - ');
  if (dashIndex !== -1) {
    const author = name.slice(dashIndex + 3).trim();
    if (/[A-Za-z]/.test(author)) {
      return {
        title: name.slice(0, dashIndex).trim(),
        author,
      };
    }
  }
  return {title: name.trim(), author: ''};
}

function mergedStatus(rows) {
  const statuses = new Set(rows.map((row) => row.status).filter(Boolean));
  if (statuses.size === 1) return [...statuses][0];
  if (statuses.has('In progress')) return 'In progress';
  if (statuses.has('Done') && statuses.has('Not started')) return 'In progress';
  return rows.at(-1)?.status ?? null;
}

function summarizeRow(row, year) {
  const date = row.properties.Date?.date;
  return {
    year,
    sourceName: plainTitle(row.properties.Task),
    status: row.properties.Status?.status?.name ?? null,
    startDate: date?.start ?? null,
    endDate: date?.end ?? date?.start ?? null,
    url: row.url,
  };
}

async function loadSourceRows() {
  const rows = [];
  for (const source of SOURCE_DBS) {
    const sourceRows = await queryAll(source.id, {
      filter: {property: 'Tasks', select: {equals: 'Book'}},
      sorts: [
        {property: 'Date', direction: 'ascending'},
        {property: 'Task', direction: 'ascending'},
      ],
    });
    rows.push(...sourceRows.map((row) => summarizeRow(row, source.year)));
  }
  return rows;
}

function dedupeRows(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = normalizeBookName(row.sourceName);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  const books = [];
  for (const [normalizedName, groupRows] of groups) {
    groupRows.sort((a, b) => (a.startDate ?? '').localeCompare(b.startDate ?? ''));
    const {title, author} = splitAuthor(normalizedName);
    books.push({
      title,
      author,
      startDate: groupRows[0].startDate,
      endDate: groupRows.reduce((latest, row) => {
        if (!latest) return row.endDate;
        if (!row.endDate) return latest;
        return row.endDate > latest ? row.endDate : latest;
      }, null),
      status: mergedStatus(groupRows),
      sourceCount: groupRows.length,
      sourceNames: groupRows.map((row) => row.sourceName),
      sourceUrls: groupRows.map((row) => row.url),
    });
  }
  books.sort((a, b) => (a.startDate ?? '').localeCompare(b.startDate ?? '') || a.title.localeCompare(b.title));
  return books;
}

async function ensureTargetSchema() {
  await notion(`/databases/${TARGET_DB}`, {
    method: 'PATCH',
    body: {
      properties: {
        'Start Date': {date: {}},
        'End Date': {date: {}},
        Status: {
          select: {
            options: [
              {name: 'Not started', color: 'gray'},
              {name: 'In progress', color: 'blue'},
              {name: 'Done', color: 'green'},
            ],
          },
        },
        Author: {rich_text: {}},
        'Source URLs': {rich_text: {}},
      },
    },
  });
}

function richText(content) {
  if (!content) return [];
  return [{type: 'text', text: {content: content.slice(0, 2000)}}];
}

async function createBook(book) {
  const properties = {
    Name: {title: [{text: {content: book.title}}]},
    Author: {rich_text: richText(book.author)},
    'Start Date': {date: {start: book.startDate}},
    'End Date': {date: {start: book.endDate ?? book.startDate}},
    'Source URLs': {rich_text: richText(book.sourceUrls.join('\n'))},
  };
  if (book.status) properties.Status = {select: {name: book.status}};

  return notion('/pages', {
    method: 'POST',
    body: {
      parent: {database_id: TARGET_DB},
      properties,
    },
  });
}

async function main() {
  loadEnv();
  const command = process.argv[2] ?? 'count';
  if (!['count', 'migrate'].includes(command)) {
    throw new Error('Usage: node notion-book-migrate.mjs [count|migrate]');
  }

  const rows = await loadSourceRows();
  const books = dedupeRows(rows);
  const duplicates = books.filter((book) => book.sourceCount > 1);
  const targetRows = await queryAll(TARGET_DB);

  const summary = {
    rawSourceRows: rows.length,
    dedupedBooks: books.length,
    duplicateGroups: duplicates.map((book) => ({
      title: book.title,
      startDate: book.startDate,
      endDate: book.endDate,
      status: book.status,
      sourceNames: book.sourceNames,
    })),
    existingTargetRows: targetRows.length,
  };

  if (command === 'count') {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  if (targetRows.length > 0) {
    throw new Error(`Target database is not empty (${targetRows.length} existing row(s)); refusing to create duplicates.`);
  }

  await ensureTargetSchema();
  let created = 0;
  for (const book of books) {
    await createBook(book);
    created += 1;
  }
  console.log(JSON.stringify({...summary, created}, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
