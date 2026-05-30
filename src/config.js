const fs = require("node:fs");
const path = require("node:path");
const dotenv = require("dotenv");
const { GatewayError } = require("./errors");

function loadEnv(cwd = process.cwd()) {
  const envPath = path.join(cwd, ".env");
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath, quiet: true });
  }
}

function loadConfig({ cwd = process.cwd(), env = process.env } = {}) {
  loadEnv(cwd);
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

module.exports = { loadConfig, loadEnv };
