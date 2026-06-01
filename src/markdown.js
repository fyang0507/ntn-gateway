const { plainTextFromRichText, canonicalId } = require("./text");

// ---------------------------------------------------------------------------
// Shared inline helpers
// ---------------------------------------------------------------------------

function decodeHtmlEntities(value) {
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)));
}

function stripHtml(value) {
  return decodeHtmlEntities(String(value || "").replace(/<[^>]*>/g, ""));
}

function textRichText(content) {
  return { type: "text", text: { content } };
}

function linkedTextRichText(content, url) {
  return { type: "text", text: { content, link: { url } } };
}

function pageMentionRichText(id) {
  return { type: "mention", mention: { type: "page", page: { id } } };
}

function databaseMentionRichText(id) {
  return { type: "mention", mention: { type: "database", database: { id } } };
}

// ---------------------------------------------------------------------------
// Markdown -> Notion rich text (inline)
// ---------------------------------------------------------------------------

// A 32-hex Notion id, with or without dashes (used for [[page-id]] mentions).
const NOTION_ID = "[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}";

// Inline tokens, scanned in priority order: page/database mention, html anchor, md link, bare URL.
// `[[id]]` is a page mention; `[[db:id]]` is a database mention (the Gateway registry form).
const INLINE_PATTERN = new RegExp(
  [
    `\\[\\[\\s*(?<mentionKind>db:)?\\s*(?<mentionId>${NOTION_ID})(?:\\s*\\|[^\\]]*)?\\s*\\]\\]`,
    `<a\\s+[^>]*href=(?<q>["'])(?<htmlUrl>https?://[^"']+)\\k<q>[^>]*>(?<htmlText>[\\s\\S]*?)</a>`,
    `\\[(?<mdText>[^\\]]+)\\]\\((?<mdUrl>https?://[^)\\s]+)\\)`,
    `(?<bareUrl>https?://[^\\s<>)"']+)`,
  ].join("|"),
  "gi"
);
const ANNOTATION_PATTERN = /(`+)([\s\S]*?)\1|(\*\*|__)([\s\S]+?)\3|(~~)([\s\S]+?)\5|(?<![\w*])([*_])(?=\S)([\s\S]*?\S)\7(?![\w*])/g;

function annotationSegments(text) {
  const segments = [];
  let cursor = 0;
  for (const match of String(text).matchAll(ANNOTATION_PATTERN)) {
    if (match.index > cursor) {
      segments.push({ content: text.slice(cursor, match.index), annotations: undefined });
    }
    if (match[1]) {
      segments.push({ content: match[2], annotations: { code: true } });
    } else if (match[3]) {
      segments.push({ content: match[4], annotations: { bold: true } });
    } else if (match[5]) {
      segments.push({ content: match[6], annotations: { strikethrough: true } });
    } else {
      segments.push({ content: match[8], annotations: { italic: true } });
    }
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) {
    segments.push({ content: text.slice(cursor), annotations: undefined });
  }
  return segments;
}

function appendInline(parts, content) {
  if (!content) return;
  for (const segment of annotationSegments(content)) {
    if (!segment.content) continue;
    if (!segment.annotations) {
      const last = parts[parts.length - 1];
      if (last?.type === "text" && !last.text.link && !last.annotations) {
        last.text.content += segment.content;
        continue;
      }
      parts.push(textRichText(segment.content));
    } else {
      parts.push({ type: "text", text: { content: segment.content }, annotations: segment.annotations });
    }
  }
}

function richTextFromMarkdown(input) {
  const text = String(input || "");
  const parts = [];
  let cursor = 0;
  for (const match of text.matchAll(INLINE_PATTERN)) {
    appendInline(parts, decodeHtmlEntities(text.slice(cursor, match.index)));
    const groups = match.groups || {};
    if (groups.mentionId) {
      const id = canonicalId(groups.mentionId);
      parts.push(groups.mentionKind ? databaseMentionRichText(id) : pageMentionRichText(id));
    } else {
      const url = decodeHtmlEntities(groups.htmlUrl || groups.mdUrl || groups.bareUrl).replace(/[.,;:]+$/, "");
      const label = decodeHtmlEntities(groups.mdText || stripHtml(groups.htmlText || "") || url);
      parts.push(linkedTextRichText(label, url));
    }
    cursor = match.index + match[0].length;
  }
  appendInline(parts, decodeHtmlEntities(text.slice(cursor)));
  return parts.length > 0 ? parts : [textRichText(text)];
}

// ---------------------------------------------------------------------------
// Source-link detection (standalone URL paragraphs become bookmark blocks)
// ---------------------------------------------------------------------------

const SOURCE_PATTERNS = [
  { re: /^(https?:\/\/[^\s<>)"']+)$/i, url: 1 },
  { re: /^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/i, label: 1, url: 2 },
  { re: /^<a\s+[^>]*href=(["'])(https?:\/\/[^"']+)\1[^>]*>([\s\S]*?)<\/a>$/i, url: 2, label: 3, html: true },
  { re: /^(?:source|link|url)\s*:\s*(https?:\/\/[^\s<>)"']+)$/i, url: 1 },
  { re: /^(?:source|link|url)\s*:\s*\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/i, label: 1, url: 2 },
  { re: /^(?:source|link|url)\s*:\s*<a\s+[^>]*href=(["'])(https?:\/\/[^"']+)\1[^>]*>([\s\S]*?)<\/a>$/i, url: 2, label: 3, html: true },
];

function sourceLinkFromParagraph(paragraph) {
  const text = String(paragraph || "").trim();
  for (const pattern of SOURCE_PATTERNS) {
    const match = text.match(pattern.re);
    if (!match) continue;
    const url = decodeHtmlEntities(match[pattern.url]).replace(/[.,;:]+$/, "");
    const rawLabel = pattern.label
      ? (pattern.html ? stripHtml(match[pattern.label]) : decodeHtmlEntities(match[pattern.label]))
      : undefined;
    const label = rawLabel && rawLabel.trim() && rawLabel.trim() !== url ? rawLabel.trim() : undefined;
    return { url, label };
  }
  return undefined;
}

function sourceUrlFromParagraph(paragraph) {
  return sourceLinkFromParagraph(paragraph)?.url;
}

// ---------------------------------------------------------------------------
// Code-block language normalization (Notion accepts a fixed enum)
// ---------------------------------------------------------------------------

const LANGUAGE_ALIASES = {
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  ts: "typescript",
  tsx: "typescript",
  py: "python",
  rb: "ruby",
  sh: "shell",
  zsh: "shell",
  yml: "yaml",
  md: "markdown",
  "c++": "c++",
  cpp: "c++",
  "c#": "c#",
  cs: "c#",
  golang: "go",
};

const KNOWN_LANGUAGES = new Set([
  "abap", "arduino", "bash", "basic", "c", "clojure", "coffeescript", "c++", "c#", "css",
  "dart", "diff", "docker", "elixir", "elm", "erlang", "flow", "fortran", "f#", "gherkin",
  "glsl", "go", "graphql", "groovy", "haskell", "html", "java", "javascript", "json",
  "julia", "kotlin", "latex", "less", "lisp", "livescript", "lua", "makefile", "markdown",
  "markup", "matlab", "mermaid", "nix", "objective-c", "ocaml", "pascal", "perl", "php",
  "plain text", "powershell", "prolog", "protobuf", "python", "r", "reason", "ruby", "rust",
  "sass", "scala", "scheme", "scss", "shell", "sql", "swift", "typescript", "vb.net",
  "verilog", "vhdl", "visual basic", "webassembly", "xml", "yaml",
]);

function normalizeLanguage(language) {
  const value = String(language || "").trim().toLowerCase();
  if (!value) return "plain text";
  const aliased = LANGUAGE_ALIASES[value] || value;
  return KNOWN_LANGUAGES.has(aliased) ? aliased : "plain text";
}

// ---------------------------------------------------------------------------
// Markdown -> Notion blocks (write path)
// ---------------------------------------------------------------------------

function headingBlock(level, text) {
  const type = `heading_${Math.min(level, 3)}`;
  return { object: "block", type, [type]: { rich_text: richTextFromMarkdown(text) } };
}

function listItemBlock(type, text, extra = {}) {
  return { object: "block", type, [type]: { rich_text: richTextFromMarkdown(text), ...extra } };
}

function paragraphBlock(text) {
  return { object: "block", type: "paragraph", paragraph: { rich_text: richTextFromMarkdown(text) } };
}

function bookmarkBlock(url, label) {
  const bookmark = { url };
  if (label) bookmark.caption = richTextFromMarkdown(label);
  return { object: "block", type: "bookmark", bookmark };
}

function quoteBlock(text) {
  return { object: "block", type: "quote", quote: { rich_text: richTextFromMarkdown(text) } };
}

function codeBlock(text, language) {
  return {
    object: "block",
    type: "code",
    code: { rich_text: [textRichText(text)], language: normalizeLanguage(language) },
  };
}

function dividerBlock() {
  return { object: "block", type: "divider", divider: {} };
}

const STRUCTURAL_LINE = /^\s*(#{1,6}\s|[-*+]\s|\d+[.)]\s|>\s?|```+|~~~+|(?:-{3,}|\*{3,}|_{3,})\s*$)/;

function markdownToBlocks(markdown) {
  const lines = String(markdown).replace(/\r\n?/g, "\n").split("\n");
  const root = [];
  let listStack = [];
  let i = 0;

  const attach = (block, indent, isListItem) => {
    if (!isListItem) {
      listStack = [];
      root.push(block);
      return;
    }
    while (listStack.length && listStack[listStack.length - 1].indent >= indent) listStack.pop();
    if (!listStack.length) {
      root.push(block);
    } else {
      const parent = listStack[listStack.length - 1].block;
      const value = parent[parent.type];
      (value.children = value.children || []).push(block);
    }
    listStack.push({ indent, block });
  };

  while (i < lines.length) {
    const raw = lines[i];
    if (raw.trim() === "") {
      i++;
      continue;
    }

    const fence = raw.match(/^\s*(```+|~~~+)(.*)$/);
    if (fence) {
      const marker = fence[1][0];
      const language = fence[2].trim();
      const closing = new RegExp(`^\\s*${marker === "`" ? "```+" : "~~~+"}\\s*$`);
      const body = [];
      i++;
      while (i < lines.length && !closing.test(lines[i])) {
        body.push(lines[i]);
        i++;
      }
      i++; // skip closing fence (no-op if input ended without one)
      attach(codeBlock(body.join("\n"), language), 0, false);
      continue;
    }

    const indent = raw.match(/^\s*/)[0].replace(/\t/g, "  ").length;
    const content = raw.trim();

    const heading = content.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      attach(headingBlock(heading[1].length, heading[2]), indent, false);
      i++;
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(content)) {
      attach(dividerBlock(), 0, false);
      i++;
      continue;
    }

    const todo = content.match(/^[-*+]\s+\[([ xX])\]\s+(.*)$/);
    if (todo) {
      attach(listItemBlock("to_do", todo[2], { checked: /x/i.test(todo[1]) }), indent, true);
      i++;
      continue;
    }

    const bullet = content.match(/^[-*+]\s+(.*)$/);
    if (bullet) {
      attach(listItemBlock("bulleted_list_item", bullet[1]), indent, true);
      i++;
      continue;
    }

    const numbered = content.match(/^\d+[.)]\s+(.*)$/);
    if (numbered) {
      attach(listItemBlock("numbered_list_item", numbered[1]), indent, true);
      i++;
      continue;
    }

    if (/^>\s?/.test(content)) {
      const quoteLines = [content.replace(/^>\s?/, "")];
      i++;
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        quoteLines.push(lines[i].trim().replace(/^>\s?/, ""));
        i++;
      }
      attach(quoteBlock(quoteLines.join("\n")), 0, false);
      continue;
    }

    const paragraph = [content];
    i++;
    while (i < lines.length && lines[i].trim() !== "" && !STRUCTURAL_LINE.test(lines[i])) {
      paragraph.push(lines[i].trim());
      i++;
    }
    const paragraphText = paragraph.join("\n");
    const source = sourceLinkFromParagraph(paragraphText);
    attach(source ? bookmarkBlock(source.url, source.label) : paragraphBlock(paragraphText), 0, false);
  }

  return root;
}

// ---------------------------------------------------------------------------
// Notion rich text -> Markdown (read path)
// ---------------------------------------------------------------------------

function markdownFromRichText(richText = []) {
  return (richText || [])
    .map((part) => {
      if (part.type === "equation") return `$${part.equation?.expression || ""}$`;
      if (part.type === "mention" && part.mention?.type === "page" && part.mention.page?.id) {
        return `[[${part.mention.page.id}]]`;
      }
      if (part.type === "mention" && part.mention?.type === "database" && part.mention.database?.id) {
        return `[[db:${part.mention.database.id}]]`;
      }
      let text = part.plain_text ?? part.text?.content ?? "";
      if (!text) return "";
      const annotations = part.annotations || {};
      if (annotations.code) text = `\`${text}\``;
      if (annotations.bold) text = `**${text}**`;
      if (annotations.italic) text = `*${text}*`;
      if (annotations.strikethrough) text = `~~${text}~~`;
      const url = part.href || part.text?.link?.url;
      if (url && part.type !== "mention") text = `[${text}](${url})`;
      return text;
    })
    .join("");
}

// ---------------------------------------------------------------------------
// Notion blocks -> Markdown (read path)
// ---------------------------------------------------------------------------

const LIST_TYPES = new Set(["bulleted_list_item", "numbered_list_item", "to_do", "toggle"]);

function renderBlock(block, depth, ordinal = 1) {
  const type = block.type;
  const value = block[type] || {};
  const pad = "  ".repeat(depth);
  const inline = () => markdownFromRichText(value.rich_text);
  const childBlocks = value.children || [];
  const childLines = childBlocks.length ? joinBlocks(childBlocks, depth + 1).split("\n") : [];
  let lines;

  switch (type) {
    case "heading_1":
      lines = [`# ${inline()}`];
      break;
    case "heading_2":
      lines = [`## ${inline()}`];
      break;
    case "heading_3":
      lines = [`### ${inline()}`];
      break;
    case "bulleted_list_item":
      lines = [`${pad}- ${inline()}`];
      break;
    case "numbered_list_item":
      lines = [`${pad}${ordinal}. ${inline()}`];
      break;
    case "to_do":
      lines = [`${pad}- [${value.checked ? "x" : " "}] ${inline()}`];
      break;
    case "toggle":
      lines = [`${pad}- ${inline()}`];
      break;
    case "quote":
      lines = inline().split("\n").map((line) => `> ${line}`);
      break;
    case "callout": {
      const icon = value.icon?.emoji ? `${value.icon.emoji} ` : "";
      lines = inline().split("\n").map((line, index) => `> ${index === 0 ? icon : ""}${line}`);
      break;
    }
    case "code": {
      const language = value.language && value.language !== "plain text" ? value.language : "";
      lines = ["```" + language, ...plainTextFromRichText(value.rich_text).split("\n"), "```"];
      break;
    }
    case "divider":
      lines = ["---"];
      break;
    case "bookmark":
    case "embed":
    case "link_preview": {
      const url = value.url || "";
      const caption = markdownFromRichText(value.caption);
      lines = [caption ? `[${caption}](${url})` : url];
      break;
    }
    case "image":
    case "video":
    case "file":
    case "pdf": {
      const url = value.external?.url || value.file?.url || value.url || "";
      const caption = markdownFromRichText(value.caption);
      lines = [type === "image" ? `![${caption}](${url})` : caption ? `[${caption}](${url})` : url];
      break;
    }
    case "equation":
      lines = ["$$", value.expression || "", "$$"];
      break;
    case "table":
      return renderTable(childBlocks, depth, value.has_column_header);
    case "table_row":
      lines = [`| ${(value.cells || []).map((cell) => markdownFromRichText(cell)).join(" | ")} |`];
      break;
    case "child_page":
      lines = [`- ${value.title || "Untitled"}`];
      break;
    case "child_database":
      lines = [`- ${value.title || "Untitled database"}`];
      break;
    case "paragraph": {
      const text = inline();
      lines = text === "" ? [""] : text.split("\n");
      break;
    }
    default: {
      const text = inline();
      lines = text ? text.split("\n") : [];
    }
  }

  return childLines.length ? [...lines, ...childLines] : lines;
}

function renderTable(rows, depth, hasColumnHeader) {
  const rendered = rows
    .filter((row) => row.type === "table_row")
    .map((row) => renderBlock(row, depth).join("\n"));
  if (hasColumnHeader && rendered.length) {
    const columns = (rows[0].table_row?.cells || []).length || 1;
    rendered.splice(1, 0, `| ${Array(columns).fill("---").join(" | ")} |`);
  }
  return rendered;
}

function joinBlocks(blocks, depth) {
  const out = [];
  let previousType = null;
  let ordinal = 0;
  for (const block of blocks) {
    ordinal = block.type === "numbered_list_item" ? ordinal + 1 : 0;
    const rendered = renderBlock(block, depth, ordinal || 1);
    if (!rendered.length) continue;
    if (out.length) {
      const tight = LIST_TYPES.has(block.type) && LIST_TYPES.has(previousType);
      if (!tight) out.push("");
    }
    out.push(...rendered);
    previousType = block.type;
  }
  return out.join("\n");
}

function markdownFromBlocks(blocks = []) {
  return joinBlocks(blocks, 0);
}

module.exports = {
  markdownToBlocks,
  markdownFromBlocks,
  markdownFromRichText,
  richTextFromMarkdown,
  sourceUrlFromParagraph,
  normalizeLanguage,
};
