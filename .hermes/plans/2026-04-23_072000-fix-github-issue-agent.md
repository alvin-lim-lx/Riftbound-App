# Fix GitHub Issue Agent — Plan

## Goal

Fix 9 confirmed bugs in `scripts/github-issue-agent.py` ranging from P0 (data loss/corruption) to P3 (clarity).

---

## Context: Confirmed Issues from Logs

| ID | Priority | Issue | Root Cause |
|----|----------|-------|------------|
| 1 | P0 | COMMIT: captures instruction text instead of hash — checkpoint shows `"done:After each commit, output: git log -1 --pretty=format:\"%H\""` | `extract_result(str(implement_log), "COMMIT:")` matches the prompt instruction, not agent output |
| 2 | P0 | Phase 4 (QA) marked "done" in checkpoint but QA never completed — `phase4.tmp` shows agent still running when interrupted | Line 994: `phases["4_QA"] = "done" if qa_pass else "fail"` — `qa_pass` defaults `False` but code only sets it to `True` when `QA_COMPLETE:` line exists; no explicit `True` branch; AND if `spawn_hermes` raises exception or returns `None` verdict, `qa_pass=False` → `done` but agent never ran |
| 3 | P0 | Agent output truncated by `finishreason='length'` on Phase 2 (IMPLEMENT) | No `--max-tokens` cap on `spawn_hermes` — LLM cuts off mid-output |
| 4 | P1 | WIP commit fires before any source code exists | `git_wip_commit()` checks `git status --porcelain` (any change), not `get_changed_source_files()` |
| 5 | P1 | Findings context bloat — 4000 chars in IMPLEMENT prompt | `build_implement_prompt` uses `[:4000]`; should be `[:1500]` |
| 6 | P2 | `agent-error` label on timeout but agent may have been making progress | Line 882: `not ok` triggers `agent-error` — but `not ok` includes timeout (recoverable), not just crashes |
| 7 | P2 | "in-progress" in skip set is dead code | Label is added before picking an issue, so it can never match against itself in `get_untriaged_issues()` |
| 8 | P3 | Phase 1 incomplete but pipeline continues to IMPLEMENT | Line 820: `phases["1_INVESTIGATE"] = "incomplete" if not ok` — then falls through to Phase 2 instead of breaking |
| 9 | P3 | No source-file guard on WIP commit | WIP fires on any change including logs/checkpoints — should require at least one source file changed |

---

## Step-by-Step Plan

### Phase 1: Fix P0 — COMMIT: extraction + QA done-when-not-done

**1.1 Fix `extract_result` for COMMIT: lines**
- **Problem**: `extract_result(implement_log, "COMMIT:")` matches the first line in the log file containing "COMMIT:", which is the prompt instruction itself (`After each commit, output: git log -1 --pretty=format:"COMMIT:%H"`).
- **Fix**: Find the **last** occurrence of `"COMMIT:"` in the file (agent's final output is at the end). Use `extract_result(..., "COMMIT:", multiline=False)` but search from the bottom, or change `extract_result` to accept a `from_end=True` option.
- **File**: `scripts/github-issue-agent.py`
- **Verification**: Add a test — mock a log with the instruction at line 1 and `COMMIT:abc123` at line 50; verify it returns `abc123` not the instruction.

**1.2 Fix QA phase checkpoint corruption**
- **Problem**: `qa_pass = False` defaults; `phases["4_QA"] = "done" if qa_pass else "fail"` — so `qa_pass=False` always means `"fail"`. But the real bug: if the agent gets interrupted, `spawn_hermes` returns `(False, True)` but `ok` from that call is never checked here (line 975: `ok, _ = spawn_hermes(...)`). When `qa_result` is empty string, `qa_pass=False`, so `"fail"` — correct behavior. But if `spawn_hermes` returns `(True, False)` with empty `qa_result`, it would set `"done"` without the agent actually producing QA output. Also: `ok` from spawn_hermes is discarded.
- **Fix**: Add explicit check after `spawn_hermes`: if `not ok and not timed_out` (agent crashed), set `phases["4_QA"] = "incomplete"` (not `"fail"`) so next cycle retries. And check `ok` returned value — if `ok=False and timed_out=True`, don't mark `"done"` even if `qa_result` is somehow set.
- **File**: `scripts/github-issue-agent.py`, lines ~983-998
- **Verification**: Manual — temporarily add `raise Exception("crash")` to simulate agent crash; confirm checkpoint saves `"4_QA": "incomplete"`.

**1.3 Add `--max-tokens` to IMPLEMENT/QA spawns**
- **Problem**: No token cap causes `finishreason='length'` truncation.
- **Fix**: Add `--max-tokens 16000` to `spawn_hermes` calls for phases IMPLEMENT and QA.
- **File**: `scripts/github-issue-agent.py`, `spawn_hermes` function, lines ~377-378
- **Implementation**: Add `max_tokens` param to `spawn_hermes` with default `None`. When set, append `--max-tokens {max_tokens}` to the hermes command.
- **Verification**: Check that phases 2 and 4 pass `max_tokens=16000`.

### Phase 2: Fix P1 — WIP commit guard + findings bloat

**2.1 Guard WIP commit with source-file change check**
- **Problem**: `git_wip_commit()` fires on any `git status --porcelain` output — including agent logs, checkpoint files, .tmp files.
- **Fix**: In `git_wip_commit()`, before staging, call `get_changed_source_files()` and only proceed if the list is non-empty.
- **File**: `scripts/github-issue-agent.py`, `git_wip_commit` function
- **Verification**: Run agent on an issue; WIP timer should not fire during investigation phase (no source changes yet).

**2.2 Truncate findings to 1500 chars in build_implement_prompt**
- **Problem**: `findings[:4000]` in `build_implement_prompt` still too large — causes context bloat.
- **Fix**: Change `findings[:4000]` to `findings[:1500]` on line 513.
- **File**: `scripts/github-issue-agent.py`, line 513
- **Verification**: Diff before/after.

### Phase 3: Fix P2 — timeout vs error separation + in-progress skip

**3.1 Separate agent-error from timeout**
- **Problem**: `not ok` catches both crashes (should error) and timeouts (should retry).
- **Fix**: Change all `agent-error` label sites to check `not ok and not timed_out` instead of just `not ok`.
  - Phase 1 (line 825): `if not ok:` → `if not ok and not timed_out:`
  - Phase 2 (line 882): `elif not ok:` → `elif not ok and not timed_out:`
  - Add new branch: `elif timed_out:` → log "Agent timed out — will retry" and continue (remove in-progress, add qa-failed-style label... actually for IMPLEMENT timeout we should just continue/retry since findings are preserved).
- **File**: `scripts/github-issue-agent.py`, lines ~825, 882
- **Verification**: Simulate timeout; agent should retry next cycle instead of getting `agent-error`.

**3.2 Remove "in-progress" from skip set (dead code)**
- **Problem**: `in-progress` is added to the issue before picking it up, so it can never match in `get_untriaged_issues()` skip set.
- **Fix**: Remove `"in-progress"` from the `skip` set in `get_untriaged_issues()`.
- **File**: `scripts/github-issue-agent.py`, line 258-259
- **Verification**: Code review — confirm the label lifecycle is: no-label → picked up → `in-progress` added → work → `in-progress` removed. The label should never need to be skipped.

### Phase 4: Fix P3 — incomplete phase 1 guard + WIP source-only

**4.1 Guard Phase 2 against incomplete Phase 1**
- **Problem**: If `phases["1_INVESTIGATE"] = "incomplete"`, code falls through to Phase 2.
- **Fix**: After Phase 1, check `if phases.get("1_INVESTIGATE") == "incomplete":` — if so, push branch/tag, label `agent-error`, release lock, break. Same pattern as IMPLEMENT failure.
- **File**: `scripts/github-issue-agent.py`, lines ~832-833
- **Verification**: Set phase 1 to incomplete in checkpoint; run agent; should exit rather than proceed.

**4.2 Enforce source-file-only in WIP (already done conceptually in 2.1 — just verify)**
- This is the same fix as 2.1. Confirm `get_changed_source_files()` is used, not raw `git status`.

---

## Files to Modify

- `scripts/github-issue-agent.py` — all 9 fixes

## Tests

- No existing tests for the agent script — manual verification by running on a test issue.
- Add inline assertions where possible (e.g., `assert commit_hash.startswith("COMMIT:")` is NOT correct since we want the hash — instead verify commit_hash is a 40-char hex string).

## Risks

- Changing `spawn_hermes` signature (adding `max_tokens`) is backward-compatible if default is `None`.
- Changing `extract_result` to search from end may break other callers — verify all callers.
- Timeout/error separation changes retry behavior — must ensure timeout loops don't infinite-retry.
