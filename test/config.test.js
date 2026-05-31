const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { candidateEnvPaths, loadConfig } = require("../src/config");

test("candidate env paths include caller ancestors before package fallback", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ntn-gateway-config-"));
  const nested = path.join(root, "a", "b");
  fs.mkdirSync(nested, { recursive: true });
  const fallback = path.join(root, "package.env");

  const paths = candidateEnvPaths(nested, fallback);

  assert.equal(paths[0], path.join(nested, ".env"));
  assert.equal(paths[1], path.join(root, "a", ".env"));
  assert.equal(paths[2], path.join(root, ".env"));
  assert.equal(paths.at(-1), fallback);
});

test("loadConfig fills missing env from package fallback when called elsewhere", () => {
  const oldGatewayPageId = process.env.NTN_GATEWAY_PAGE_ID;
  const oldNotionApiKey = process.env.NOTION_API_KEY;
  delete process.env.NTN_GATEWAY_PAGE_ID;
  delete process.env.NOTION_API_KEY;

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ntn-gateway-config-"));
  const cwd = path.join(root, "other-workspace");
  const fallback = path.join(root, "package.env");
  fs.mkdirSync(cwd, { recursive: true });
  fs.writeFileSync(fallback, [
    "NTN_GATEWAY_PAGE_ID=11111111-1111-1111-1111-111111111111",
    "NOTION_API_KEY=secret_test_key",
    "",
  ].join("\n"));

  try {
    const config = loadConfig({ cwd, env: {}, fallbackEnvPath: fallback });

    assert.deepEqual(config, {
      gatewayPageId: "11111111-1111-1111-1111-111111111111",
      notionApiKey: "secret_test_key",
    });
  } finally {
    if (oldGatewayPageId === undefined) delete process.env.NTN_GATEWAY_PAGE_ID;
    else process.env.NTN_GATEWAY_PAGE_ID = oldGatewayPageId;
    if (oldNotionApiKey === undefined) delete process.env.NOTION_API_KEY;
    else process.env.NOTION_API_KEY = oldNotionApiKey;
  }
});
