# Plan: Fix Issue Agent Pipeline

## Goal
Fix all 8 identified issues in `scripts/github-issue-agent.py` so the pipeline runs correctly.

## Issues to Fix

| # | Priority | Issue |
|---|----------|-------|
| 1 | CRITICAL | `spawn_hermes()` has duplicate/conflicting `subprocess.Popen` args → TypeError or empty logs |
| 2 | HIGH | `.agent_logs/` and `.agent_checkpoint_*.json` tracked in git — must be ignored |
| 3 | HIGH | Branch strategy split — `agent/fixes` vs per-issue branches, pick one |
| 4 | HIGH | `get_affected_tests()` has a logic inversion (skips existing files) |
| 5 | MEDIUM | Checkpoint commits pollute branch history with `--amend` |
| 6 | MEDIUM | Skills loading incomplete — IMPLEMENT and QA missing skills |
| 7 | LOW | Global `num` variable used implicitly in `push_branch_and_tag()` |
| 8 | LOW | Pre-flight checks not automated |

## Context

- **Script**: `/home/panda/riftbound/scripts/github-issue-agent.py` (996 lines)
- **Repo**: `alvin-lim-lx/Riftbound-App` at `/home/panda/riftbound`
- **Working dir is clean** (no uncommitted changes)
- **Active issue branches**: `fix/issue-11`, `fix/issue-21`, `fix/issue-22`
- **Accumulating branch `agent/fixes`** at `aaae200` — not being updated, should be abandoned

---

## Step-by-Step Plan

### Step 1: Fix `spawn_hermes()` — Remove Duplicate Popen Arguments

**File**: `scripts/github-issue-agent.py`

**Problem**: Lines 330-340 have duplicate/conflicting `subprocess.Popen` kwargs. Python raises `TypeError` on duplicate keyword args. Even if it somehow ran, the second `stdout=subprocess.PIPE` would override the fd-based `stdout=tmp_fd`, so all hermes output goes nowhere (empty logs).

**Fix**: Replace the broken `spawn_hermes()` function entirely with a clean implementation:
- Open temp file via `os.open` with `O_WRONLY|O_CREAT|O_TRUNC`
- Pass the raw fd to `subprocess.Popen` via `stdout=tmp_fd`
- Use `communicate()` to get output, then `os.replace()` to atomically rename
- Write the communicate output to the log file as a fallback

**Verification**: `python3 -m py_compile scripts/github-issue-agent.py` should succeed.

---

### Step 2: Fix `get_affected_tests()` Logic Inversion

**File**: `scripts/github-issue-agent.py`, lines 293-308

**Problem**: `if os.path.exists(full): continue` skips existing files, so only non-existent source files get test files found. This inverts the intended logic.

**Fix**: Change to `if not os.path.exists(full): continue`.

**Verification**: `python3 -c "import scripts.github_issue_agent as g; print(g.get_affected_tests(['backend/src/engine/GameEngine.ts']))"` should return test files.

---

### Step 3: Add Agent Artifacts to `.gitignore`

**File**: `/home/panda/riftbound/.gitignore`

**Changes**:
```
.agent_logs/
.agent.lock
.agent_checkpoint_*.json
```

**Verification**: `git check-ignore .agent_logs/ .agent.lock` should return those paths.

---

### Step 4: Remove Agent Artifacts from Git Tracking

**Command**: `git rm -r --cached .agent_logs/ .agent_checkpoint_*.json 2>/dev/null`

This removes them from tracking without deleting the files from disk.

**Verification**: `git ls-files -- .agent_logs/` should return empty.

---

### Step 5: Archive `agent/fixes` Branch

**Commands**:
```bash
git branch -d agent/fixes   # delete local (safe — not merged to master)
```

**Verification**: `git branch | grep agent/fixes` should return nothing.

---

### Step 6: Fix Checkpoint Storage — Local JSON Only

**File**: `scripts/github-issue-agent.py`

**Problem**: `save_checkpoint_on_branch()` does `git commit --amend` on every checkpoint, creating noisy history. Also, checkpoints are committed to the branch, which pollutes the git history of every PR.

**Fix**:
1. Remove the `save_checkpoint_on_branch()` git commit machinery entirely
2. Create `save_checkpoint()` that writes to `.agent_logs/issue-{num}_{ts}/checkpoint.json` as a plain file
3. Create `load_checkpoint(issue_num)` that reads from that location
4. Keep `get_checkpoint_on_branch()` for backwards compatibility during resume but make it read from the local file instead

Actually, the cleanest approach: checkpoints are pipeline state, not source code. Remove all checkpoint git commits. Store as `.agent_logs/issue-{num}_{ts}/checkpoint.json` locally only. The branch already has all the code — the checkpoint is just pipeline metadata.

**Verification**: `python3 -m py_compile scripts/github-issue-agent.py` should succeed.

---

### Step 7: Fix Skills Loading — Add TDD to IMPLEMENT, Verification to QA

**File**: `scripts/github-issue-agent.py`

**Changes**:
- IMPLEMENT prompt: add `SKILL TO LOAD: test-driven-development` 
- QA prompt: add `SKILL TO LOAD: verification-before-completion`

The SYSTEM_INSTRUCTION already says "Always commit after each meaningful sub-task" — TDD skill reinforces RED-GREEN-REFACTOR.

**Verification**: `grep -n "test-driven-development\|verification-before-completion" scripts/github-issue-agent.py` should show entries in both IMPLEMENT and QA prompts.

---

### Step 8: Pass `issue_num` Explicitly to `push_branch_and_tag()`

**File**: `scripts/github-issue-agent.py`

**Problem**: `push_branch_and_tag()` uses the global `num` variable, which is fragile and implicit.

**Fix**: Add `issue_num` parameter to `push_branch_and_tag()` and update all call sites.

**Verification**: `python3 -m py_compile scripts/github-issue-agent.py` should succeed.

---

### Step 9: Verify the Fixed Script Runs

**Command**: `python3 -m py_compile scripts/github-issue-agent.py && echo "Syntax OK"`

---

### Step 10: Commit the Fixes

**Branch**: Create `fix/issue-agent-pipeline-fixes` from `origin/master`

**Commit message**: `fix(issue-agent): 8 pipeline bugs — Popen args, test lookup, gitignore, checkpoints, skills`

**Files changed**:
- `.gitignore` (add agent artifacts)
- `scripts/github-issue-agent.py` (fixes 1,4,6,7,8)
- `scripts/github-issue-agent.py` (removed from git cache)

**Do NOT commit**: `.agent_logs/`, `.agent_checkpoint_*.json` (they should be gitignored but not deleted from disk).

---

## Verification Steps After All Fixes

1. `python3 -m py_compile scripts/github-issue-agent.py` → no errors
2. `git check-ignore .agent_logs/ .agent.lock .agent_checkpoint_*.json` → shows those paths
3. `git ls-files -- .agent_logs/ .agent_checkpoint_*.json` → empty (removed from tracking)
4. `git branch | grep agent/fixes` → empty (deleted)
5. `grep -n "test-driven-development" scripts/github-issue-agent.py` → in IMPLEMENT prompt
6. `grep -n "verification-before-completion" scripts/github-issue-agent.py` → in QA prompt
7. No `git commit` calls inside `save_checkpoint()` (only file writes)
