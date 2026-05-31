const fs = require("node:fs");
const path = require("node:path");
const dotenv = require("dotenv");
const { GatewayError } = require("./errors");

function packageEnvPath() {
  return path.resolve(__dirname, "..", ".env");
}

function candidateEnvPaths(cwd = process.cwd(), fallbackEnvPath = packageEnvPath()) {
  const paths = [];
  let current = path.resolve(cwd);
  while (true) {
    paths.push(path.join(current, ".env"));
    const parent = path.resolve(current, "..");
    if (parent === current) break;
    current = parent;
  }
  paths.push(fallbackEnvPath);
  return [...new Set(paths)];
}

function loadEnv(cwd = process.cwd(), fallbackEnvPath = packageEnvPath()) {
  for (const envPath of candidateEnvPaths(cwd, fallbackEnvPath)) {
    if (fs.existsSync(envPath)) {
      dotenv.config({ path: envPath, quiet: true });
    }
  }
}

function loadConfig({ cwd = process.cwd(), env = process.env, fallbackEnvPath = packageEnvPath() } = {}) {
  loadEnv(cwd, fallbackEnvPath);
  const gatewayPageId = env.NTN_GATEWAY_PAGE_ID || process.env.NTN_GATEWAY_PAGE_ID;
  const notionApiKey = env.NOTION_API_KEY || process.env.NOTION_API_KEY;

  if (!gatewayPageId) {
    throw new GatewayError("config_missing", "NTN_GATEWAY_PAGE_ID is required.");
  }
  if (!notionApiKey) {
    throw new GatewayError("config_missing", "NOTION_API_KEY is required.");
  }

  return { gatewayPageId, notionApiKey };
}

module.exports = { loadConfig, loadEnv, candidateEnvPaths, packageEnvPath };
