const test = require("node:test");
const assert = require("node:assert/strict");
const { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { spawnSync } = require("node:child_process");

const repoRoot = join(__dirname, "..");

for (const configured of [false, true]) {
test(`build preserves skill catalogs and skips runtime config (workspace env: ${configured})`, () => {
  const fixture = mkdtempSync(join(tmpdir(), "ntn-gateway-build-"));
  try {
    const checkout = join(fixture, "checkout");
    const catalog = join(fixture, "workspace", ".agents", "skills");
    mkdirSync(checkout);
    const names = ["notion-gateway","technical-reading-bookmark"];
    for (const name of names) {
      mkdirSync(join(catalog, name), { recursive: true });
      writeFileSync(join(catalog, name, "SKILL.md"), "consumer-owned sentinel\n");
    }
    for (const entry of ["package.json","src","bin","skills","test"]) {
      const source = join(repoRoot, entry);
      if (existsSync(source)) cpSync(source, join(checkout, entry), { recursive: true });
    }
    symlinkSync(join(repoRoot, "node_modules"), join(checkout, "node_modules"), "dir");
    writeFileSync(join(checkout, ".env"), "FAKE_BUILD_SENTINEL=never-load\n");
    writeFileSync(join(checkout, "outreach.config.dev.yaml"), "deliberately: [invalid\n");
    writeFileSync(join(checkout, "publish.config.dev.yaml"), "deliberately: [invalid\n");
    mkdirSync(join(checkout, ".agents"));
    writeFileSync(join(checkout, ".agents", "workspace.yaml"), "deliberately: [invalid\n");
    const readLog = join(fixture, "config-reads.log");
    const guard = join(fixture, "guard.cjs");
    writeFileSync(guard, String.raw`
const fs = require("node:fs");
const { syncBuiltinESMExports } = require("node:module");
const log = process.env.BUILD_READ_LOG;
const append = fs.appendFileSync;
function rejectConfig(path) {
  if (/(^|[/\\])(?:\.env|(?:outreach|publish)\.config\.dev\.yaml)$|[/\\]\.agents[/\\]workspace\.yaml$/.test(String(path))) {
    append(log, String(path) + "\n");
    throw new Error("Build must not inspect runtime configuration");
  }
}
for (const name of ["accessSync", "existsSync", "lstatSync", "statSync", "openSync", "readFileSync", "access", "lstat", "stat", "open", "readFile"]) {
  const original = fs[name];
  fs[name] = function (path, ...args) {
    rejectConfig(path);
    return original.call(this, path, ...args);
  };
}
for (const name of ["access", "lstat", "stat", "open", "readFile"]) {
  const original = fs.promises[name];
  fs.promises[name] = function (path, ...args) {
    rejectConfig(path);
    return original.call(this, path, ...args);
  };
}
syncBuiltinESMExports();
`);
    const run = spawnSync("npm", ["run", "build"], {
      cwd: checkout,
      encoding: "utf8",
      timeout: 120_000,
      env: {
        PATH: process.env.PATH,
        NODE_OPTIONS: `--require="${guard}"`,
        BUILD_READ_LOG: readLog,
        ...(configured ? {
          OUTREACH_DATA_REPO: join(fixture, "workspace"),
          PUBLISH_DATA_REPO: join(fixture, "workspace"),
          PUBLISH_SKILLS_DIR: catalog,
          NTN_GATEWAY_DATA_REPO: join(fixture, "workspace"),
        } : {}),
      },
    });
    assert.equal(run.status, 0, run.error?.message ?? `${run.stdout}\n${run.stderr}`);
    assert.equal(existsSync(readLog), false, "even swallowed configuration reads are forbidden");
    assert.deepEqual(readdirSync(catalog).sort(), [...names].sort());
    for (const name of names) {
      assert.equal(lstatSync(join(catalog, name)).isSymbolicLink(), false);
      assert.deepEqual(readdirSync(join(catalog, name)), ["SKILL.md"]);
      assert.equal(readFileSync(join(catalog, name, "SKILL.md"), "utf8"), "consumer-owned sentinel\n");
    }
    const binary = join(checkout, "bin/ntn-gateway.js");
    assert.ok(statSync(binary).mode & 0o111, "CLI remains executable after build");
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
}
