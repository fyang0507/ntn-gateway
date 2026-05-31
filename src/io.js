const fs = require("node:fs");
const { GatewayError } = require("./errors");

function readJsonArg(value) {
  if (!value) return {};
  const raw = value.startsWith("@") ? fs.readFileSync(value.slice(1), "utf8") : value;
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new GatewayError("json_invalid", "Could not parse JSON input.", { input: value, reason: error.message });
  }
}

function readTextArg(value) {
  if (!value) return "";
  return value.startsWith("@") ? fs.readFileSync(value.slice(1), "utf8") : value;
}

function readAll(stream) {
  if (!stream) {
    throw new GatewayError("stdin_unavailable", "No stdin stream is available.");
  }
  return new Promise((resolve, reject) => {
    let data = "";
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => {
      data += chunk;
    });
    stream.on("end", () => resolve(data));
    stream.on("error", reject);
  });
}

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

function textRichText(content) {
  return { type: "text", text: { content } };
}

function linkedTextRichText(content, url) {
  return { type: "text", text: { content, link: { url } } };
}

function appendText(parts, content) {
  if (!content) return;
  const last = parts[parts.length - 1];
  if (last?.type === "text" && !last.text.link) {
    last.text.content += content;
    return;
  }
  parts.push(textRichText(content));
}

function parseRichText(input) {
  const text = String(input || "");
  const parts = [];
  const tokenPattern = /<a\s+[^>]*href=(["'])(https?:\/\/[^"']+)\1[^>]*>[\s\S]*?<\/a>|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|(https?:\/\/[^\s<>)"']+)/gi;
  let cursor = 0;
  for (const match of text.matchAll(tokenPattern)) {
    appendText(parts, decodeHtmlEntities(text.slice(cursor, match.index)));
    const url = decodeHtmlEntities(match[2] || match[4] || match[5]).replace(/[.,;:]+$/, "");
    const label = decodeHtmlEntities(match[3] || stripHtml(match[0]) || url);
    parts.push(linkedTextRichText(label, url));
    cursor = match.index + match[0].length;
  }
  appendText(parts, decodeHtmlEntities(text.slice(cursor)));
  return parts.length > 0 ? parts : [textRichText(text)];
}

function stripHtml(value) {
  return decodeHtmlEntities(String(value || "").replace(/<[^>]*>/g, ""));
}

function sourceUrlFromParagraph(paragraph) {
  const text = paragraph.trim();
  const patterns = [
    /^https?:\/\/[^\s<>)"']+$/i,
    /^\[[^\]]+\]\((https?:\/\/[^)\s]+)\)$/i,
    /^<a\s+[^>]*href=(["'])(https?:\/\/[^"']+)\1[^>]*>[\s\S]*?<\/a>$/i,
    /^(?:source|link|url)\s*:\s*(https?:\/\/[^\s<>)"']+)$/i,
    /^(?:source|link|url)\s*:\s*\[[^\]]+\]\((https?:\/\/[^)\s]+)\)$/i,
    /^(?:source|link|url)\s*:\s*<a\s+[^>]*href=(["'])(https?:\/\/[^"']+)\1[^>]*>[\s\S]*?<\/a>$/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return decodeHtmlEntities(match[2] || match[1] || match[0]).replace(/[.,;:]+$/, "");
  }
  return undefined;
}

function blockFromParagraph(paragraph) {
  const sourceUrl = sourceUrlFromParagraph(paragraph);
  if (sourceUrl) {
    return {
      object: "block",
      type: "bookmark",
      bookmark: { url: sourceUrl },
    };
  }

  return {
    object: "block",
    type: "paragraph",
    paragraph: {
      rich_text: parseRichText(paragraph.trim()),
    },
  };
}

function hasStdinInput(stream) {
  if (!stream) return false;
  if (stream.isTTY === false) return true;
  if (stream.fd !== 0) return false;
  try {
    const stat = fs.fstatSync(0);
    return stat.isFIFO() || stat.isFile();
  } catch (_error) {
    return false;
  }
}

async function readContentInput(options = {}, stdin) {
  if (options.content && options.stdin) {
    throw new GatewayError("argument_conflict", "--content and --stdin cannot be used together.");
  }
  if (options.content) {
    return readTextArg(options.content);
  }
  if (options.stdin || hasStdinInput(stdin)) {
    return readAll(stdin);
  }
  return undefined;
}

function blocksFromInput(raw) {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new GatewayError("stdin_empty", "No block content was provided on stdin.");
  }

  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : [parsed];
  }

  return trimmed.split(/\n{2,}/).map(blockFromParagraph);
}

module.exports = { readJsonArg, readTextArg, readAll, readContentInput, hasStdinInput, blocksFromInput, parseRichText, sourceUrlFromParagraph };
