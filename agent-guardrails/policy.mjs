// Agent guardrail policy for this repo. Managed by claude-init.
//
// One source of truth for what an AI coding agent (Claude Code, Cursor,
// Codex, Antigravity, ...) may do here. Agent-specific hook adapters call
// these functions and translate the result into their own hook format:
//   - .claude/hooks/*.mjs   (Claude Code)
//   - .cursor/hooks/*.mjs   (Cursor)
//   - .githooks/pre-commit  (secret check, via --check-staged)
//
// Project-specific settings live in agent-guardrails/config.json:
//   approvalMode          "sensitive": only sensitive shell commands ask
//                         "all": every shell command asks
//   planGate              true: nothing runs or is edited before "go"
//   secretPaths           extra secret files (repo-relative, * and ** globs)
//   testsDeleteDb         true: test runners are denied (tests wipe the DB)
//   testsDeleteDbMessage  why tests are denied, shown to the agent
//   testRunnerPattern     optional regex that overrides the test runner list
//   extraSecretEnvVars    extra env var name parts treated as secrets
//
// Rules (see AGENTS.md for the human-readable version):
//   1. Plan first. Nothing is executed or edited until the developer has
//      reviewed the plan and said "go" (when planGate is on).
//   2. Sensitive shell commands need the developer's approval, in every
//      mode (database access, infra changes, package installs, uploads and
//      remote access, printing secrets, inline code, kill/chmod). With
//      approvalMode "all", every shell command needs approval.
//   3. Git is read-only. Commit, push, add, reset, checkout, ... are done by
//      the developer by hand.
//   4. Secret files (.env, .env.*, private keys, configured secretPaths) are
//      never read or written. Agents use the matching .env.example instead.
//   5. Nothing is ever deleted from a database. Any other database operation
//      needs approval (rule 2).
//   6. Agents stay inside the project folder.
//   7. Deleting files needs explicit approval, with a loud warning.
//   8. Destructive infrastructure commands (kubectl delete, docker prune,
//      npm publish, sudo, curl | sh, ...) are blocked.

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const POLICY_DIR = import.meta.dirname;

// ── Config ───────────────────────────────────────────────────────────────────

const DEFAULT_CONFIG = {
  approvalMode: "sensitive",
  planGate: true,
  secretPaths: [],
  testsDeleteDb: false,
  testsDeleteDbMessage: "test suites here delete data in the configured database. Run tests yourself",
  testRunnerPattern: "",
  extraSecretEnvVars: [],
};

// A missing config means defaults. A broken config fails closed: every
// command asks and the plan gate stays on.
export function loadConfig(dir = POLICY_DIR) {
  const file = path.join(dir, "config.json");
  if (!existsSync(file)) return { ...DEFAULT_CONFIG };
  try {
    return { ...DEFAULT_CONFIG, ...JSON.parse(readFileSync(file, "utf8")) };
  } catch {
    return { ...DEFAULT_CONFIG, approvalMode: "all", planGate: true };
  }
}

export const CONFIG = loadConfig();

// ── Shell parsing helpers ────────────────────────────────────────────────────

// Split a shell string into command segments (good enough for guardrails).
export function segments(cmd) {
  return String(cmd)
    .split(/\|\||&&|;|\||\n|\$\(|`|\(|\)/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function tokenize(seg) {
  const out = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  for (const m of seg.matchAll(re)) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

const PREFIX_COMMANDS = new Set(["env", "command", "exec", "time", "nohup", "xargs", "nice", "npx"]);

function commandTokens(seg) {
  let tokens = tokenize(seg);
  while (tokens.length && (/^\w+=/.test(tokens[0]) || PREFIX_COMMANDS.has(tokens[0]))) tokens = tokens.slice(1);
  return tokens;
}

export function isInside(dir, target) {
  const rel = path.relative(dir, target);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

// ── Rule 4: secret files ─────────────────────────────────────────────────────

const SAFE_SUFFIXES = [".example", ".sample", ".template"];

const escapeRe = (s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&");

// Turns a configured secret path (repo-relative, * and ** globs) into a
// regex body. "x.yml" also matches "x.yaml" and the other way round.
function secretPathRegex(p) {
  let s = String(p).replace(/^\.?\//, "");
  const yml = /\.ya?ml$/.test(s);
  if (yml) s = s.replace(/\.ya?ml$/, "");
  const glob = (t) => t.split("*").map(escapeRe).join(`[^/\\s'"]*`);
  // "**/" matches zero or more folders, any other "**" matches anything.
  const body = s
    .split("**/")
    .map((seg) => seg.split("**").map(glob).join(`[^\\s'"]*`))
    .join(`(?:[^\\s'"]*/)?`);
  return yml ? `${body}\\.ya?ml` : body;
}

const SECRET_PATHS = (CONFIG.secretPaths || []).filter(Boolean).map((p) => {
  const body = secretPathRegex(p);
  return {
    label: p,
    file: new RegExp(`(^|/)${body}$`),
    cmd: new RegExp(`(^|[\\s/'"=<>:(])${body}(?=$|[\\s'";|&)<>])`),
  };
});

export function isSecretPath(p) {
  if (!p || typeof p !== "string") return false;
  const clean = p.replace(/["']/g, "");
  const base = path.basename(clean);
  if (SAFE_SUFFIXES.some((s) => base.endsWith(s))) return false;
  if (base === ".env" || base.startsWith(".env.")) return true;
  if (base === "private.pem" || /\.(key|p12|pfx)$/.test(base)) return true;
  if (SECRET_PATHS.some((s) => s.file.test(clean))) return true;
  return false;
}

// Finds .env-style tokens inside a shell command string.
const ENV_TOKEN = /(?:^|[\s/'"=<>:(])(\.env(?:\.[\w-]+)*)(?=$|[\s'";|&)<>])/g;

function commandTouchesSecrets(cmd) {
  for (const m of cmd.matchAll(ENV_TOKEN)) {
    if (isSecretPath(m[1])) return m[1];
  }
  if (/(^|[\s/'"])private\.pem\b/.test(cmd)) return "private.pem";
  for (const s of SECRET_PATHS) if (s.cmd.test(cmd)) return s.label;
  return null;
}

// ── Rule 3: git is read-only ─────────────────────────────────────────────────

const READ_ONLY_GIT = new Set([
  "status", "log", "diff", "show", "blame", "annotate", "ls-files", "ls-tree",
  "ls-remote", "rev-parse", "rev-list", "describe", "shortlog", "grep",
  "cat-file", "show-ref", "name-rev", "merge-base", "for-each-ref",
  "count-objects", "whatchanged", "check-ignore", "help", "version",
]);

const BRANCH_LIST_FLAGS = ["-a", "-r", "-v", "-vv", "--all", "--remotes", "--list", "-l",
  "--show-current", "--contains", "--merged", "--no-merged", "--sort", "--format",
  "--color", "--no-color", "--column"];

// Subcommands that are read-only only with certain arguments.
const CONDITIONAL_GIT = {
  branch: (args) =>
    (args.length === 0 || args.some((a) => a.startsWith("-"))) &&
    args.every((a) => !a.startsWith("-") || BRANCH_LIST_FLAGS.some((ok) => a === ok || a.startsWith(ok + "="))),
  remote: (args) => args.length === 0 || ["-v", "--verbose", "show", "get-url"].includes(args[0]),
  config: (args) => args.some((a) => ["--get", "--get-all", "--get-regexp", "--list", "-l"].includes(a)),
  stash: (args) => ["list", "show"].includes(args[0]),
  worktree: (args) => args[0] === "list",
  tag: (args) => args.length === 0 || ["-l", "--list"].includes(args[0]),
  reflog: (args) => args.length === 0 || args[0] === "show",
  notes: (args) => ["list", "show"].includes(args[0]),
};

function checkGit(tokens) {
  let i = 1;
  while (i < tokens.length && tokens[i].startsWith("-")) {
    const opt = tokens[i];
    if (opt === "-c" || opt.startsWith("--config-env") || opt.startsWith("--exec-path")) {
      return "git -c / --config-env can redefine commands";
    }
    i += ["-C", "--git-dir", "--work-tree", "--namespace"].includes(opt) ? 2 : 1;
  }
  const sub = tokens[i];
  const args = tokens.slice(i + 1);
  if (!sub || sub === "--version") return null;
  if (args.some((a) => a.startsWith("--output"))) return `git ${sub} --output writes files`;
  if (READ_ONLY_GIT.has(sub)) return null;
  if (CONDITIONAL_GIT[sub]?.(args)) return null;
  return `git ${sub} is not a read-only git command`;
}

function checkGh(tokens) {
  const [, group, action] = tokens;
  if (group === "auth" && action === "status") return null;
  if (["help", "--version", "version"].includes(group)) return null;
  if (["view", "list", "status", "checks", "diff"].includes(action)) return null;
  if (group === "api" && !tokens.some((t) => /^(-X|--method|-f|-F|--field|--raw-field|--input)$/.test(t))) return null;
  return `gh ${group ?? ""} ${action ?? ""}`.trim() + " can change remote state";
}

function gitWriteReason(cmd, depth = 0) {
  for (const seg of segments(cmd)) {
    const tokens = commandTokens(seg).filter((t, i) => !(i === 0 && t === "sudo"));
    if (!tokens.length) continue;
    const bin = path.basename(tokens[0]);
    const reason =
      bin === "git" ? checkGit(tokens)
      : bin === "gh" ? checkGh(tokens)
      : ["sh", "bash", "zsh", "dash"].includes(bin) && depth < 3 && tokens.includes("-c")
        ? gitWriteReason(tokens[tokens.indexOf("-c") + 1] || "", depth + 1)
        : null;
    if (reason) return reason;
  }
  return null;
}

// ── Rule 5: no database deletes ──────────────────────────────────────────────

export const DB_DELETE = new RegExp(
  [
    // MongoDB / Mongoose
    String.raw`\b(deleteOne|deleteMany|findOneAndDelete|findByIdAndDelete|findOneAndRemove|findByIdAndRemove|bulkWrite|dropDatabase|dropCollection|dropIndex(es)?)\s*\(`,
    String.raw`\.(drop|remove)\s*\(`,
    // Redis
    String.raw`\b(FLUSHALL|FLUSHDB)\b`,
    String.raw`\bredis(\.|\s+)(del|unlink|flushall|flushdb)\b`,
    // SQL
    String.raw`\bDELETE\s+FROM\b`,
    String.raw`\bDROP\s+(TABLE|DATABASE|SCHEMA|COLLECTION)\b`,
    String.raw`\bTRUNCATE\b`,
  ].join("|"),
  "i",
);

const DB_CLIENTS = new Set(["mongosh", "mongo", "redis-cli", "psql", "mysql", "sqlite3", "mongoimport", "mongorestore", "mongodump", "mongoexport"]);
const INLINE_RUNNERS = new Set(["node", "deno", "bun", "python", "python3", "ruby"]);

// Used only when testsDeleteDb is true: running tests counts as a database
// delete because the suites clean up against the configured database.
const DEFAULT_TEST_RUNNER = String.raw`\b(npm|pnpm|yarn|bun)\s+(run\s+)?test\b|\bnode\s+--test\b|\b(jest|vitest|mocha|ava|pytest|rspec|phpunit)\b|\bgo\s+test\b|\bcargo\s+test\b`;
const TEST_RUNNER = new RegExp(CONFIG.testRunnerPattern || DEFAULT_TEST_RUNNER);

function scriptFileDeletes(file, cwd) {
  try {
    const full = path.resolve(cwd, file);
    // Guardrail code holds these keywords as patterns; it never touches a DB.
    if (isInside(POLICY_DIR, full) || full.includes(`${path.sep}.claude${path.sep}hooks${path.sep}`) || full.includes(`${path.sep}.cursor${path.sep}hooks${path.sep}`)) return false;
    return DB_DELETE.test(readFileSync(full, "utf8"));
  } catch {
    return false;
  }
}

function dbDeleteReason(cmd, cwd) {
  if (CONFIG.testsDeleteDb && TEST_RUNNER.test(cmd)) return CONFIG.testsDeleteDbMessage;
  for (const seg of segments(cmd)) {
    const tokens = commandTokens(seg);
    if (!tokens.length) continue;
    const bin = path.basename(tokens[0]);
    const args = tokens.slice(1);

    // A DB client can sit behind a wrapper (kubectl exec pod -- redis-cli ...).
    const ci = tokens.findIndex((t) => DB_CLIENTS.has(path.basename(t)));

    // segments() splits on parentheses, so delete calls like `deleteMany(`
    // are matched against the whole command text, not the segment.
    if (ci !== -1) {
      const bin = path.basename(tokens[ci]);
      const args = tokens.slice(ci + 1);
      if (DB_DELETE.test(cmd) || args.some((t) => /^(del|unlink|flushall|flushdb)$/i.test(t))) {
        return `${bin} delete/drop operation`;
      }
      const fileArg = args.find((t) => /\.(js|mjs|sql)$/.test(t));
      if (fileArg && scriptFileDeletes(fileArg, cwd)) return `${bin} script ${fileArg} contains delete/drop operations`;
    }

    if (INLINE_RUNNERS.has(bin)) {
      // `node --check` / `node -c` only parses the file, it never runs it.
      if (bin === "node" && args.some((t) => t === "--check" || t === "-c")) continue;
      const inlineFlags = bin === "node" ? ["-e", "--eval", "-p", "--print"] : ["-e", "--eval", "-c"];
      const ei = args.findIndex((t) => inlineFlags.includes(t));
      if (ei !== -1 && DB_DELETE.test(cmd)) return `inline ${bin} code with a delete/drop operation`;
      const fileArg = args.find((t) => /\.(js|mjs|cjs|ts|py)$/.test(t));
      if (fileArg && scriptFileDeletes(fileArg, cwd)) return `${fileArg} contains delete/drop operations`;
    }
  }
  return null;
}

// ── Rule 6: stay inside the project folder ───────────────────────────────────

const ALLOWED_SYSTEM_PATHS = new Set(["/dev/null", "/dev/stdin", "/dev/stdout", "/dev/stderr", "/dev/tty"]);

export function pathOutsideProject(p, projectDir, cwd = projectDir) {
  if (!p || typeof p !== "string") return false;
  const expanded = p.replace(/^["']|["']$/g, "");
  if (ALLOWED_SYSTEM_PATHS.has(expanded)) return false;
  if (expanded === "~" || expanded.startsWith("~/") || /^\$\{?HOME\}?/.test(expanded)) return true;
  return !isInside(projectDir, path.resolve(cwd, expanded));
}

function commandLeavesProject(cmd, projectDir, cwd) {
  for (const seg of segments(cmd)) {
    for (const raw of tokenize(seg)) {
      // Look at the value part of --flag=/path and VAR=/path too.
      const t = raw.includes("=") && !raw.startsWith("/") ? raw.slice(raw.indexOf("=") + 1) : raw;
      const looksLikePath = t.startsWith("/") || t.startsWith("~") || /^\$\{?HOME\}?/.test(t) ||
        t === ".." || t.startsWith("../") || t.includes("/../");
      if (looksLikePath && !t.startsWith("//") && pathOutsideProject(t, projectDir, cwd)) return t;
    }
  }
  return null;
}

// ── Rule 7: file deletion is loud ────────────────────────────────────────────

const FILE_DELETE = /(^|[\s;&|(])(rm|rmdir|unlink|shred|trash)(\s|$)|\bfind\b[^|;&]*\s-delete\b|\bfind\b[^|;&]*-exec\s+rm\b|\b(unlinkSync|rmSync|rmdirSync|fs\.rm|fs\.unlink|fs\.rmdir|shutil\.rmtree|os\.remove|os\.unlink)\b/;

// ── Rule 8: destructive infrastructure commands ──────────────────────────────

const INFRA_DESTRUCTIVE = [
  [/(^|[\s;&|(])sudo\s/, "sudo"],
  [/\bkubectl\s+(delete|drain|cordon|replace\s+--force)\b/, "kubectl delete/drain"],
  [/\bhelm\s+(uninstall|delete|rollback)\b/, "helm uninstall/rollback"],
  [/\bskaffold\s+delete\b/, "skaffold delete"],
  [/\bdocker\s+(system\s+prune|volume\s+(rm|prune)|image\s+prune|container\s+prune|rm|rmi)\b/, "docker remove/prune"],
  [/\bdocker\s+compose\s+down\b.*\s-v\b/, "docker compose down -v (removes volumes)"],
  [/\bterraform\s+destroy\b|\bterraform\s+apply\b.*-destroy\b/, "terraform destroy"],
  [/\b(npm|pnpm|yarn)\s+publish\b/, "package publish"],
  [/\b(curl|wget)\b[^|]*\|\s*(sh|bash|zsh|node|python3?)\b/, "piping a download into a shell"],
  [/\bchmod\s+(-R\s+)?777\b/, "chmod 777"],
  [/\b(mkfs|dd\s+if=)/, "disk-level write"],
  [/\baws\s+s3\s+(rm|rb)\b|\baws\s+s3api\s+delete/, "S3 delete"],
];

function infraReason(cmd) {
  for (const [re, label] of INFRA_DESTRUCTIVE) if (re.test(cmd)) return label;
  return null;
}

// ── Rule 2: sensitive commands need approval ─────────────────────────────────
// With approvalMode "sensitive", anything not denied above and not matched
// here runs without a prompt.

const FLAGS_WITH_VALUE = new Set(["-n", "--namespace", "--context", "--kubeconfig", "--cluster", "--user",
  "-f", "--file", "-p", "--project-name", "--profile", "--kube-context", "--env-file"]);

// Positional words of a command, skipping flags and their values.
function subcommands(args) {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    if (!args[i].startsWith("-")) out.push(args[i]);
    else if (FLAGS_WITH_VALUE.has(args[i])) i++;
  }
  return out;
}

const DOCKER_READ = ["ps", "images", "logs", "inspect", "version", "info", "stats", "top", "port", "history", "diff", "events", "search"];
const DOCKER_GROUP_READ = ["ls", "list", "inspect", "ps", "logs", "config", "top", "port", "images", "version"];

// Infra tools: read-only subcommands run freely, everything else asks.
const INFRA_READ_ONLY = {
  kubectl: (s) =>
    ["get", "describe", "logs", "top", "explain", "version", "api-resources", "api-versions", "cluster-info", "events", "wait", "diff"].includes(s[0]) ||
    (s[0] === "config" && ["view", "get-contexts", "current-context", "get-clusters", "get-users"].includes(s[1])) ||
    (s[0] === "auth" && s[1] === "can-i") ||
    (s[0] === "rollout" && ["status", "history"].includes(s[1])),
  helm: (s) =>
    ["list", "ls", "status", "get", "history", "show", "inspect", "search", "template", "lint", "version", "env"].includes(s[0]) ||
    (["repo", "dependency", "dep", "plugin"].includes(s[0]) && ["list", "ls"].includes(s[1])),
  skaffold: (s) => s.length === 0 || ["version", "diagnose", "render", "schema", "inspect", "help"].includes(s[0]),
  docker: (s) =>
    s.length === 0 || DOCKER_READ.includes(s[0]) ||
    (["compose", "network", "volume", "image", "container", "context", "buildx"].includes(s[0]) && DOCKER_GROUP_READ.includes(s[1])),
  "docker-compose": (s) => DOCKER_GROUP_READ.includes(s[0]),
  terraform: (s) => ["plan", "validate", "fmt", "show", "version", "output", "providers", "graph"].includes(s[0]) ||
    (s[0] === "state" && ["list", "show"].includes(s[1])),
  brew: (s) => ["list", "ls", "info", "search", "outdated", "config", "doctor", "deps", "leaves"].includes(s[0]),
};

// Always ask, whatever the arguments.
const ALWAYS_ASK = [
  [["aws", "gcloud", "az", "eksctl", "pulumi", "doctl", "apt", "apt-get", "yum", "dnf", "port"], "cloud / system package CLI"],
  [["ssh", "scp", "sftp", "rsync", "ftp", "nc", "ncat", "netcat", "telnet", "socat"], "remote access or file transfer"],
  [["kill", "pkill", "killall"], "kills processes"],
  [["chmod", "chown", "chgrp"], "changes file permissions or owner"],
  [["crontab", "launchctl", "systemctl", "shutdown", "reboot"], "changes system services"],
  [["printenv"], "prints environment variables (may hold secrets)"],
  [["eval"], "runs code the guardrail cannot inspect"],
];

const PKG_MANAGERS = new Set(["npm", "pnpm", "yarn", "bun"]);
const PKG_CHANGE = new Set(["install", "i", "ci", "add", "a", "uninstall", "remove", "rm", "un", "update", "up", "upgrade",
  "link", "ln", "dlx", "create", "init", "prune", "dedupe", "rebuild"]);
const PY_PKG = new Set(["pip", "pip3", "uv", "poetry", "pipx"]);
const PY_PKG_CHANGE = new Set(["install", "uninstall", "add", "remove", "sync", "download", "update", "upgrade"]);

const INLINE_FLAGS = {
  node: ["-e", "--eval", "-p", "--print"],
  bun: ["-e", "--eval", "-p", "--print"],
  deno: ["eval"],
  python: ["-c"], python3: ["-c"],
  ruby: ["-e"], perl: ["-e", "-E"],
  sh: ["-c"], bash: ["-c"], zsh: ["-c"], dash: ["-c"],
};

const CURL_UPLOAD = /^(-[dFT]|--(data|form|upload-file|json))/;
const WGET_UPLOAD = /^--(post-data|post-file|body-data|body-file|method)/;
const WRITE_METHOD = /^(POST|PUT|PATCH|DELETE)$/i;
const SECRET_VAR_PARTS = ["SECRET", "TOKEN", "PASSWORD", "PASSWD", "API_KEY", "PRIVATE_KEY", "MONGO_URI", "REDIS_URL", "DATABASE_URL",
  ...(CONFIG.extraSecretEnvVars || []).filter((v) => /^\w+$/.test(v))];
const SECRET_VAR = new RegExp(String.raw`\$\{?\w*(${SECRET_VAR_PARTS.join("|")})\w*`, "i");
const VERSION_ONLY = new Set(["--version", "-v", "-V", "version", "--help", "-h", "help"]);

// npx / bunx run a package; it is only safe when it is already installed.
function npxReason(raw, cwd) {
  const args = raw.slice(1);
  if (args.some((a) => ["-y", "--yes", "-p", "--package"].includes(a))) return `${raw[0]} downloads and runs a package`;
  const pkg = args.find((a) => !a.startsWith("-"));
  if (!pkg) return null;
  if (!pkg.includes("@") && existsSync(path.join(cwd, "node_modules", ".bin", pkg))) return null;
  return `${raw[0]} ${pkg} may download and run a package`;
}

function sensitiveReason(cmd, cwd) {
  if (SECRET_VAR.test(cmd)) return "prints a secret environment variable";
  for (const seg of segments(cmd)) {
    let raw = tokenize(seg);
    while (raw.length && /^\w+=/.test(raw[0])) raw = raw.slice(1);
    while (raw.length && ["command", "exec", "time", "nohup", "nice"].includes(raw[0])) raw = raw.slice(1);
    if (!raw.length) continue;
    const first = path.basename(raw[0]);

    if (first === "env" && raw.slice(1).every((t) => t.startsWith("-") || /^\w+=/.test(t))) {
      return "prints environment variables (may hold secrets)";
    }
    if ((first === "export" || first === "declare") && (raw.length === 1 || ["-p", "-x"].includes(raw[1]))) {
      return "prints environment variables (may hold secrets)";
    }
    if (first === "set" && raw.length === 1) return "prints shell variables (may hold secrets)";
    if (["npx", "bunx", "pnpx"].includes(first)) {
      const r = npxReason(raw, cwd);
      if (r) return r;
    }

    const tokens = commandTokens(seg);
    if (!tokens.length) continue;
    const bin = path.basename(tokens[0]);
    const args = tokens.slice(1);
    const subs = subcommands(args);

    if (DB_CLIENTS.has(bin)) return `${bin} accesses a database`;
    if (args.length && args.every((a) => VERSION_ONLY.has(a))) continue;

    for (const [bins, label] of ALWAYS_ASK) if (bins.includes(bin)) return `${bin}: ${label}`;

    const readOnly = INFRA_READ_ONLY[bin];
    if (readOnly && !readOnly(subs)) return `${[bin, ...subs.slice(0, 2)].join(" ")} changes infrastructure`;

    if (PKG_MANAGERS.has(bin)) {
      if (bin === "yarn" && subs.length === 0) return "yarn installs packages";
      if (PKG_CHANGE.has(subs[0]) || (bin === "npm" && subs[0] === "exec") || (bin === "bun" && subs[0] === "x")) {
        return `${bin} ${subs[0]} installs or changes packages`;
      }
      if (subs[0] === "audit" && subs.includes("fix")) return `${bin} audit fix changes packages`;
    }
    if (PY_PKG.has(bin) && PY_PKG_CHANGE.has(subs[0])) return `${bin} ${subs[0]} installs or changes packages`;
    if (["python", "python3"].includes(bin) && args[0] === "-m" && PY_PKG.has(args[1]) && PY_PKG_CHANGE.has(args[2])) {
      return `${bin} -m ${args[1]} ${args[2]} installs or changes packages`;
    }

    const inline = INLINE_FLAGS[bin];
    if (inline && args.some((a) => inline.includes(a))) return `inline ${bin} code the guardrail cannot inspect`;

    if (bin === "curl") {
      const xi = args.findIndex((a) => a === "-X" || a === "--request");
      if (args.some((a) => CURL_UPLOAD.test(a) || /^-X(POST|PUT|PATCH|DELETE)$/i.test(a)) || (xi !== -1 && WRITE_METHOD.test(args[xi + 1] || ""))) {
        return "curl sends data or a write request";
      }
    }
    if (bin === "wget" && args.some((a) => WGET_UPLOAD.test(a))) return "wget sends data or a write request";
  }
  return null;
}

// ── Public evaluators ────────────────────────────────────────────────────────
// Each returns { decision: "allow" | "ask" | "deny", reason }.

export function evaluateShell(command, { projectDir, cwd = projectDir }) {
  const cmd = String(command || "");
  const deny = (reason) => ({ decision: "deny", reason });

  const git = gitWriteReason(cmd);
  if (git) return deny(`${git}. Git writes (commit, push, add, reset, ...) are done by the developer`);
  const secret = commandTouchesSecrets(cmd);
  if (secret) return deny(`"${secret}" is a secret file. Use the matching .env.example instead`);
  const db = dbDeleteReason(cmd, cwd);
  if (db) return deny(`${db}. Agents never delete database data`);
  const infra = infraReason(cmd);
  if (infra) return deny(`${infra} is a destructive operation and is blocked for agents`);
  if (!isInside(projectDir, path.resolve(cwd))) return deny(`commands must run inside ${projectDir}`);
  const outside = commandLeavesProject(cmd, projectDir, cwd);
  if (outside) return deny(`"${outside}" is outside the project folder. Agents work only inside ${projectDir}`);

  if (FILE_DELETE.test(cmd)) return { decision: "ask", reason: "THIS COMMAND DELETES FILES. Approve only if you want them removed" };
  const sensitive = sensitiveReason(cmd, cwd);
  if (sensitive) return { decision: "ask", reason: `sensitive command: ${sensitive}` };
  if (CONFIG.approvalMode === "all") return { decision: "ask", reason: "every shell command needs approval in this repo" };
  return { decision: "allow", reason: "not a sensitive command" };
}

// op: "read" | "write" | "search"
export function evaluateFile(op, filePath, { projectDir, cwd = projectDir, fileFilter } = {}) {
  if (filePath && pathOutsideProject(filePath, projectDir, cwd)) {
    return { decision: "deny", reason: `"${filePath}" is outside the project folder. Agents work only inside ${projectDir}` };
  }
  if (isSecretPath(filePath) || isSecretPath(fileFilter)) {
    return { decision: "deny", reason: `secret files are off limits. Use the matching .env.example instead` };
  }
  return { decision: "allow", reason: "" };
}

// ── Rule 1: plan first, execute only after "go" ──────────────────────────────

export function isGoMessage(prompt) {
  const text = String(prompt || "").trim().toLowerCase();
  return /^(go|go ahead|go!)\s*[.!]*$/.test(text);
}

export function isStopMessage(prompt) {
  const text = String(prompt || "").trim().toLowerCase();
  return /^(stop|hold|replan|plan again)\s*[.!]*$/.test(text);
}

export function gateStateDir(projectDir) {
  return process.env.CLAUDE_GATE_STATE_DIR || process.env.AGENT_GATE_STATE_DIR || path.join(projectDir, "agent-guardrails", ".state");
}

// ── CLI: secret check for .githooks/pre-commit ───────────────────────────────
//   git diff --cached --name-only | node agent-guardrails/policy.mjs --check-staged
// Prints each secret path and exits 3 when any is found (1 means a crash).

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) && process.argv[2] === "--check-staged") {
  const found = readFileSync(0, "utf8").split("\n").map((s) => s.trim()).filter((s) => s && isSecretPath(s));
  for (const f of found) console.log(f);
  process.exit(found.length ? 3 : 0);
}
