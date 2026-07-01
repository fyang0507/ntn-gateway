const fs = require("node:fs");
const { GatewayError } = require("./errors");
const { markdownToBlocks, richTextFromMarkdown, sourceUrlFromParagraph } = require("./markdown");

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

// Guard against passing a file path as literal Markdown (a common mistake: `--content notes.md`
// instead of `--content @notes.md`). Only fires when the value is a single-line, reasonably short
// string that names an existing regular file, so legitimate inline Markdown is unaffected.
function guardContentLooksLikePath(value) {
  if (typeof value !== "string" || value.startsWith("@")) return;
  if (value.includes("\n") || value.length > 4096) return;
  let isRegularFile = false;
  try {
    isRegularFile = fs.existsSync(value) && fs.statSync(value).isFile();
  } catch (_error) {
    isRegularFile = false;
  }
  if (isRegularFile) {
    throw new GatewayError(
      "content_looks_like_path",
      "Received an existing file path as literal Markdown text. Did you mean --content @<value>?",
      { path: value }
    );
  }
}

async function readContentInput(options = {}, stdin) {
  if (options.content && options.stdin) {
    throw new GatewayError("argument_conflict", "--content and --stdin cannot be used together.");
  }
  if (options.content) {
    guardContentLooksLikePath(options.content);
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

  return markdownToBlocks(raw);
}

module.exports = {
  readJsonArg,
  readTextArg,
  readAll,
  readContentInput,
  hasStdinInput,
  blocksFromInput,
  parseRichText: richTextFromMarkdown,
  sourceUrlFromParagraph,
};
