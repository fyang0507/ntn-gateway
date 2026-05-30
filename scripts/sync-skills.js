const { cpSync, existsSync, mkdirSync, rmSync } = require("node:fs");
const { homedir } = require("node:os");
const { join, resolve } = require("node:path");

const WORKSPACE_MARKER = join(".agents", "workspace.yaml");

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

  const localAgentRepo = join(homedir(), "Downloads", "fred-agent");
  if (existsSync(join(localAgentRepo, WORKSPACE_MARKER))) return localAgentRepo;

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
const SKILL_DIR = "notion-gateway";
const LEGACY_SKILL_DIRS = ["notion-gateway"];
const dest = join(dataRepo, ".agents", "skills", SKILL_DIR);

mkdirSync(dest, { recursive: true });
rmSync(dest, { recursive: true, force: true });
for (const legacySkillDir of LEGACY_SKILL_DIRS) {
  rmSync(join(dataRepo, ".agents", "skills", legacySkillDir), { recursive: true, force: true });
}
cpSync(join("skills", SKILL_DIR), dest, { recursive: true });

console.log(`Skill synced -> ${dest}`);
