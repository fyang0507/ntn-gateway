const { existsSync, rmSync, symlinkSync } = require("node:fs");
const { homedir } = require("node:os");
const { dirname, join, relative, resolve } = require("node:path");
const { loadEnv } = require("../src/config");

const WORKSPACE_MARKER = join(".agents", "workspace.yaml");

loadEnv();

function expandHome(value) {
  if (value === "~") return homedir();
  if (value.startsWith("~/")) return join(homedir(), value.slice(2));
  return value;
}

function findWorkspaceMarker(startDir) {
  let current = resolve(startDir);
  while (true) {
    if (existsSync(join(current, WORKSPACE_MARKER))) return current;
    const parent = resolve(current, "..");
    if (parent === current) return null;
    current = parent;
  }
}

function resolveDataRepo() {
  const envValue = process.env.NTN_GATEWAY_DATA_REPO || process.env.OUTREACH_DATA_REPO;
  if (envValue && envValue.trim()) return expandHome(envValue.trim());

  const walkup = findWorkspaceMarker(process.cwd());
  if (walkup) return walkup;

  throw new Error(
    [
      "Could not resolve the agent data repo.",
      "Set NTN_GATEWAY_DATA_REPO=/path/to/data/repo, or run from a workspace with .agents/workspace.yaml.",
    ].join("\n"),
  );
}

const dataRepo = resolveDataRepo();
const SKILL_DIRS = ["notion-gateway", "technical-reading-bookmark"];
const LEGACY_SKILL_DIRS = [];

for (const legacySkillDir of LEGACY_SKILL_DIRS) {
  rmSync(join(dataRepo, ".agents", "skills", legacySkillDir), { recursive: true, force: true });
}

for (const skillDir of SKILL_DIRS) {
  const dest = resolve(join(dataRepo, ".agents", "skills", skillDir));
  const source = resolve(join("skills", skillDir));
  // Emit a RELATIVE target. An absolute target bakes this machine's checkout
  // path into the *data repo*, so moving or re-cloning either repo silently
  // leaves the data repo's committed symlinks pointing at a dead path — and
  // the data repo never gets rebuilt, so nothing ever corrects it.
  const linkTarget = relative(dirname(dest), source);
  rmSync(dest, { recursive: true, force: true });
  symlinkSync(linkTarget, dest, "dir");
  console.log(`Agent skill symlink installed -> ${dest} -> ${linkTarget}`);
}
