#!/usr/bin/env node
/**
 * Create and delete throwaway Neon branches for the RLS work.
 *
 *   node scripts/neon-branch.mjs create rls-test
 *   node scripts/neon-branch.mjs delete rls-test
 *   node scripts/neon-branch.mjs list
 *
 * WHY A BRANCH AT ALL. Stages 1-3 of the RLS cutover create a role, grant it
 * 61 tables, and write policies. Every one of those is the kind of change that
 * looks fine until logins stop. A copy-on-write branch makes that free to get
 * wrong: break it, delete it, start again.
 *
 * Reads NEON_API_KEY from the repo's own .env.local. Keys stay scoped per
 * project -- this one belongs to smr-crucible and is used for nothing else.
 * On create it writes the branch connection string straight into
 * .env.isolation, so a database credential is never pasted, echoed, or typed.
 */
import { readFileSync, writeFileSync } from "node:fs";

const API = "https://console.neon.tech/api/v2";
const PROJECT_HINT = /steel\s*man/i;
const PROD_ENDPOINT = "ep-little-cloud-aphpkqbd";

function envVar(name) {
  if (process.env[name]) return process.env[name];
  for (const f of [".env.local", "apps/consumer/.env.local"]) {
    try {
      const line = readFileSync(f, "utf8").split("\n").find((l) => l.trim().startsWith(name + "="));
      if (line) return line.slice(line.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "");
    } catch { /* next */ }
  }
  return null;
}

const key = envVar("NEON_API_KEY");
if (!key) {
  console.error(
    "\nNEON_API_KEY not found.\n\n" +
      "Put it in smr-crucible's own .env.local (gitignored):\n" +
      "  NEON_API_KEY=<key>\n"
  );
  process.exit(2);
}

async function api(path, init = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${path}\n${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : {};
}

/**
 * Organization-scoped API keys must name an org on /projects; personal keys
 * must not. Discover it rather than making someone paste an id from a settings
 * page -- the key already knows which orgs it can see.
 */
async function listProjects() {
  try {
    const { projects } = await api("/projects");
    if (projects?.length) return projects;
  } catch (err) {
    if (!/org_id is required/i.test(String(err))) throw err;
  }
  const orgs =
    (await api("/users/me/organizations").catch(() => null))?.organizations ?? [];
  const all = [];
  for (const org of orgs) {
    const { projects } = await api(`/projects?org_id=${encodeURIComponent(org.id)}`);
    all.push(...(projects ?? []));
  }
  if (!all.length) throw new Error("no projects visible to this API key");
  return all;
}

async function steelManProject() {
  const projects = await listProjects();
  const match = projects.filter((p) => PROJECT_HINT.test(p.name));
  if (match.length !== 1) {
    throw new Error(
      `Expected exactly one project matching "Steel Man", found ${match.length}: ` +
        projects.map((p) => p.name).join(", ")
    );
  }
  return match[0];
}

const [cmd, name] = process.argv.slice(2);
const project = await steelManProject();
console.log(`\nProject: ${project.name} (${project.id})`);

if (cmd === "list") {
  const { branches } = await api(`/projects/${project.id}/branches`);
  for (const b of branches) {
    console.log(`  ${b.name.padEnd(20)} ${b.default ? "DEFAULT" : "       "}  ${b.id}`);
  }
  process.exit(0);
}

if (cmd === "delete") {
  const { branches } = await api(`/projects/${project.id}/branches`);
  const b = branches.find((x) => x.name === name);
  if (!b) { console.log(`  no branch named ${name}`); process.exit(0); }
  if (b.default) { console.error("  REFUSING: that is the default branch."); process.exit(2); }
  await api(`/projects/${project.id}/branches/${b.id}`, { method: "DELETE" });
  console.log(`  deleted ${name}`);
  process.exit(0);
}

if (cmd !== "create" || !name) {
  console.error("\nUsage: neon-branch.mjs create|delete|list [name]\n");
  process.exit(2);
}

const { branches } = await api(`/projects/${project.id}/branches`);
const existing = branches.find((b) => b.name === name);
const branch = existing
  ? (console.log(`  reusing existing branch ${name}`), existing)
  : (await api(`/projects/${project.id}/branches`, {
      method: "POST",
      body: JSON.stringify({
        branch: { name },
        endpoints: [{ type: "read_write" }],
      }),
    })).branch;

if (!existing) console.log(`  created ${name} (${branch.id})`);

// Ask Neon for the connection string rather than assembling one.
const { uri } = await api(
  `/projects/${project.id}/connection_uri` +
    `?branch_id=${branch.id}&database_name=neondb&role_name=neondb_owner`
);

const host = new URL(uri).hostname;
if (host.includes(PROD_ENDPOINT)) {
  console.error(`\nREFUSING: that resolved to the PRODUCTION endpoint.\n`);
  process.exit(2);
}

writeFileSync(".env.isolation", `ISOLATION_TEST_DATABASE_URL=${uri}\n`);
console.log(`  endpoint: ${host}`);
console.log(`  connection string written to .env.isolation (gitignored)\n`);
