# AGENTS.md

Rules for every AI coding agent working in this repo: Claude Code, Cursor, Codex, Antigravity, Gemini, Copilot, or any other.

These rules are not optional. Most of them are also enforced by hooks (see [Enforcement](#enforcement)), but they apply even where no hook exists.

---

## Guardrails

| # | Rule | What it means for you |
|---|------|-----------------------|
| 1 | **Plan first, run only after "go"** | Research, plan end to end, and discuss with the developer. Do not edit files or run commands until they have reviewed the plan and replied exactly `go`. If they reply `stop` or `replan`, go back to planning. |
| 2 | **Sensitive commands need approval** | Normal commands (read, search, build, lint, run dev servers, git reads) run without a prompt. These always need the developer's approval, even in auto or "yolo" modes: file deletes, any database client (`mongosh`, `redis-cli`, `psql`, ...), infra changes (`kubectl` apply/exec/scale, `helm install`, `skaffold dev/run`, `docker run/build/compose up`, `terraform apply`, `aws`, `gcloud`), package installs (`npm install`, `npx <new pkg>`, `pip install`), data uploads or remote access (`curl -X POST`/`-d`, `ssh`, `scp`, `rsync`), printing env vars or secrets (`env`, `printenv`, `echo $DATABASE_URL`), inline code (`node -e`, `python -c`, `bash -c`, `eval`), and `kill`, `chmod`, `chown`. |
| 3 | **Git is read-only** | You may run `git status`, `git log`, `git diff`, `git show`, `git blame` and similar read commands. Never run `git add`, `commit`, `push`, `pull`, `fetch`, `merge`, `rebase`, `reset`, `checkout`, `switch`, `restore`, `stash`, `tag`, `rm`, `mv`, `clean`, `cherry-pick` or `revert`. Never open, merge or edit pull requests. The developer commits and pushes by hand. |
| 4 | **Never touch secret files** | Never read, print, copy, source, edit or grep `.env`, `.env.*`, `*.pem` private keys, `*.key`. Use the matching example file (`.env.example`) to learn variable names. If an example is missing, build it from the variable names in the code, never from the real file. |
| 5 | **Never delete database data** | Never run a delete, drop, truncate or flush against any database (MongoDB, Redis, SQL), by any means: shell clients, inline scripts, migration scripts. Any other database operation (reads, writes, migrations) needs the developer's approval first. |
| 6 | **Stay inside this folder** | Do not read, write or run anything outside the repository root. No `~`, `$HOME`, absolute paths outside the repo, or `../` escapes. |
| 7 | **Ask before deleting files** | Never delete a file or folder (`rm`, `find -delete`, `fs.rmSync`, ...) without explicit approval for that specific deletion. |
| 8 | **No destructive infrastructure commands** | Never run `kubectl delete`, `helm uninstall`, `skaffold delete`, `docker rm/rmi/prune`, `terraform destroy`, `npm publish`, `sudo`, `chmod 777`, `aws s3 rm`, or `curl ... \| sh`. |

### When a rule blocks you

Stop and tell the developer what you wanted to do and why. Do not look for a workaround: no other tool, no encoding tricks, no writing a script that does the blocked thing.

---

## Enforcement

| Agent | How the rules are enforced |
|---|---|
| **Claude Code** | `.claude/settings.json` + hooks in `.claude/hooks/`. Starts in plan mode. The plan gate, approval for sensitive commands, git, secret, DB, folder and delete rules are all hard-blocked. |
| **Cursor** | `.cursor/hooks.json` + `.cursor/hooks/guard.mjs` (shell, MCP and file-read hooks, plus the plan gate for commands). `.cursor/rules/guardrails.mdc` loads these rules into every chat. Cursor has no pre-edit hook, so rule 1 for edits relies on the agent following this file. |
| **Codex** | Reads this file. `.codex/config.toml` sets `sandbox_mode = "workspace-write"` (stay in folder, no network) and `approval_policy = "on-request"`. |
| **Antigravity / Gemini** | `GEMINI.md` and `.agent/rules/guardrails.md` point here. Set terminal execution to "Auto" (the agent asks for the sensitive commands in rule 2), or "Request review" for the strict mode. |
| **Copilot** | `.github/copilot-instructions.md` points here. |
| **Everyone (git)** | `.githooks/pre-commit` refuses commits that contain secret files or private keys. Enable it once per clone: `git config core.hooksPath .githooks` |

All hook adapters share one policy: [`agent-guardrails/policy.mjs`](agent-guardrails/policy.mjs), configured by [`agent-guardrails/config.json`](agent-guardrails/config.json). Change rules there, not in each adapter. After changing either, run the self-test:

```bash
node agent-guardrails/test-guardrails.mjs
```

---

## Project overview

<!-- claude-init: TODO. Replace this block with a short overview written from the code:
     what the project is, one table of folders/services (path, purpose, stack, datastore),
     and 3 to 6 conventions every agent must follow. Never copy values from secret files. -->
