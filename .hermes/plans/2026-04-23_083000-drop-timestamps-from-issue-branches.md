# Plan: Drop Timestamps from Issue Branches

## Goal

Simplify branch naming, checkpoint paths, and log directories by removing the per-run `{timestamp}` suffix. Each issue gets one stable branch (`fix/issue-{num}`) and one checkpoint directory (`.agent_logs/issue-{num}/`).

## Current State

- **Branch**: `fix/issue-{num}_{YYYYMMDD}_{HHMMSS}` — fresh timestamp every run
- **Checkpoint**: `.agent_logs/issue-{num}_{ts}/checkpoint.json`
- **Logs**: `.agent_logs/issue-{num}_{ts}/phase{N}.log`
- **Tag**: `issue/{num}` — lightweight, follows HEAD (already stable)

Each resume spawns a new timestamped branch. Old branches accumulate on remote. Example from issue 27:
```
origin/fix/issue-27_20260423_053112   ← latest
origin/fix/issue-27_20260422_*         ← 5 older abandoned attempts
```

The `tag` is already the right deduplication mechanism — it always points to the latest HEAD. The timestamps are redundant.

## Proposed Changes

| Item | Before | After |
|------|--------|-------|
| Branch name | `fix/issue-{num}_{ts}` | `fix/issue-{num}` |
| Log directory | `.agent_logs/issue-{num}_{ts}/` | `.agent_logs/issue-{num}/` |
| Checkpoint path | `.agent_logs/issue-{num}_{ts}/checkpoint.json` | `.agent_logs/issue-{num}/checkpoint.json` |
| Tag | `issue/{num}` | unchanged |
| Resume logic | Checkout tag → rebase → use original ts for checkpoint dir | Checkout tag → rebase → checkpoint at fixed path |

The `run_ts` variable and all the `ts` preservation logic becomes unnecessary. The checkpoint always goes to the same path per issue.

## Implementation Steps

### 1. Update `save_checkpoint_on_branch` (~line 153)

Remove `ts` from path construction. Always use `issue-{num}` as the directory name.

```python
# Before
def save_checkpoint_on_branch(num, data):
    ts = data.get("ts") or datetime.now().strftime("%Y%m%d_%H%M%S")
    cp_dir = WORKDIR / f".agent_logs/issue-{num}_{ts}"

# After
def save_checkpoint_on_branch(num, data):
    cp_dir = WORKDIR / f".agent_logs/issue-{num}"
```

Remove `ts` from the saved data dict as well (no longer needed).

### 2. Update `get_checkpoint_on_branch` (~line 126)

Remove legacy glob for `issue-{num}_*/` and the `sorted()` + `reversed()` dance. Just look at the fixed path.

```python
# Before
log_dirs = sorted(WORKDIR.glob(f".agent_logs/issue-{num}_*/"))
for ld in reversed(log_dirs):
    cp_file = ld / "checkpoint.json"
    ...

# After
cp_file = WORKDIR / f".agent_logs/issue-{num}/checkpoint.json"
if cp_file.exists():
    with open(cp_file) as f:
        return json.load(f)
```

Keep the legacy `.agent_checkpoint_{num}.json` fallback (it's already there).

### 3. Update `find_issue_tag` (~line 167)

Branch matching already uses `f"fix/issue-{num}"` prefix — that's correct and doesn't need to change. The tag already works as a stable pointer. Only the branch *creation* side needs updating.

### 4. Update branch creation in `main()` (~line 839)

Remove `{ts}` from the new branch name:

```python
# Before
branch = f"fix/issue-{num}_{ts}"

# After
branch = f"fix/issue-{num}"
```

**Resume conflict resolution**: If `existing_branch` (from tag) is a timestamped branch (e.g. `fix/issue-27_20260423_053112`), we need to handle this gracefully. Options:
- **Option A (recommended)**: Rename the old branch in-place: `git branch -m fix/issue-27_20260423_053112 fix/issue-27` before checking out
- **Option B**: Just create `fix/issue-27` fresh from origin/master (old branch remains abandoned on remote — acceptable, same as before)

Option A keeps history. Option B is simpler but leaves old branches orphaned. Given the goal is to reduce branch pollution, Option A is preferred.

Implementation (Option A):
```python
if existing_branch and existing_branch != f"fix/issue-{num}":
    log(f"  [MIGRATE] Renaming old branch '{existing_branch}' → 'fix/issue-{num}'")
    run(f"git branch -m {existing_branch} fix/issue-{num} 2>&1")
```

### 5. Update log paths throughout `main()`

Remove `{run_ts}` from all log path constructions. All phases write to the same directory.

```python
# Before
investigate_log = WORKDIR / f".agent_logs/issue-{num}_{run_ts}/phase1.log"

# After
investigate_log = WORKDIR / f".agent_logs/issue-{num}/phase1.log"
```

Affected lines (~883, ~930, and any QA/REVIEW log paths). Variable `run_ts` can be removed entirely from the scope.

### 6. Update `push_branch_and_tag` (~line 192)

No changes needed — it already pushes the branch name it receives and updates the tag.

### 7. Update module docstring (~line 12-17)

Reflect the new branch strategy.

### 8. Update `squash_wip_commits` (~line 202)

The function uses `origin/master..HEAD` to find WIP commits — this is fine, no path changes needed. But update the log message since we now have a stable branch name.

## Migration: Existing Branches and Tags

When the refactored script runs for the first time on an issue that has an old timestamped branch:

1. `find_issue_tag(num)` returns the old branch name (e.g. `fix/issue-27_20260423_053112`)
2. Code renames it to `fix/issue-27` in-place
3. All subsequent operations use the new name

No tag changes needed — `issue/27` just follows the renamed branch.

When the refactored script runs for a brand new issue: creates `fix/issue-{num}` directly, no timestamp.

## Files Likely to Change

- `scripts/github-issue-agent.py` — main changes above

## Tests / Validation

Manual test (no unit tests exist for this script):

1. Run the script on a fresh or `qa-failed` issue — verify:
   - Branch created is `fix/issue-{num}` (no timestamp)
   - Logs at `.agent_logs/issue-{num}/phase{N}.log`
   - Checkpoint at `.agent_logs/issue-{num}/checkpoint.json`
   - Tag `issue/{num}` points to the right branch

2. Kill and restart mid-phase — verify resume:
   - Picks up checkpoint from `.agent_logs/issue-{num}/`
   - Phase progress is correct

3. For old timestamped branches: verify rename logic fires and works

## Risks and Tradeoffs

| Risk | Mitigation |
|------|-----------|
| If two agents run simultaneously on the same issue, they could conflict on the same branch name | Locking mechanism (`acquire_lock()` + `in-progress` label) already prevents this |
| Old checkpoint dirs (`issue-{num}_{ts}`) accumulate | Can be cleaned up with a one-time script after migration |
| The rename-in-place (`git branch -m`) of old branches could confuse `git push` tracking | The branch already tracks origin, so push should work. May need `git push --set-upstream origin fix/issue-{num}` if tracking is lost. Add a check after rename: if `git rev-parse --abbrev-ref origin/fix/issue-{num}` fails, set upstream explicitly. |

## Open Questions

1. **Old timestamped branches on remote**: Leave them orphaned (they already exist) or delete them manually? Recommend leaving — they don't hurt anything and deleting remote branches is destructive.

2. **One-time cleanup of old local checkpoint dirs**: Should the script clean up old `issue-{num}_{ts}/` dirs on resume? Could be noisy. Probably not needed — they're local only.

3. **Log rotation**: Currently logs are append-only per phase. With no timestamps, logs from old runs would be overwritten. Is that acceptable? Yes — if you're resuming, you want the fresh log, not the old one.
