#!/usr/bin/env node

import {existsSync, readFileSync} from 'node:fs';

const TARGET_DB = '3619782c4f4a8004ac3de09f8e9239f8';

const ENRICHMENT = {
  '德伯家的苔丝': {author: 'Thomas Hardy / 托马斯·哈代', tags: ['小说', '外国文学']},
  '银河边缘009 - 时空画师': {author: '杨枫 主编', tags: ['科幻', '小说', '选集']},
  '中华诗歌百年精华': {author: '《诗刊》编辑部 编', tags: ['诗歌', '选集', '中国文学']},
  'Pictures from home': {author: 'Larry Sultan', tags: ['画册', '摄影']},
  '悉达多': {author: 'Hermann Hesse / 赫尔曼·黑塞', tags: ['小说', '外国文学']},
  '我们这一代': {author: '肖全', tags: ['画册', '摄影']},
  '地下室手记': {author: 'Fyodor Dostoevsky / 费奥多尔·陀思妥耶夫斯基', tags: ['小说', '外国文学']},
  '商战': {author: 'Al Ries / 艾·里斯; Jack Trout / 杰克·特劳特', tags: ['商业', '非虚构']},
  '重来：更为简单有效的商业思维': {
    author: 'Jason Fried / 贾森·弗里德; David Heinemeier Hansson / 戴维·海涅迈尔·汉森',
    tags: ['商业', '非虚构'],
  },
  '重读三体': {author: '刘慈欣', tags: ['科幻', '小说']},
  '营救华尔街': {author: 'Roger Lowenstein / 罗杰·洛温斯坦', tags: ['商业', '金融', '非虚构']},
  '边疆': {author: '残雪', tags: ['小说', '中国文学']},
  '当代英雄': {author: 'Mikhail Lermontov / 米哈伊尔·莱蒙托夫', tags: ['小说', '外国文学']},
  '福柯访谈录：权力的眼睛': {author: 'Michel Foucault / 米歇尔·福柯', tags: ['访谈', '哲学', '社科']},
  '人、岁月、生活': {author: 'Ilya Ehrenburg / 伊利亚·爱伦堡', tags: ['回忆录', '历史', '非虚构']},
  '商业简史': {author: '刘润', tags: ['商业', '历史', '非虚构']},
  'Driftless': {author: 'Jason Vaughn; Brad Zellar', tags: ['画册', '摄影']},
  'Waves': {author: 'Alex Webb; Rebecca Norris Webb', tags: ['画册', '摄影']},
  'Life in war': {author: 'Majid Saeedi', tags: ['画册', '摄影', '战争']},
  'I know how furious your heart beating': {author: 'Alec Soth', tags: ['画册', '摄影']},
  'Grandras: land of the white stork': {author: 'Jasper Bastian', tags: ['画册', '摄影']},
  'Sealskin': {author: 'Jeff Dworsky', tags: ['画册', '摄影']},
  '海浪': {author: 'Virginia Woolf / 弗吉尼亚·伍尔夫', tags: ['小说', '外国文学']},
  '妻妾成群': {author: '苏童', tags: ['小说', '中国文学']},
  '额尔古纳河右岸': {author: '迟子建', tags: ['小说', '中国文学']},
  '癌症楼': {author: 'Aleksandr Solzhenitsyn / 亚历山大·索尔仁尼琴', tags: ['小说', '外国文学']},
  '那不勒斯四部曲1:我的天才女友': {author: 'Elena Ferrante / 埃莱娜·费兰特', tags: ['小说', '外国文学']},
  '新化复印产业的生命史': {author: '冯军旗', tags: ['社会学', '非虚构']},
  '那不勒斯四部曲2：新名字的故事': {author: 'Elena Ferrante / 埃莱娜·费兰特', tags: ['小说', '外国文学']},
  '中县干部': {author: '冯军旗', tags: ['社会学', '政治', '非虚构']},
  '那不勒斯四部曲3：离开的，留下的': {author: 'Elena Ferrante / 埃莱娜·费兰特', tags: ['小说', '外国文学']},
  '那不勒斯四部曲4：失踪的孩子': {author: 'Elena Ferrante / 埃莱娜·费兰特', tags: ['小说', '外国文学']},
  'City Stages': {author: 'Matthew Pillsbury', tags: ['画册', '摄影']},
  '明室': {author: 'Roland Barthes / 罗兰·巴特', tags: ['摄影理论', '艺术', '非虚构']},
  '退步集': {author: '陈丹青', tags: ['散文', '艺术', '中国文学']},
  '献给阿尔吉侬的花束': {author: 'Daniel Keyes / 丹尼尔·凯斯', tags: ['科幻', '小说', '外国文学']},
  '出梁庄记': {author: '梁鸿', tags: ['纪实', '社会学', '中国文学']},
  '中国在梁庄': {author: '梁鸿', tags: ['纪实', '社会学', '中国文学']},
  '白鲸': {author: 'Herman Melville / 赫尔曼·梅尔维尔', tags: ['小说', '外国文学']},
  'Heart of Spain': {author: 'Robert Capa', tags: ['画册', '摄影', '战争']},
  '他们说，你的歌，有谁来听？': {author: 'Anaïs Martane / 安娜伊思·马田', tags: ['画册', '摄影']},
  '名利场': {author: 'William Makepeace Thackeray / 威廉·梅克比斯·萨克雷', tags: ['小说', '外国文学']},
  '王小波全集(1)：一直特立独行的猪': {author: '王小波', tags: ['散文', '中国文学']},
  '王小波全集(2)：沉默的大多数': {author: '王小波', tags: ['散文', '中国文学']},
  '王小波全集(3)：黄金时代': {author: '王小波', tags: ['小说', '中国文学']},
  'Highway Kind': {author: 'Justine Kurland; Lynne Tillman', tags: ['画册', '摄影']},
  '王小波全集(4)：白银时代': {author: '王小波', tags: ['小说', '中国文学']},
  'King Queen Knave': {author: 'Vladimir Nabokov', tags: ['小说', '外国文学']},
  '王小波全集(5)：我的精神家园': {author: '王小波', tags: ['散文', '中国文学']},
  '王小波全集(6)：革命时期的爱情': {author: '王小波', tags: ['小说', '中国文学']},
  '王小波全集(7)：红拂夜奔': {author: '王小波', tags: ['小说', '中国文学']},
  '王小波全集(8)：寻找无双': {author: '王小波', tags: ['小说', '中国文学']},
  'Blood Green': {author: 'Curran Hatleberg', tags: ['画册', '摄影']},
  '王小波全集(9)：万寿寺': {author: '王小波', tags: ['小说', '中国文学']},
  '王小波全集(10)：爱你就像爱生命': {author: '王小波', tags: ['书信', '中国文学']},
  '王小波全集(11)：我的阴阳两界': {author: '王小波', tags: ['小说', '中国文学']},
  '王小波全集(12)：未来世界': {author: '王小波', tags: ['小说', '科幻', '中国文学']},
  'Lost Coast': {author: 'Curran Hatleberg', tags: ['画册', '摄影']},
  '王小波全集(13)：夜行记': {author: '王小波', tags: ['小说', '中国文学']},
  '王小波全集(14)：绿毛水怪': {author: '王小波', tags: ['小说', '科幻', '中国文学']},
  '王小波全集(15)：似水柔情': {author: '王小波', tags: ['小说', '中国文学']},
  '王小波全集(16)：黑铁时代': {author: '王小波', tags: ['小说', '中国文学']},
  'Exile': {author: 'Josef Koudelka', tags: ['画册', '摄影']},
  'How to hide an Empire': {author: 'Daniel Immerwahr', tags: ['历史', '政治', '非虚构']},
  '沉默的过去：权力与历史生产': {
    author: 'Michel-Rolph Trouillot / 米歇尔-罗尔夫·特鲁约',
    tags: ['历史', '人类学', '非虚构'],
  },
  '文学批评入门': {author: '汤拥华', tags: ['文学批评', '非虚构']},
};

const TAG_OPTIONS = [
  ['小说', 'blue'],
  ['散文', 'green'],
  ['画册', 'purple'],
  ['摄影', 'pink'],
  ['诗歌', 'red'],
  ['选集', 'yellow'],
  ['科幻', 'default'],
  ['中国文学', 'orange'],
  ['外国文学', 'gray'],
  ['非虚构', 'brown'],
  ['商业', 'blue'],
  ['金融', 'green'],
  ['历史', 'red'],
  ['政治', 'orange'],
  ['社科', 'purple'],
  ['社会学', 'pink'],
  ['人类学', 'brown'],
  ['哲学', 'gray'],
  ['访谈', 'yellow'],
  ['回忆录', 'green'],
  ['纪实', 'orange'],
  ['艺术', 'purple'],
  ['摄影理论', 'pink'],
  ['战争', 'red'],
  ['书信', 'yellow'],
  ['文学批评', 'blue'],
];

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

function richText(content) {
  return [{type: 'text', text: {content}}];
}

async function ensureTagsProperty() {
  await notion(`/databases/${TARGET_DB}`, {
    method: 'PATCH',
    body: {
      properties: {
        Tags: {
          multi_select: {
            options: TAG_OPTIONS.map(([name, color]) => ({name, color})),
          },
        },
      },
    },
  });
}

async function main() {
  loadEnv();
  await ensureTagsProperty();

  const rows = await queryAll(TARGET_DB, {sorts: [{property: 'Start Date', direction: 'ascending'}]});
  const missing = [];
  let updated = 0;
  for (const row of rows) {
    const name = plainTitle(row.properties.Name);
    const item = ENRICHMENT[name];
    if (!item) {
      missing.push(name);
      continue;
    }
    await notion(`/pages/${row.id}`, {
      method: 'PATCH',
      body: {
        properties: {
          Author: {rich_text: richText(item.author)},
          Tags: {multi_select: item.tags.map((tag) => ({name: tag}))},
        },
      },
    });
    updated += 1;
  }

  console.log(JSON.stringify({updated, missing}, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
