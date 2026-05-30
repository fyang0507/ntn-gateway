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

  return trimmed.split(/\n{2,}/).map((paragraph) => ({
    object: "block",
    type: "paragraph",
    paragraph: {
      rich_text: [{ type: "text", text: { content: paragraph.trim() } }],
    },
  }));
}

module.exports = { readJsonArg, readTextArg, readAll, readContentInput, hasStdinInput, blocksFromInput };
