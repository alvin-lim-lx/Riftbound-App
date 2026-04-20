#!/usr/bin/env python3
"""
GitHub Issue Agent for Riftbound-App — Robust Pipeline Edition

PHASES:
  1. INVESTIGATE  — understand the issue, explore codebase
  2. IMPLEMENT     — write the fix
  3. CODE REVIEW   — hermes reviews its own diff (lint, typecheck, security)
  4. QA            — run tests, build attempts
  5. PUSH          — only if review+QA passed; post PR link
  6. CLOSE         — close issue with PR link (or flag for human review on failure)

Each phase logs to .agent_logs/issue-{num}_{phase}.log
Lock file: .agent.lock (prevents concurrent runs)
"""

import subprocess
import json
import re
import os
import socket
import sys
from pathlib import Path
from datetime import datetime

REPO = "alvin-lim-lx/Riftbound-App"
WORKDIR = "/home/panda/riftbound"
LOCKFILE = "/home/panda/riftbound/.agent.lock"
LOGDIR = Path("/home/panda/riftbound/.agent_logs")
LOGDIR.mkdir(exist_ok=True)

# Phase definitions
PHASES = ["INVESTIGATE", "IMPLEMENT", "CODE_REVIEW", "QA", "PUSH", "CLOSE"]


def log(msg):
    ts = datetime.now().strftime("%H:%M:%S")
    print(f"[{ts}] {msg}")


def run(cmd, capture=True, timeout=120):
    r = subprocess.run(
        cmd, shell=True, capture_output=capture, text=True,
        cwd=WORKDIR, env=os.environ.copy(), timeout=timeout
    )
    if r.returncode != 0 and capture and r.stderr.strip():
        log(f"  [WARN] cmd '{cmd[:60]}...' returned {r.returncode}")
        for line in r.stderr.strip().splitlines()[:3]:
            log(f"         {line}")
    return r.stdout.strip() if capture else r.returncode == 0


def gh_json(endpoint):
    token = run("gh auth token").strip()
    cmd = (f"curl -s -H 'Authorization: token {token}' "
           f"'https://api.github.com{endpoint}'")
    out = run(cmd)
    try:
        return json.loads(out)
    except json.JSONDecodeError:
        log(f"  [ERROR] Failed to parse JSON from {endpoint}")
        return {}


def gh(method, endpoint, data=None):
    token = run("gh auth token").strip()
    body = json.dumps(data) if data else ""
    data_arg = f"-d '{body}'" if body else ""
    cmd = (f"curl -s -X {method} "
           f"-H 'Authorization: token {token}' "
           f"-H 'Content-Type: application/json' "
           f"{data_arg} "
           f"'https://api.github.com{endpoint}'")
    return run(cmd)


def label_issue(issue_num, labels):
    gh("POST", f"/repos/{REPO}/issues/{issue_num}/labels", {"labels": labels})


def remove_label(issue_num, label):
    gh("DELETE", f"/repos/{REPO}/issues/{issue_num}/labels/{label}")


def comment_issue(issue_num, body):
    gh("POST", f"/repos/{REPO}/issues/{issue_num}/comments", {"body": body})


def close_issue(issue_num, reason="completed"):
    gh("PATCH", f"/repos/{REPO}/issues/{issue_num}",
       {"state": "closed", "state_reason": reason})


def get_untriaged_issues():
    issues = gh_json(f"/repos/{REPO}/issues?state=open&per_page=30")
    if not isinstance(issues, list):
        log(f"  [ERROR] Unexpected API response: {issues}")
        return []
    result = []
    for i in issues:
        if "pull_request" in i:
            continue
        labels = [l["name"] for l in i.get("labels", [])]
        skip = {"in-progress", "done", "wontfix", "discussion"}
        if any(l in skip for l in labels):
            continue
        result.append(i)
    return result


def create_branch_name(issue_num, title):
    safe = re.sub(r'[^a-zA-Z0-9_-]', '-', title.lower())[:50]
    return f"fix/issue-{issue_num}-{safe}"


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


def get_changed_files(branch):
    """Return list of files changed vs origin/master."""
    run(f"git fetch origin master 2>&1")
    out = run(f"git diff origin/master --name-only 2>&1")
    return [f for f in out.strip().splitlines() if f]


def get_git_diff(branch):
    run(f"git fetch origin master 2>&1")
    return run(f"git diff origin/master..HEAD 2>&1")


# ─── Phase prompts ────────────────────────────────────────────────────────────

def build_investigate_prompt(issue_num, title, body):
    return f"""You are investigating GitHub issue #{issue_num} in /home/panda/riftbound.

ISSUE #{issue_num}: {title}
BODY:
{body[:3000] if body else '(no description)'}

YOUR TASK:
1. Read the full issue carefully
2. Explore the relevant parts of the codebase
3. Identify which files need to change and what the fix should look like
4. Write your findings as a detailed plan

FORMAT YOUR RESPONSE AS:
## Understanding
<what the issue is about>

## Files Likely to Change
- file1.ts
- file2.tsx

## Proposed Fix Summary
<concise description of what to change>

## Verification Plan
<how you will verify the fix works>

Stop after planning. Do NOT make any code changes yet.
Output "DONE" on its own line when finished.
"""


def build_implement_prompt(issue_num, title, body, findings):
    return f"""You are implementing the fix for GitHub issue #{issue_num} in /home/panda/riftbound.

ISSUE #{issue_num}: {title}
ISSUE BODY:
{body[:3000] if body else '(no description)'}

YOUR PLAN (from investigation phase):
{findings}

YOUR TASK:
1. Make the necessary code changes to fix this issue
2. If the issue is unclear, make a reasonable best-effort attempt
3. Write a test that would pass if the fix works (put it in the appropriate tests/ directory)
4. Run the existing test suite: cd /home/panda/riftbound/backend && npm test 2>&1
5. Fix any test failures your changes introduced before committing
6. Stage and commit your changes with message: "fix #{issue_num}: {title[:60]}"
   (Do NOT push yet — the next phase will handle that)
7. Run: git log -1 --pretty=format:"COMMIT:%H" to capture the commit hash

IMPORTANT:
- Only modify files under /home/panda/riftbound
- Make atomic, focused commits
- If tests fail, fix the underlying issue, not the tests
- Do NOT run npm install or add new dependencies without justification
- Do NOT push

Output "COMMIT:<hash>" on its own line when you have committed your changes.
Then output "DONE" on its own line.
"""


def build_code_review_prompt(issue_num, title, diff):
    return f"""You are performing a code review of your own changes for GitHub issue #{issue_num} in /home/panda/riftbound.

ISSUE #{issue_num}: {title}

YOUR CHANGES (git diff vs origin/master):
{diff[:8000] if diff else '(no changes detected)'}

CODE REVIEW CHECKLIST — examine each item and report PASS or FAIL with explanation:

1. LINT: Run the linter if available and report any errors
   - Backend: cd /home/panda/riftbound/backend && npx eslint src/ --max-warnings=0 2>&1 || true
   - Frontend: cd /home/panda/riftbound/frontend && npx eslint src/ --max-warnings=0 2>&1 || true

2. TYPES: Run the type checker and report any errors
   - cd /home/panda/riftbound/backend && npx tsc --noEmit 2>&1
   - cd /home/panda/riftbound/frontend && npx tsc --noEmit 2>&1

3. SECURITY: Check for common security issues in your diff:
   - No hardcoded secrets, API keys, or credentials
   - No SQL injection vectors (user input properly parameterized)
   - No eval() or other dangerous patterns
   - No sensitive data logged

4. LOGIC: Review the changed code for correctness:
   - No off-by-one errors
   - No null/undefined access issues
   - Error handling is appropriate

5. BACKWARDS COMPATIBILITY: Does this change break any existing API contracts?

FORMAT YOUR RESPONSE AS:
## Lint Result: PASS/FAIL
<details if fail>
<error output>
</details>

## Type Check Result: PASS/FAIL
<details if fail>
<type errors>
</details>

## Security Result: PASS/FAIL
<details if fail>
<issues found>
</details>

## Logic Review: PASS/FAIL
<details if fail>
<issues found>
</details>

## Overall: APPROVED / NEEDS_CHANGES

If NEEDS_CHANGES: describe what must be fixed before this can be approved.

Output "REVIEW_COMPLETE:<APPROVED|NEEDS_CHANGES>" on its own line when done.
"""


def build_qa_prompt(issue_num, title, changed_files):
    files_str = "\n".join(f"- {f}" for f in changed_files)
    return f"""You are performing QA for GitHub issue #{issue_num} in /home/panda/riftbound.

ISSUE #{issue_num}: {title}

CHANGED FILES:
{files_str}

QA CHECKLIST — run each and report PASS/FAIL:

1. BACKEND TESTS:
   cd /home/panda/riftbound/backend && npm test 2>&1
   - If tests fail, this is a FAIL
   - If there are no tests for the changed code, note it as "NO TEST COVERAGE" (not a failure)

2. FRONTEND BUILD:
   cd /home/panda/riftbound/frontend && npx vite build 2>&1
   - Build must succeed without errors
   - Warnings are acceptable

3. BACKEND BUILD:
   cd /home/panda/riftbound/backend && npm run build 2>&1
   - Build must succeed without errors

4. SYNTAX/SANITY: Check the changed files for any obvious issues:
   - No import errors (all referenced modules exist)
   - No circular dependencies introduced
   - No large debugging console.log statements left in

FORMAT YOUR RESPONSE AS:
## Backend Tests: PASS/FAIL/NO_COVERAGE
<output summary>

## Backend Build: PASS/FAIL
<output summary>

## Frontend Build: PASS/FAIL
<output summary>

## Sanity Check: PASS/FAIL
<notes>

## Overall QA: PASS/FAIL

If FAIL on any critical item (tests, builds), the overall is FAIL.
Output "QA_COMPLETE:<PASS|FAIL>" on its own line when done.
"""


def build_push_prompt(issue_num, title, branch):
    return f"""You are the PUSH phase for GitHub issue #{issue_num}.

ISSUE #{issue_num}: {title}
BRANCH: {branch}

TASK:
1. Verify your branch is up to date: git status
2. Push the branch: git push -u origin {branch}
3. Create a pull request:
   gh pr create \
     --repo alvin-lim-lx/Riftbound-App \
     --title "fix #{issue_num}: {title[:60]}" \
     --body "## Summary
Closes #{issue_num}

## Changes
- Fixes issue #{issue_num}

## Testing
- Tests passed: yes
- Build verified: yes

## Code Review
- Self-review completed
- Lint: passed
- Type check: passed
" 2>&1
4. Extract the PR URL from the output
5. Print: PR_URL:<https://github.com/alvin-lim-lx/Riftbound-App/pull/N>
6. Print: PR_NUMBER:<N>

Output "PUSH_COMPLETE" on its own line when done.
"""


# ─── Agent runner ─────────────────────────────────────────────────────────────

def spawn_hermes(prompt, log_path, timeout_minutes=20):
    """Run hermes with a one-shot prompt, streaming to log_path."""
    env = os.environ.copy()
    env["HERMES_NO_ANALYTICS"] = "1"

    log_file = open(log_path, "w", buffering=1)

    try:
        proc = subprocess.Popen(
            ["hermes", "chat", "-q", prompt,
             "--source", "github-issue-agent",
             "--pass-session-id"],
            cwd=WORKDIR,
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1
        )

        for line in proc.stdout:
            log_file.write(line)
            log_file.flush()

        returncode = proc.wait()
    finally:
        log_file.close()

    return returncode == 0


def extract_result(log_path, prefix):
    """Find a RESULT line like 'DONE' or 'REVIEW_COMPLETE:APPROVED' in log."""
    try:
        with open(log_path) as f:
            for line in f:
                if prefix in line:
                    return line.strip()
    except Exception:
        pass
    return ""


def extract_pr_url(log_path):
    for pattern in [
        re.compile(r'PR_URL:(https://github\.com/alvin-lim-lx/Riftbound-App/pull/\d+)'),
        re.compile(r'(https://github\.com/alvin-lim-lx/Riftbound-App/pull/\d+)'),
    ]:
        try:
            with open(log_path) as f:
                for line in f:
                    m = pattern.search(line)
                    if m:
                        return m.group(1)
        except Exception:
            pass
    return ""


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    log("=" * 60)
    log("Riftbound-App Issue Agent — Robust Pipeline")
    log("=" * 60)

    # Sync git
    log("[SYNC] Pulling latest master...")
    run("git fetch origin master 2>&1")
    run("git checkout master 2>&1")
    run("git pull origin master 2>&1")

    if not acquire_lock():
        log("Another agent is running — exiting.")
        return

    ts = datetime.now().strftime("%Y%m%d_%H%M%S")

    try:
        log("[FETCH] Checking for untriaged issues...")
        issues = get_untriaged_issues()
        if not issues:
            log("  No untriaged issues. Done.")
            return

        issue = issues[0]
        num = issue["number"]
        title = issue["title"]
        body = issue.get("body", "") or ""
        log(f"  Selected: #{num} — {title}")

        branch = create_branch_name(num, title)
        branch_log = LOGDIR / f"issue-{num}_{ts}"
        branch_log.mkdir(exist_ok=True)

        # Track per-phase results
        phase_results = {}
        findings = ""

        # ── PHASE 1: INVESTIGATE ───────────────────────────────────────────
        log(f"\n[PHASE 1/{len(PHASES)}] INVESTIGATE — #{num}")
        label_issue(num, ["in-progress"])
        run(f"git checkout -b {branch} origin/master 2>&1")

        investigate_log = branch_log / "phase1_investigate.log"
        ok = spawn_hermes(
            build_investigate_prompt(num, title, body),
            str(investigate_log),
            timeout_minutes=15
        )
        findings = extract_result(str(investigate_log), "## Understanding")
        log(f"  Phase 1 complete — findings captured ({'ok' if ok else 'agent exited non-zero'})")

        # ── PHASE 2: IMPLEMENT ─────────────────────────────────────────────
        log(f"\n[PHASE 2/{len(PHASES)}] IMPLEMENT — #{num}")
        implement_log = branch_log / "phase2_implement.log"
        ok = spawn_hermes(
            build_implement_prompt(num, title, body, findings),
            str(implement_log),
            timeout_minutes=25
        )
        phase_results["IMPLEMENT"] = ok
        commit_line = extract_result(str(implement_log), "COMMIT:")
        log(f"  Phase 2 complete — commit: {commit_line or '(none)'}")
        if not ok:
            _handle_failure(num, title, branch, branch_log, "IMPLEMENT phase failed")
            return

        changed_files = get_changed_files(branch)
        diff = get_git_diff(branch)
        log(f"  Changed files: {len(changed_files)} — {changed_files[:3]}")

        # ── PHASE 3: CODE REVIEW ───────────────────────────────────────────
        log(f"\n[PHASE 3/{len(PHASES)}] CODE REVIEW — #{num}")
        review_log = branch_log / "phase3_review.log"
        ok = spawn_hermes(
            build_code_review_prompt(num, title, diff),
            str(review_log),
            timeout_minutes=20
        )
        review_result = extract_result(str(review_log), "REVIEW_COMPLETE:")
        log(f"  Phase 3 complete — {review_result}")

        # Parse review outcome
        approved = "APPROVED" in (review_result or "")
        if not approved:
            log("  REVIEW: NEEDS_CHANGES — agent will self-fix in next iteration")
            # Comment about the review failure and leave branch for next cycle
            comment_issue(num,
                f"## Code Review: NEEDS CHANGES\n\n"
                f"The code review found issues that must be addressed.\n\n"
                f"Review log available at branch `{branch}`, file "
                f"`.agent_logs/issue-{num}_{ts}/phase3_review.log`.\n\n"
                f"The agent will retry automatically on the next 30-minute cycle."
            )
            remove_label(num, "in-progress")
            label_issue(num, ["needs-review"])
            run("git checkout master 2>&1")
            run(f"git branch -D {branch} 2>&1")
            release_lock()
            return

        # ── PHASE 4: QA ────────────────────────────────────────────────────
        log(f"\n[PHASE 4/{len(PHASES)}] QA — #{num}")
        qa_log = branch_log / "phase4_qa.log"
        ok = spawn_hermes(
            build_qa_prompt(num, title, changed_files),
            str(qa_log),
            timeout_minutes=25
        )
        qa_result = extract_result(str(qa_log), "QA_COMPLETE:")
        log(f"  Phase 4 complete — {qa_result}")

        qa_pass = "PASS" in (qa_result or "") and "FAIL" not in (qa_result or "")
        if not qa_pass:
            log("  QA: FAIL — agent will retry on next cycle")
            comment_issue(num,
                f"## QA Check: FAILED\n\n"
                f"QA phase found failures. The agent will retry automatically.\n\n"
                f"QA log: `.agent_logs/issue-{num}_{ts}/phase4_qa.log`\n\n"
                f"Branch `{branch}` is preserved for inspection."
            )
            remove_label(num, "in-progress")
            label_issue(num, ["qa-failed"])
            run("git checkout master 2>&1")
            release_lock()
            return

        # ── PHASE 5: PUSH ──────────────────────────────────────────────────
        log(f"\n[PHASE 5/{len(PHASES)}] PUSH — #{num}")
        push_log = branch_log / "phase5_push.log"
        ok = spawn_hermes(
            build_push_prompt(num, title, branch),
            str(push_log),
            timeout_minutes=10
        )
        pr_url = extract_pr_url(str(push_log))
        log(f"  Phase 5 complete — PR: {pr_url or '(not found)'}")
        if not ok or not pr_url:
            comment_issue(num,
                f"## Push Failed\n\n"
                f"Could not automatically push the PR. "
                f"Branch `{branch}` is ready. Please review and push manually.\n\n"
                f"Push log: `.agent_logs/issue-{num}_{ts}/phase5_push.log`"
            )
            remove_label(num, "in-progress")
            label_issue(num, ["push-failed"])
            run("git checkout master 2>&1")
            release_lock()
            return

        # ── PHASE 6: CLOSE ────────────────────────────────────────────────
        log(f"\n[PHASE 6/{len(PHASES)}] CLOSE — #{num}")
        close_msg = (
            f"## AI Agent Completed ✓\n\n"
            f"An autonomous agent investigated and fixed this issue through a 5-phase pipeline:\n\n"
            f"1. **Investigate** — understood the issue and formed a plan\n"
            f"2. **Implement** — wrote the fix + tests\n"
            f"3. **Code Review** — self-review: lint ✓, types ✓, security ✓\n"
            f"4. **QA** — tests passed, builds verified\n"
            f"5. **Push** — PR created\n\n"
            f"**Pull Request:** {pr_url}\n\n"
            f"Please review and merge the PR to complete this issue."
        )
        comment_issue(num, close_msg)
        # Leave issue open — human must merge PR to officially close
        log(f"\n  Issue #{num} left OPEN — PR ready for human review")
        log(f"  Branch: {branch}")
        log(f"  PR:     {pr_url}")

    finally:
        release_lock()
        log("\nAgent run complete.")


def _handle_failure(issue_num, title, branch, branch_log, reason):
    log(f"\n[FATAL] {reason}")
    comment_issue(issue_num,
        f"## Agent Failed: {reason}\n\n"
        f"The agent encountered an error and could not complete this issue.\n\n"
        f"Branch `{branch}` may contain partial work.\n"
        f"Logs: `.agent_logs/`"
    )
    remove_label(issue_num, "in-progress")
    label_issue(issue_num, ["agent-error"])
    run("git checkout master 2>&1")


if __name__ == "__main__":
    main()
