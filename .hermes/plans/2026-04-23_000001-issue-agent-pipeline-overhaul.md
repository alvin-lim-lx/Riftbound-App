# Plan: Issue Agent Pipeline Overhaul

## Goal
Fix the GitHub issue agent pipeline so it correctly retries failed issues, uses phase-appropriate instructions, and doesn't have dead code or stale checkpoint bugs.

## Current Context
- Pipeline at `scripts/github-issue-agent.py` (1015 lines)
- 5 open issues: #12 (qa-failed, needs retry), #11, #6, #5 (reopened), #1 (reopened)
- 8 labels defined but `no-area-assigned` doesn't exist (query falls back to all open)
- `qa-failed` and `agent-error` are excluded from pickup — pipeline can't retry them
- Single `SYSTEM_INSTRUCTION` applied to all phases, even QA which needs to build/test
- `_handle_failure()` is dead code — never called
- Checkpoint `ts` overwritten on resume, causing log dir fragmentation
- Baseline errors re-run on every QA even when resuming

## Label Lifecycle (Proposed)

```
OPEN (no label)          → pipeline picks up → adds "in-progress"
  └─ INVESTIGATE fails   → stays "in-progress" → retried next cycle
  └─ IMPLEMENT fails     → stays "in-progress" → retried next cycle
  └─ CODE_REVIEW fails  → "needs-review" label (human reviews diff)
  └─ QA fails            → "qa-failed" label → pipeline RETRIES this
  └─ PUSH fails          → "push-failed" label → manual intervention
  └─ All phases pass     → "in-review" → human reviews PR → merges → "done"
```

**Skip set (never picked up by pipeline):**
- `in-progress` — currently being worked
- `in-review` — PR open, human reviewing
- `needs-review` — agent's diff needs human review (not a retry target)
- `push-failed` — manual intervention needed
- `done` — merged
- `wontfix` / `duplicate` / `invalid` — explicit human decisions

**Pickup set (pipeline retries):**
- No label (untriaged)
- `qa-failed` — QA failed, retry IMPLEMENT+ from checkpoint
- `agent-error` — agent crashed, retry from checkpoint

---

## Step-by-Step Plan

### Step 1: Update `get_untriaged_issues()` — Fix Skip Set
**File:** `scripts/github-issue-agent.py`
- Remove `qa-failed` and `agent-error` from skip set (lines 245-246)
- Add `wontfix`, `duplicate`, `invalid` to skip set (human decisions)
- Remove `no-area-assigned` from the API query (it doesn't exist — fall through to all open issues immediately)
- Add comment documenting the label lifecycle

### Step 2: Create Per-Phase `SYSTEM_INSTRUCTION`s
**File:** `scripts/github-issue-agent.py`
- Replace single `SYSTEM_INSTRUCTION` with 5 phase-specific instruction strings:
  - `INSTRUCT_INVESTIGATE` — explore freely, run tests, no commits needed
  - `INSTRUCT_IMPLEMENT` — TDD, commit after sub-tasks, no new deps, no push
  - `INSTRUCT_CODE_REVIEW` — review only, run lint/types, do not modify code
  - `INSTRUCT_QA` — build and test freely, verify everything passes
  - `INSTRUCT_PUSH` — push only, no code changes
- Update `build_X_prompt()` functions to use their respective phase instructions

### Step 3: Remove Dead Code — `_handle_failure()`
**File:** `scripts/github-issue-agent.py`
- `_handle_failure()` (lines 1002-1011) is never called — remove it entirely
- Also remove the docstring on line 12-16 that describes old checkpoint behavior (lines 12-16)

### Step 4: Fix Docstring (Lines 12-16)
**File:** `scripts/github-issue-agent.py`
- Update branch strategy docstring to reflect current behavior:
  - Checkpoints are in `.agent_logs/issue-{num}_{ts}/checkpoint.json` (local only, not committed)
  - Tags point to branches

### Step 5: Preserve `ts` in Checkpoints on Resume
**File:** `scripts/github-issue-agent.py`
- When loading checkpoint (`cp = get_checkpoint_on_branch()`), extract `cp["ts"]`
- Pass that `ts` into `save_checkpoint_on_branch()` so it writes to the same log dir
- Current code always uses `datetime.now()` — fix `save_checkpoint_on_branch()` to accept an optional `ts_override`

### Step 6: Add `_handle_failure()` Call Site (or remove entirely)
- Decision: since `_handle_failure()` is dead code and the pipeline already handles all failure cases inline (each phase has its own error path), we'll remove the function entirely per Step 3.

### Step 7: Fix INVESTIGATE Failure Path — Add agent-error Label
**File:** `scripts/github-issue-agent.py`
- When INVESTIGATE fails (`not ok:`), add `agent-error` label instead of leaving no label

### Step 8: Syntax and Import Audit
- Run `python3 -m py_compile scripts/github-issue-agent.py` to verify no syntax errors
- Verify no unused imports after removing `_handle_failure()`

---

## Files Likely to Change
- `scripts/github-issue-agent.py` (1015 lines)

## Verification
1. `python3 -m py_compile scripts/github-issue-agent.py` — syntax OK
2. `python3 scripts/github-issue-agent.py --help 2>&1 || true` — runs without errors (will exit early since no daemon mode)
3. Review skip set logic manually against label list
4. Review per-phase instructions match what each phase needs

## Open Questions
- Should `agent-error` trigger a comment on the issue? Currently it doesn't — only INVESTIGATE failure currently does nothing. Decide: should INVESTIGATE failure add a comment?
- Should `qa-failed` issues also add a comment when labeled? Yes — already handled (lines 944-949)
