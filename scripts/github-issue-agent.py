#!/usr/bin/env python3
"""
GitHub Issue Agent for Riftbound-App — Tag-Based Branch Pipeline

PHASES:
  1. INVESTIGATE  — understand the issue, explore codebase
  2. IMPLEMENT    — write the fix (TDD, sub-phase commits)
  3. CODE REVIEW  — hermes reviews its own diff
  4. QA           — run tests and builds, verify fix
  5. PUSH         — create PR

BRANCH STRATEGY:
  - Each issue gets a lightweight tag: refs/tags/issue/{num} → current working branch
  - Branch name: fix/issue-{num}_{ts} (fresh per attempt, resume picks up existing)
  - On resume: checkout tag's branch, rebase onto latest origin/master
  - Checkpoint stored locally as .agent_logs/issue-{num}_{ts}/checkpoint.json
    (NOT committed to git — only the branch and tag are shared)

LOCKING:
  - .agent.lock file + gh issue label "in-progress"
  - Pipeline retries qa-failed and agent-error issues automatically
  - "needs-review" and "in-review" labels mean human is reviewing — pipeline skips
"""

import subprocess
import os
import re
import shutil
import json
import threading
import time
import signal
import socket
import shlex
import glob
from pathlib import Path
from datetime import datetime

WORKDIR = Path("/home/panda/riftbound")
LOCKFILE = WORKDIR / ".agent.lock"
ISSUE_TAG_PREFIX = "issue"
IMPL_TIMEOUT_MIN = 25
WIP_COMMIT_LEAD_TIME = 120  # seconds before timeout to commit WIP

PHASES = ["INVESTIGATE", "IMPLEMENT", "CODE_REVIEW", "QA", "PUSH"]


# ─── Logging ───────────────────────────────────────────────────────────────────

def log(msg):
    ts = datetime.now().strftime("%H:%M:%S")
    print(f"[{ts}] {msg}", flush=True)


# ─── Git helpers ───────────────────────────────────────────────────────────────

def run(cmd, capture=True, timeout=120):
    """Run a shell command in WORKDIR."""
    if isinstance(cmd, str):
        r = subprocess.run(
            cmd, shell=True, capture_output=True, text=True,
            cwd=WORKDIR, env=os.environ.copy(), timeout=timeout
        )
    else:
        r = subprocess.run(cmd, capture_output=True, text=True,
                           cwd=WORKDIR, env=os.environ.copy(), timeout=timeout)
    if r.returncode != 0 and capture and r.stderr.strip():
        log(f"  [WARN] cmd '{str(cmd)[:60]}' returned {r.returncode}")
        for line in r.stderr.strip().splitlines()[:3]:
            log(f"         {line}")
    return r.stdout.strip() if capture else r.returncode == 0


def current_branch():
    return run("git symbolic-ref --short HEAD 2>/dev/null || echo 'detached'").strip()


def fetch_master():
    run("git fetch origin master 2>&1")


def get_changed_files(branch=None):
    """Return list of files changed vs origin/master."""
    out = run("git diff origin/master --name-only 2>&1")
    return [f for f in out.strip().splitlines() if f]


# Extensions considered source code (not build artifacts)
SOURCE_EXTENSIONS = {
    ".ts", ".tsx", ".js", ".jsx", ".py", ".rs", ".go",
    ".css", ".scss", ".html", ".json", ".yaml", ".yml", ".toml",
    ".md", ".txt", ".sh", ".bash"
}
AGENT_TOOLING_FILES = {
    "scripts/github-issue-agent.py", "scripts/github-issue-agent.sh",
    ".github/workflows/issue-agent.yml", "scripts/seed_ai_decks.js"
}
BUILD_ARTIFACT_DIRS = {
    "dist", "build", "node_modules", "__pycache__", ".pytest_cache",
    ".vite", ".next", "coverage", ".nyc_output", ".turbo"
}

def get_changed_source_files(branch=None):
    """Get source files changed vs origin/master, excluding build artifacts and agent tooling."""
    changed = get_changed_files(branch)
    result = []
    for f in changed:
        if f in AGENT_TOOLING_FILES:
            continue
        parts = f.split("/")
        if any(d in parts for d in BUILD_ARTIFACT_DIRS):
            continue
        ext = "." + f.rsplit(".", 1)[-1] if "." in f else ""
        if ext in SOURCE_EXTENSIONS:
            result.append(f)
    return result


def get_git_diff(branch=None):
    """Return git diff vs origin/master (first 200 lines)."""
    out = run("git diff origin/master 2>&1")
    lines = out.splitlines()
    return "\n".join(lines[:200])


def get_checkpoint_on_branch():
    """Load checkpoint from local agent log dir, or None.

    Legacy fallback: also check .agent_checkpoint_{num}.json in WORKDIR root.
    """
    # Prefer the new location: .agent_logs/issue-{num}_{ts}/checkpoint.json
    # Find the most recent log dir for this issue number
    log_dirs = sorted(WORKDIR.glob(f".agent_logs/issue-{num}_*/"))
    for ld in reversed(log_dirs):
        cp_file = ld / "checkpoint.json"
        if cp_file.exists():
            try:
                with open(cp_file) as f:
                    return json.load(f)
            except Exception:
                pass
    # Legacy fallback
    cp_files = sorted(WORKDIR.glob(f".agent_checkpoint_*.json"))
    if cp_files:
        try:
            with open(cp_files[-1]) as f:
                return json.load(f)
        except Exception:
            pass
    return None


def save_checkpoint_on_branch(num, data):
    """Write checkpoint to .agent_logs/issue-{num}_{ts}/checkpoint.json — NOT committed to git.

    Uses ts from data dict to determine the correct log directory.
    """
    ts = data.get("ts") or datetime.now().strftime("%Y%m%d_%H%M%S")
    cp_dir = WORKDIR / f".agent_logs/issue-{num}_{ts}"
    cp_dir.mkdir(parents=True, exist_ok=True)
    cp_path = cp_dir / "checkpoint.json"
    with open(cp_path, "w") as f:
        json.dump(data, f, indent=2)
    log(f"Checkpoint saved: {cp_path}")


def find_issue_tag(num):
    """Resolve lightweight tag issue/{num} to a branch name.
    
    Tag points to a commit. Use git branch --contains to find which
    local branch has that commit. Prefer the branch matching fix/issue-{num}.
    """
    tag_ref = f"refs/tags/{ISSUE_TAG_PREFIX}/{num}"
    commit = run(f"git rev-parse --verify {tag_ref} 2>&1")
    if not commit or commit.startswith("fatal:"):
        return None
    branches = run(f"git branch --contains {commit} 2>&1").strip().splitlines()
    branches = [b.strip().lstrip("* ").strip() for b in branches if b.strip()]
    for b in branches:
        if b.startswith(f"fix/issue-{num}"):
            return b
    return branches[0] if branches else None


def update_issue_tag(num, branch):
    """Force-update lightweight tag issue/{num} to current HEAD."""
    tag_name = f"{ISSUE_TAG_PREFIX}/{num}"
    run(f"git tag -d {tag_name} 2>&1")  # delete local if exists
    run(f"git tag {tag_name} 2>&1")      # create lightweight at HEAD


def push_branch_and_tag(branch, issue_num):
    """Push branch and push/update the issue tag to origin."""
    run(f"git push -u origin {branch} 2>&1")
    tag_name = f"{ISSUE_TAG_PREFIX}/{issue_num}"
    # Try push existing tag, or create new one on remote
    result = run(f"git push origin {tag_name} 2>&1")
    if "error" in result.lower() or "failed" in result.lower():
        run(f"git push origin {tag_name} --force 2>&1")


# ─── GitHub helpers ────────────────────────────────────────────────────────────

def gh_json(endpoint):
    out = subprocess.run(
        ["gh", "api", f"/repos/alvin-lim-lx/Riftbound-App/{endpoint}"],
        capture_output=True, text=True
    )
    if out.returncode != 0:
        return []
    try:
        return json.loads(out.stdout)
    except Exception:
        return []


def gh(method, endpoint, data=None):
    cmd = (["gh", "api", f"/repos/alvin-lim-lx/Riftbound-App/{endpoint}",
            "-X", method, "-f", f"body={data}"] if data else
           ["gh", "api", "-X", method, f"/repos/alvin-lim-lx/Riftbound-App/{endpoint}"])
    r = subprocess.run(cmd, capture_output=True, text=True)
    return r.stdout.strip()


def label_issue(issue_num, labels):
    for lbl in labels:
        run(f'gh issue edit #{issue_num} --add-label "{lbl}" 2>&1', capture=False)


def remove_label(issue_num, label):
    run(f'gh issue edit #{issue_num} --remove-label "{label}" 2>&1', capture=False)


def comment_issue(issue_num, body):
    escaped = body.replace(chr(10), "\\n")
    run(f'gh issue comment #{issue_num} -b "{escaped}" 2>&1', capture=False)


def close_issue(issue_num, reason="completed"):
    run(f'gh issue close #{issue_num} 2>&1', capture=False)


def get_untriaged_issues():
    """Return open issues the pipeline should work on.

    LABEL LIFECYCLE:
      no label          → pipeline picks up, adds in-progress
      in-progress       → pipeline picks up (resume from checkpoint)
      qa-failed         → pipeline picks up (retry IMPLEMENT+)
      needs-review      → skip (human must review agent's diff)
      in-review         → skip (PR open, human reviewing)
      push-failed       → skip (manual intervention needed)
      done / wontfix / duplicate / invalid → skip (human decision)

    Skip set: issues with these labels are NEVER picked up.
    """
    all_issues = gh_json("issues?state=open&per_page=20")
    skip = {
        "in-progress",   # currently being worked
        "in-review",     # PR open, human reviewing
        "needs-review",  # agent diff needs human review (not a retry)
        "push-failed",   # manual push needed
        "agent-error",   # agent crashed — human reviews before retry
        "done",          # merged and closed
        "wontfix",       # human: won't fix
        "duplicate",     # human: duplicate
        "invalid",       # human: invalid
        # qa-failed: NOT skipped — agent retries IMPLEMENT+ from checkpoint
    }
    result = []
    for i in all_issues:
        labels = [l["name"] for l in i.get("labels", [])]
        if any(l in skip for l in labels):
            continue
        result.append(i)
    return result


# ─── Lock ──────────────────────────────────────────────────────────────────────

def acquire_lock():
    if Path(LOCKFILE).exists():
        try:
            pid, host = Path(LOCKFILE).read_text().strip().split("|")
            alive = os.kill(int(pid), 0) is None if os.name != "nt" else True
            if alive:
                log(f"Lock held by {host} PID {pid} — exiting")
                return False
            log(f"Stale lock from {host} PID {pid} — removing")
            Path(LOCKFILE).unlink()
        except Exception:
            try:
                Path(LOCKFILE).unlink()
            except Exception:
                pass
    Path(LOCKFILE).write_text(f"{os.getpid()}|{socket.gethostname()}")
    return True


def release_lock():
    Path(LOCKFILE).unlink(missing_ok=True)


# ─── Baseline / pre-existing errors ──────────────────────────────────────────

def get_pre_existing_errors():
    """Return (ts_errors_set, test_failures_set) from origin/master."""
    tmpdir = f"/tmp/riftbound_baseline_{os.getpid()}"
    try:
        run(f"git clone --depth=1 --branch=origin/master file://{WORKDIR} {tmpdir} 2>&1")
        ts_out = subprocess.run(
            ["npx", "tsc", "--noEmit"], capture_output=True, text=True,
            cwd=tmpdir, timeout=120
        )
        ts_errors = set(l for l in ts_out.stdout.splitlines() if "error TS" in l)
        test_out = subprocess.run(
            ["npm", "test", "--", "--testPathPattern=BackendValidation|PhaseAutoAdvance"],
            capture_output=True, text=True, cwd=f"{tmpdir}/backend", timeout=120
        )
        test_failures = set(l for l in test_out.stdout.splitlines()
                           if re.search(r"PASS|FAIL", l))
        return ts_errors, test_failures
    except Exception:
        return set(), set()
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


def filter_baseline_errors(output, ts_errors, test_failures):
    """Remove pre-existing errors from build/test output."""
    lines = output.splitlines()
    filtered = [l for l in lines if l not in ts_errors]
    failures = [l for l in lines if l in test_failures]
    return "\n".join(filtered), "\n".join(failures)


def get_affected_tests(changed_files):
    """Return list of test files affected by changed files."""
    if not changed_files:
        return []
    test_files = []
    for tf in changed_files:
        full = os.path.join(WORKDIR, tf)
        if not os.path.exists(full):
            continue
        glob_pattern = os.path.join(WORKDIR, "backend", "tests", "**",
                                    f"{os.path.basename(tf)}")
        matches = glob.glob(glob_pattern, recursive=True)
        for m in matches:
            rel = os.path.relpath(m, WORKDIR)
            test_files.append(rel)
    return list(set(test_files))


# ─── Hermès spawn ─────────────────────────────────────────────────────────────

def spawn_hermes(prompt, log_path, timeout_minutes=20, issue_num=None, subphase=None):
    """Spawn hermes with optional WIP commit timer. Returns (ok, timed_out)."""
    log_file = Path(log_path)
    log_file.parent.mkdir(parents=True, exist_ok=True)

    # Atomic write: open temp file, subprocess writes to it directly,
    # then atomically rename to final path on success.
    tmp_path = log_file.with_suffix(".tmp")
    tmp_fd = os.open(str(tmp_path), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o644)

    wip_timer = None
    if issue_num and subphase:
        lead = WIP_COMMIT_LEAD_TIME
        timer_fn = lambda: git_wip_commit(issue_num, subphase)
        wip_timer = threading.Timer(lead, timer_fn)
        wip_timer.start()
        log(f"  [TIMER] WIP commit scheduled for {lead}s from now")

    # Pass the raw fd to subprocess — it writes directly to the temp file.
    # communicate() with stdout=PIPE returns empty since output goes to the fd.
    proc = subprocess.Popen(
        ["hermes", "chat", "-q", prompt, "--source", "github-issue-agent", "--pass-session-id"],
        stdin=subprocess.DEVNULL,
        stdout=tmp_fd,
        stderr=subprocess.STDOUT,
        cwd=WORKDIR,
        close_fds=True,
        pass_fds=()  # don't pass any fds to child beyond stdout/stderr
    )

    # tmp_fd is now dup'd into proc's stdout; close the parent's copy
    os.close(tmp_fd)

    try:
        # communicate() will return empty b/c stdout is a fd not a pipe
        outs, _ = proc.communicate(timeout=timeout_minutes * 60)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.communicate()
        log(f"  [TIMEOUT] Process killed after {timeout_minutes} min")
        if wip_timer:
            wip_timer.cancel()
        # tmp_path now contains partial output — rename to final path
        _atomic_move(tmp_path, log_file)
        return False, True
    finally:
        if wip_timer:
            wip_timer.cancel()

    # On success: tmp_path has full output, atomically rename to log_file
    _atomic_move(tmp_path, log_file)

    return proc.returncode == 0, False


def _atomic_move(src: Path, dst: Path):
    """Move src to dst atomically. Does nothing if src doesn't exist."""
    if src.exists():
        os.replace(str(src), str(dst))


def git_wip_commit(issue_num, subphase=""):
    """Stage all changes and commit as WIP with a descriptive message."""
    log(f"  [WIP-COMMIT] ~120s before timeout — committing WIP state...")
    status = subprocess.run(
        "git status --porcelain", shell=True, capture_output=True, text=True, cwd=WORKDIR
    )
    if not status.stdout.strip():
        log("  [WIP] No changes to commit")
        return
    commit_msg = f"WIP: fix #{issue_num}" + (f" — {subphase}" if subphase else "")
    result = subprocess.run(
        "git add -A && git commit -m " + shlex.quote(commit_msg) + " --no-verify",
        shell=True, capture_output=True, text=True, cwd=WORKDIR
    )
    if result.returncode == 0:
        log(f"  [WIP] Committed: {result.stdout.strip()[:80]}")
    else:
        log(f"  [WIP] Commit failed: {result.stderr.strip()[:100]}")


# ─── Prompt builders ───────────────────────────────────────────────────────────

# ─── Phase-specific instructions ─────────────────────────────────────────────

# INVESTIGATE: explore freely, run tests, understand the codebase
INSTRUCT_INVESTIGATE = """CRITICAL CONSTRAINTS:
- Only explore files under /home/panda/riftbound
- Do NOT modify any files — investigation only
- Do NOT commit or push
- You may run existing tests to understand behavior"""

# IMPLEMENT: write code, TDD, commit each sub-phase, no new deps
INSTRUCT_IMPLEMENT = """CRITICAL CONSTRAINTS:
- Only modify files under /home/panda/riftbound
- Do NOT run npm install or add new dependencies
- Do NOT push
- Always commit after each meaningful sub-task"""

# CODE_REVIEW: run lint/types, review only, do not modify code
INSTRUCT_CODE_REVIEW = """CRITICAL CONSTRAINTS:
- Only read files under /home/panda/riftbound — do NOT modify any code
- Do NOT push
- Run lint and type checks but do not make changes based on them
  (if you find issues, document them — the next IMPLEMENT cycle fixes them)"""

# QA: build and test freely — this is where we verify the fix
INSTRUCT_QA = """CRITICAL CONSTRAINTS:
- You may run any build or test commands needed to verify the fix
- Do NOT push
- If tests fail, investigate and run additional tests as needed"""

# PUSH: push only, no code changes
INSTRUCT_PUSH = """CRITICAL CONSTRAINTS:
- Do NOT modify any files
- Do NOT run build/test commands
- Push the branch and create the PR"""


def build_investigate_prompt(issue_num, title, body):
    return f"""You are investigating GitHub issue #{issue_num} in /home/panda/riftbound.

ISSUE #{issue_num}: {title}
---
{body[:4000]}
---

{INSTRUCT_INVESTIGATE}

SKILL TO LOAD (invoke NOW): brainstorming
Then use brainstorming to deeply understand the issue and explore the codebase.

EXPLORATION STEPS:
1. Read the relevant source files to understand the current implementation
2. Run existing tests to see the current behavior
3. Identify the root cause of the issue

OUTPUT YOUR UNDERSTANDING:
- ## Root Cause: <what is actually broken>
- ## Affected Code: <which files/functions need changing>
- ## Fix Approach: <how you plan to fix it>
- ## Testing Plan: <how you will verify the fix works>

Output "DONE" on its own line when finished.
"""


def build_implement_prompt(issue_num, title, body, findings, resume_subphase=None):
    resume_note = ""
    if resume_subphase:
        resume_note = f"\nContinue from where you left off. Current sub-phase: {resume_subphase}\n"
    return f"""You are implementing a fix for GitHub issue #{issue_num} in /home/panda/riftbound.

ISSUE #{issue_num}: {title}

YOUR INVESTIGATION:
{findings[:4000] if findings else '(no prior findings — use your own investigation)'}

{INSTRUCT_IMPLEMENT}

SKILL TO LOAD (invoke NOW): test-driven-development
Then follow RED-GREEN-REFACTOR for each change: write a failing test first, then make it pass, then refactor.

{resume_note}

YOUR TASK — BREAK YOUR WORK INTO SMALL, INDEPENDENT COMMITS WITH SUB-PHASE MARKERS:
1. Make one logical change at a time (e.g., "add test for X", "implement Y", "fix Z edge case")
2. After each change: git add -A && git commit -m "fix #{{issue_num}}: <description>"
3. Output "SUBPHASE:<short-name>" on its own line before each commit
4. Before starting EACH sub-task, output: "SUBPHASE:<short-name>" on its own line.

Example sub-phase names:
  SUBPHASE:add-effectStack-to-GameState
  SUBPHASE:implement-canAutoAdvance-logic
  SUBPHASE:write-phase-advance-tests
  SUBPHASE:fix-scheduleAIMove
  SUBPHASE:add-unit-test-for-X
  SUBPHASE:refactor-handlePass
  SUBPHASE:verify-edge-case-Y

COMMIT FORMAT:
  After each commit, output: git log -1 --pretty=format:"COMMIT:%H"
  (On a line by itself — so the pipeline can capture the hash)

TIMEOUT SAFETY:
- If you are approaching the time limit (~25 min), commit what you have NOW.
- Partial commits are fine — the pipeline will resume from your last sub-phase.
- The WIP commit is automatic on the server side; your job is to ensure every
  meaningful step is already committed before that happens.

- Output "SUBPHASE:<name>" before each meaningful step (as described in step 4).
- Output "COMMIT:<hash>" on its own line when you have a final commit.
- Output "DONE" on its own line when everything is committed and tests pass.
"""


def build_code_review_prompt(issue_num, title, diff):
    return f"""You are performing a code review of your own changes for GitHub issue #{issue_num} in /home/panda/riftbound.

ISSUE #{issue_num}: {title}

YOUR CHANGES (git diff vs origin/master):
{diff[:8000] if diff else '(no changes detected)'}

{INSTRUCT_CODE_REVIEW}

SKILL TO LOAD (invoke NOW): requesting-code-review
Then perform a thorough code review following its checklist and two-stage process.

CODE REVIEW — two stages:

STAGE 1 — SPEC COMPLIANCE:
Does the code actually fix the issue? Check:
- Root cause was addressed (not just the symptom)
- The fix handles edge cases
- No functionality was accidentally broken

STAGE 2 — CODE QUALITY:
Run each check and report PASS/FAIL:

1. LINT: Run linter if available
   - Backend: cd /home/panda/riftbound/backend && npx eslint src/ --max-warnings=0 2>&1 || true
   - Frontend: cd /home/panda/riftbound/frontend && npx eslint src/ --max-warnings=0 2>&1 || true

2. TYPES: Run type checker
   - cd /home/panda/riftbound/backend && npx tsc --noEmit 2>&1
   - cd /home/panda/riftbound/frontend && npx tsc --noEmit 2>&1

3. SECURITY: No hardcoded secrets, no injection vectors, no eval(), no sensitive data logged

4. LOGIC: No off-by-one errors, no null/undefined access, error handling is appropriate

5. BACKWARDS COMPATIBILITY: Does this change break any existing API contracts?

6. YAGNI CHECK: Did you add code that isn't strictly needed for this fix?

FORMAT YOUR RESPONSE AS:
## Stage 1 — Spec Compliance: PASS/FAIL
<notes>

## Stage 2 — Code Quality:
### Lint: PASS/FAIL
### Types: PASS/FAIL
### Security: PASS/FAIL
### Logic: PASS/FAIL
### Backwards Compat: PASS/FAIL
### YAGNI: PASS/FAIL

## Overall: APPROVED / NEEDS_CHANGES

If NEEDS_CHANGES: describe what must be fixed.

Output "REVIEW_COMPLETE:<APPROVED|NEEDS_CHANGES>" on its own line when done.
"""


def build_qa_prompt(issue_num, title, changed_files,
                    backend_test_output, backend_build_output,
                    frontend_build_output, baseline_errors):
    files_str = "\n".join(f"- {f}" for f in changed_files)
    baseline_note = ""
    if baseline_errors:
        sample = list(baseline_errors)[:5]
        baseline_note = (
            f"\nNOTE: The following {len(baseline_errors)} pre-existing error lines were "
            f"detected in the codebase BEFORE your fix and have been filtered from "
            f"the output below. These are NOT your responsibility:\n"
            + "\n".join(f"  - {e}" for e in sample)
            + ("\n  ... and more" if len(baseline_errors) > 5 else "")
        )
    return f"""You are performing QA for GitHub issue #{issue_num} in /home/panda/riftbound.

ISSUE #{issue_num}: {title}

CHANGED FILES:
{files_str or "(no files changed)"}

{baseline_note}

{INSTRUCT_QA}

SKILL TO LOAD (invoke NOW): verification-before-completion
Then follow its two-stage verification process: verify command output BEFORE claiming PASS.

QA OUTPUT:

--- Backend Test Output ---
{backend_test_output or "(no test output)"}

--- Backend Build Output ---
{backend_build_output or "(no build output)"}

--- Frontend Build Output ---
{frontend_build_output or "(no frontend output)"}

YOUR TASK:
1. Review the above build and test output
2. Identify any failures introduced by your changes
3. Pre-existing errors (noted above) are NOT your responsibility
4. Run any additional tests you think are relevant

If there are FAILs or errors that are NOT in the pre-existing list above,
describe them and output:
  QA_COMPLETE:FAIL

If everything passes cleanly:
  QA_COMPLETE:PASS

Output "QA_COMPLETE:<PASS|FAIL>" on its own line when done.
"""


def build_push_prompt(issue_num, title, branch):
    return f"""You are pushing the changes for GitHub issue #{issue_num} in /home/panda/riftbound.

ISSUE #{issue_num}: {title}
BRANCH: {branch}

{INSTRUCT_PUSH}

STEPS:
1. Verify the branch is clean: git status
2. Push to origin: git push -u origin {branch}
3. Create PR via gh:
   gh pr create --title "fix #{issue_num}: {title}" \\
     --body "Fixes issue #{issue_num}" \\
     --head {branch} --base master
4. Output the PR URL on its own line: PR_URL:<url>

If the PR already exists (from a previous attempt), just push and output its URL.

Output "DONE" on its own line when the PR is created.
"""


# ─── Main ─────────────────────────────────────────────────────────────────────

def extract_result(log_path, prefix, multiline=False):
    """Find a RESULT line or section in log."""
    try:
        with open(log_path) as f:
            content = f.read()
        if not multiline:
            for line in content.splitlines():
                if prefix in line:
                    return line.strip()
            return ""
        # Multiline: find section from prefix header to DONE marker
        lines = content.splitlines()
        done_indices = [i for i, l in enumerate(lines) if l.strip() == "DONE"]
        if not done_indices:
            return ""
        for idx in reversed(done_indices):
            for i in range(idx - 1, -1, -1):
                if lines[i].startswith(prefix):
                    return "\n".join(lines[i:idx + 1])
        return ""
    except Exception:
        pass
    return ""


# Global num so git_wip_commit closure can reference it
num = None


def main():
    global num
    log("=" * 60)
    log("Riftbound-App Issue Agent — Tag-Based Pipeline")
    log("=" * 60)

    # ── 1. Sync git — fast-forward only, zero conflicts ─────────────────────
    log("[SYNC] Fetching and fast-forwarding to origin/master...")
    fetch_master()
    run("git checkout master 2>&1")
    result = run("git merge origin/master --ff-only 2>&1")
    if result != "":
        # --ff-only fails if local has diverged — push local commits first
        log("  [SYNC] Local master diverged — pushing local commits first...")
        run("git push origin master 2>&1")
        result = run("git merge origin/master --ff-only 2>&1")
    log(f"  [SYNC] master is up-to-date with origin/master")

    if not acquire_lock():
        log("Another agent is running — exiting.")
        return

    ts = datetime.now().strftime("%Y%m%d_%H%M%S")

    while True:
        try:
            # ── 2. Pick an issue ────────────────────────────────────────────────
            log("[FETCH] Checking for untriaged issues...")
            issues = get_untriaged_issues()
            if not issues:
                log("  No untriaged issues. Done.")
                break

            issue = issues[0]
            num = issue["number"]
            title = issue["title"]
            body = issue.get("body", "") or ""
            log(f"  Selected: #{num} — {title[:60]}")

            # ── 3. Label issue as in-progress ────────────────────────────────
            label_issue(num, ["in-progress"])

            # ── 4. Determine branch strategy ────────────────────────────────
            existing_branch = find_issue_tag(num)
            branch = f"fix/issue-{num}_{ts}"
            resumed = False

            if existing_branch:
                log(f"  [RESUME] Found prior attempt on branch '{existing_branch}'")
                checkout_ok = run(f"git checkout {existing_branch} 2>&1")
                current = current_branch()
                if current == existing_branch:
                    # Rebase onto latest origin/master — fetch first
                    log(f"  [REBASE] Fetching and rebasing onto origin/master...")
                    fetch_master()
                    rebase_result = run(f"git rebase origin/master 2>&1")
                    if "CONFLICT" in rebase_result:
                        log(f"  [REBASE] Conflicts — aborting and starting fresh branch")
                        run("git rebase --abort 2>&1")
                        run(f"git checkout -b {branch} origin/master 2>&1")
                    else:
                        branch = existing_branch
                        resumed = True
                        log(f"  [REBASE] Success — resuming on '{branch}'")
                else:
                    log(f"  [WARN] Could not checkout '{existing_branch}' — fresh start")
            else:
                # Fresh start from origin/master
                run(f"git checkout -b {branch} origin/master 2>&1")

            # Mark current branch with tag
            update_issue_tag(num, branch)

            # ── 5. Load checkpoint from branch ─────────────────────────────
            cp = get_checkpoint_on_branch() if resumed else None
            findings = ""
            phases = {}
            # Preserve the original ts so we write back to the same log dir
            run_ts = ts
            if cp and resumed:
                findings = cp.get("findings", "")
                phases = cp.get("phases", {})
                run_ts = cp.get("ts", ts)  # use original ts, not fresh one
                log(f"  [CHECKPOINT] Loaded: phase={phases.get('2_IMPLEMENT')}, subphase={cp.get('impl_subphase')}, ts={run_ts}")

            # ── PHASE 1: INVESTIGATE ────────────────────────────────────────
            if not phases.get("1_INVESTIGATE"):
                log(f"\n[PHASE 1/{len(PHASES)}] INVESTIGATE — #{num}")
                investigate_log = WORKDIR / f".agent_logs/issue-{num}_{run_ts}/phase1.log"
                investigate_log.parent.mkdir(parents=True, exist_ok=True)
                ok, _ = spawn_hermes(
                    build_investigate_prompt(num, title, body),
                    str(investigate_log),
                    timeout_minutes=15
                )
                findings = extract_result(str(investigate_log), "## Root Cause", multiline=True)
                log(f"  Phase 1 complete — findings captured ({'ok' if ok else 'agent exited non-zero'})")
                phases["1_INVESTIGATE"] = "done" if ok else "incomplete"
                save_checkpoint_on_branch(num, {
                    "issue": num, "title": title, "branch": branch,
                    "findings": findings, "phases": phases, "ts": run_ts
                })
                if not ok:
                    push_branch_and_tag(branch, num)
                    remove_label(num, "in-progress")
                    label_issue(num, ["agent-error"])
                    release_lock()
                    log("  [AGENT-ERROR] Phase 1 failed — agent-error label added, exiting pipeline")
                    break  # don't loop — human must review before retry
            else:
                log(f"\n[PHASE 1/{len(PHASES)}] INVESTIGATE — #{num} [SKIP — already done]")

            # ── PHASE 2: IMPLEMENT ─────────────────────────────────────────
            if phases.get("2_IMPLEMENT", "").startswith("done:"):
                commit_hash = phases["2_IMPLEMENT"].replace("done:", "").strip()
                log(f"\n[PHASE 2/{len(PHASES)}] IMPLEMENT — #{num} [SKIP — committed: {commit_hash}]")
            else:
                log(f"\n[PHASE 2/{len(PHASES)}] IMPLEMENT — #{num}")
                implement_log = WORKDIR / f".agent_logs/issue-{num}_{run_ts}/phase2.log"
                implement_log.parent.mkdir(parents=True, exist_ok=True)

                saved_subphase = cp.get("impl_subphase") if cp else None
                if saved_subphase:
                    log(f"  [RESUME] IMPLEMENT from sub-phase: {saved_subphase}")

                ok, timed_out = spawn_hermes(
                    build_implement_prompt(num, title, body, findings, resume_subphase=saved_subphase),
                    str(implement_log),
                    timeout_minutes=IMPL_TIMEOUT_MIN,
                    issue_num=num,
                    subphase=saved_subphase or "implement"
                )

                commit_line = extract_result(str(implement_log), "COMMIT:")
                commit_hash = commit_line.replace("COMMIT:", "").strip() if commit_line else ""
                log(f"  Phase 2 complete — commit: {commit_hash or '(none)'}")

                last_subphase = extract_result(str(implement_log), "SUBPHASE:").replace("SUBPHASE:", "").strip()

                phases["2_IMPLEMENT"] = f"done:{commit_hash}" if commit_hash else "incomplete"
                save_checkpoint_on_branch(num, {
                    "issue": num, "title": title, "branch": branch,
                    "findings": findings, "phases": phases, "ts": run_ts,
                    "impl_subphase": last_subphase or None,
                })

                if ok and commit_hash and not timed_out:
                    log("  [VERIFY] Running post-IMPLEMENT verification...")
                    diff_stat = run("git diff origin/master --stat 2>&1")
                    log(f"  [VERIFY] Changes: {diff_stat.strip()[:200] if diff_stat else '(no diff)'}")
                    changed_files = get_changed_source_files()
                    if changed_files:
                        affected = get_affected_tests(changed_files)
                        if affected:
                            smoke = run(
                                f"cd /home/panda/riftbound/backend && npm test -- {' '.join(affected[:3])} 2>&1",
                                timeout=90
                            )
                            log(f"  [VERIFY] Smoke: {'PASS' if 'error' not in smoke[:200] else 'FAIL'}")
                elif not ok:
                    push_branch_and_tag(branch, num)
                    remove_label(num, "in-progress")
                    label_issue(num, ["agent-error"])
                    release_lock()
                    log("  [AGENT-ERROR] IMPLEMENT failed — agent-error label added, exiting pipeline")
                    break  # don't loop — human must review before retry

            # ── PHASE 3: CODE REVIEW ────────────────────────────────────────
            if phases.get("3_CODE_REVIEW") == "done":
                log(f"\n[PHASE 3/{len(PHASES)}] CODE REVIEW — #{num} [SKIP — already done]")
            else:
                log(f"\n[PHASE 3/{len(PHASES)}] CODE REVIEW — #{num}")
                changed_files = get_changed_source_files()
                diff = get_git_diff()
                log(f"  Changed files: {len(changed_files)}")
                review_log = WORKDIR / f".agent_logs/issue-{num}_{run_ts}/phase3.log"
                review_log.parent.mkdir(parents=True, exist_ok=True)
                ok, _ = spawn_hermes(
                    build_code_review_prompt(num, title, diff),
                    str(review_log),
                    timeout_minutes=20,
                    issue_num=num,
                    subphase="code-review"
                )
                review_result = extract_result(str(review_log), "REVIEW_COMPLETE:")
                log(f"  Phase 3 complete — {review_result}")
                phases["3_CODE_REVIEW"] = "done" if (review_result and "APPROVED" in review_result) else "incomplete"
                save_checkpoint_on_branch(num, {
                    "issue": num, "title": title, "branch": branch,
                    "findings": findings, "phases": phases, "ts": run_ts
                })
                if not review_result or "APPROVED" not in (review_result or ""):
                    log("  REVIEW: NEEDS_CHANGES — will retry next cycle")
                    comment_issue(num,
                        f"## Code Review: NEEDS_CHANGES\n\n"
                        f"The code review found issues that must be addressed.\n"
                        f"The agent will retry automatically on the next cycle.\n"
                        f"Branch: `{branch}`"
                    )
                    remove_label(num, "in-progress")
                    label_issue(num, ["needs-review"])
                    push_branch_and_tag(branch, num)
                    release_lock()
                    continue

            # ── PHASE 4: QA ────────────────────────────────────────────────
            if phases.get("4_QA") == "done":
                log(f"\n[PHASE 4/{len(PHASES)}] QA — #{num} [SKIP — already done]")
            else:
                log(f"\n[PHASE 4/{len(PHASES)}] QA — #{num}")

                # Re-fetch with source-only filter (code review may have used broader scan)
                changed_files = get_changed_source_files()

                if not changed_files:
                    log("  [QA] No source files changed — skipping QA")
                    phases["4_QA"] = "done"
                    save_checkpoint_on_branch(num, {
                        "issue": num, "title": title, "branch": branch,
                        "findings": findings, "phases": phases, "ts": run_ts
                    })
                    release_lock()
                    continue

                log("  [BASELINE] Capturing pre-existing errors on origin/master...")
                ts_errors, test_failures = get_pre_existing_errors()

                log("  [QA] Running backend tests...")
                affected_tests = get_affected_tests(changed_files)
                test_files_arg = " ".join(affected_tests) if affected_tests else ""
                backend_test_raw = (
                    run(f"cd /home/panda/riftbound/backend && npm test -- {test_files_arg} 2>&1", timeout=120)
                    if affected_tests else "NO AFFECTED TESTS"
                )
                backend_test_filtered, _ = filter_baseline_errors(backend_test_raw, ts_errors, test_failures)

                log("  [QA] Running backend build...")
                backend_build_raw = run("cd /home/panda/riftbound/backend && npm run build 2>&1", timeout=120)
                backend_build_filtered, _ = filter_baseline_errors(backend_build_raw, ts_errors, test_failures)

                log("  [QA] Running frontend build...")
                frontend_build_raw = run("cd /home/panda/riftbound/frontend && npx vite build 2>&1", timeout=120)
                frontend_build_filtered, _ = filter_baseline_errors(frontend_build_raw, ts_errors, test_failures)

                MAX_QA_LINES = 150
                def cap_output(output):
                    lines = (output or "").splitlines()
                    return "\n".join(lines[:MAX_QA_LINES]) + \
                        (f"\n... [{len(lines)-MAX_QA_LINES}] more lines" if len(lines) > MAX_QA_LINES else "")

                qa_log = WORKDIR / f".agent_logs/issue-{num}_{run_ts}/phase4.log"
                qa_log.parent.mkdir(parents=True, exist_ok=True)
                ok, _ = spawn_hermes(
                    build_qa_prompt(num, title, changed_files,
                                   cap_output(backend_test_filtered),
                                   cap_output(backend_build_filtered),
                                   cap_output(frontend_build_filtered),
                                   ts_errors),
                    str(qa_log),
                    timeout_minutes=20
                )
                qa_result = extract_result(str(qa_log), "QA_COMPLETE:")
                log(f"  Phase 4 complete — {qa_result}")

                qa_pass = False
                if qa_result:
                    for line in qa_result.splitlines():
                        if line.strip().startswith("QA_COMPLETE:"):
                            qa_pass = line.strip().endswith(":PASS")
                            break

                phases["4_QA"] = "done" if qa_pass else "fail"
                save_checkpoint_on_branch(num, {
                    "issue": num, "title": title, "branch": branch,
                    "findings": findings, "phases": phases, "ts": run_ts
                })

                if not qa_pass:
                    log("  QA: FAIL — will retry next cycle")
                    comment_issue(num,
                        f"## QA Check: FAILED\n\n"
                        f"QA phase found failures. The agent will retry automatically.\n"
                        f"Branch: `{branch}`\n"
                        f"QA log: `.agent_logs/issue-{num}_{run_ts}/phase4.log`"
                    )
                    remove_label(num, "in-progress")
                    label_issue(num, ["qa-failed"])
                    push_branch_and_tag(branch, num)
                    release_lock()
                    continue

            # ── PHASE 5: PUSH ────────────────────────────────────────────────
            if phases.get("5_PUSH", "").startswith("done:"):
                pr_url = phases["5_PUSH"].replace("done:", "").strip()
                log(f"\n[PHASE 5/{len(PHASES)}] PUSH — #{num} [SKIP — done: {pr_url}]")
            else:
                log(f"\n[PHASE 5/{len(PHASES)}] PUSH — #{num}")
                push_log = WORKDIR / f".agent_logs/issue-{num}_{run_ts}/phase5.log"
                push_log.parent.mkdir(parents=True, exist_ok=True)
                ok, _ = spawn_hermes(
                    build_push_prompt(num, title, branch),
                    str(push_log),
                    timeout_minutes=10
                )
                pr_url = extract_result(str(push_log), "PR_URL:").replace("PR_URL:", "").strip()
                log(f"  Phase 5 complete — PR: {pr_url or '(not found)'}")
                phases["5_PUSH"] = f"done:{pr_url}" if pr_url else "incomplete"
                save_checkpoint_on_branch(num, {
                    "issue": num, "title": title, "branch": branch,
                    "findings": findings, "phases": phases, "ts": run_ts
                })
                if not pr_url:
                    comment_issue(num,
                        f"## Push Failed\n\n"
                        f"Could not automatically push the PR. "
                        f"Branch `{branch}` is ready. Please review and push manually."
                    )
                    remove_label(num, "in-progress")
                    label_issue(num, ["push-failed"])
                    push_branch_and_tag(branch, num)
                    release_lock()
                    continue

            # ── DONE ─────────────────────────────────────────────────────────
            pr_url = phases.get("5_PUSH", "").replace("done:", "").strip()
            log(f"\n  Issue #{num} complete — PR ready for human review")
            log(f"  Branch: {branch}")
            log(f"  PR:     {pr_url}")
            remove_label(num, "in-progress")
            label_issue(num, ["in-review"])
            push_branch_and_tag(branch, num)

        finally:
            release_lock()
            log("\nAgent run complete.")
if __name__ == "__main__":
    main()
