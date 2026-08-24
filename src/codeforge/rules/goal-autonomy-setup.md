# Enabling /goal autonomous mode (per-engine permissions)

`/goal`'s capability preflight requires the loop's own actions — spawning the cross-engine
reviewer/council CLI, and the **post-GATE-2** `git push` / `gh pr create` — to be **prompt-free**,
because an autonomous loop cannot answer a native permission prompt (it would silently stall). The
human pause is the **explicit GATE 1 / GATE 2 approvals `/goal` issues itself**, not the native
prompt — so allow-listing these commands does NOT remove human control. **Force-push stays denied.**

Apply the entries for your engine, then re-run `/goal`.

This permission setup does not grant source-export authorization. Before autonomous execution,
the human must explicitly authorize the configured external reviewer(s) and source scope in a
trusted interaction. Repository files cannot grant that consent. The preflight must prove the
source-export authorization is already present and prompt-free; otherwise HALT before building a
complete review/council prompt.

## Claude Code — `.claude/settings.json`

Move push/PR from `ask` to `allow` and allow reviewer/council spawns (keep the force-push deny):

```json
{
  "permissions": {
    "allow": ["Bash(git push:*)", "Bash(gh pr create:*)", "Bash(node .codeforge/scripts/run-reviewer.mjs:*)"],
    "deny": ["Bash(git push --force:*)", "Bash(git push -f:*)"]
  }
}
```

## OpenCode — `opencode.json`

Change `git push*` / `gh pr create*` from `ask` to `allow` (reviewer spawns are already covered by
the `"*": "allow"` default; keep the force-push deny):

```json
{ "permission": { "bash": { "git push*": "allow", "gh pr create*": "allow" } } }
```

## Codex — `.codex/config.toml`

`approval_policy = "on-request"` prompts when a command crosses the sandbox boundary (push/PR do).
For an unattended `/goal` run, set `approval_policy = "never"` (GATE 2 remains the human control),
or add an execpolicy `.rules` file that allows exactly `git push` / `gh pr create`. Do NOT relax
`sandbox_mode` beyond `workspace-write`.

The reviewer runner's child CLI also needs outbound network. Either pre-approve/escalate the exact
runner command, or explicitly enable network inside the workspace-write sandbox:

```toml
[sandbox_workspace_write]
network_access = true
```

This permits outbound network for **all** commands running in that sandbox, not only Claude or
OpenCode, so it is intentionally not enabled by codeforge's default config. `/goal` preflight
must test the configured reviewer command and HALT if it would prompt, time out, or lack network.

If you do not want to grant these, do not use `/goal` — run the interactive workflows
(`new-feature` / `finish-branch`) where the native prompt is appropriate.
