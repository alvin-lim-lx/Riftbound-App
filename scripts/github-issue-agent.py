#!/usr/bin/env python3
"""
GitHub Issue Agent for Riftbound-App
Polls for untriaged issues, spawns hermes to fix them, posts PR link on the issue.

Lock file: /home/panda/riftbound/.agent.lock
If locked, a run is already in progress — exit early.
"""

import subprocess
import sys
import json
import re
import os
import argparse
import socket
import tempfile
from pathlib import Path
from datetime import datetime

REPO = "alvin-lim-lx/Riftbound-App"
WORKDIR = "/home/panda/riftbound"
LOCKFILE = "/home/panda/riftbound/.agent.lock"
LOGDIR = Path("/home/panda/riftbound/.agent_logs")
LOGDIR.mkdir(exist_ok=True)


def log(msg):
    ts = datetime.now().strftime("%H:%M:%S")
    print(f"[{ts}] {msg}")


def run(cmd, capture=True):
    """Run a shell command, return stdout."""
    r = subprocess.run(cmd, shell=True, capture_output=capture,
                       text=True, cwd=WORKDIR, env=os.environ.copy())
    if r.returncode != 0 and capture and r.stderr.strip():
        print(f"  [WARN] cmd failed: {cmd[:80]}...")
        print(f"         {r.stderr.strip()[:200]}")
    return r.stdout.strip() if capture else ""


def gh_json(endpoint):
    """GET an api.github.com endpoint, return parsed JSON."""
    token = run("gh auth token").strip()
    curl = f"curl -s -H 'Authorization: token {token}' 'https://api.github.com{endpoint}'"
    out = run(curl)
    try:
        return json.loads(out)
    except json.JSONDecodeError:
        print(f"  [ERROR] Failed to parse JSON from {endpoint}")
        return {}


def gh(method, endpoint, data=None):
    """Generic HTTP method helper for GitHub API."""
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
    gh("POST", f"/repos/{REPO}/issues/{issue_num}/labels",
       {"labels": labels})


def comment_issue(issue_num, body):
    gh("POST", f"/repos/{REPO}/issues/{issue_num}/comments",
       {"body": body})


def close_issue(issue_num):
    gh("PATCH", f"/repos/{REPO}/issues/{issue_num}",
       {"state": "closed", "state_reason": "completed"})


def remove_label(issue_num, label):
    gh("DELETE", f"/repos/{REPO}/issues/{issue_num}/labels/{label}")


def get_untriaged_issues():
    """Fetch open issues without 'in-progress' or 'done' labels."""
    issues = gh_json(f"/repos/{REPO}/issues?state=open&per_page=30")
    if not isinstance(issues, list):
        print(f"  [ERROR] Unexpected API response: {issues}")
        return []
    result = []
    for i in issues:
        if "pull_request" in i:
            continue
        labels = [l["name"] for l in i.get("labels", [])]
        skip_labels = {"in-progress", "done", "wontfix", "discussion"}
        if any(l in skip_labels for l in labels):
            continue
        result.append(i)
    return result


def create_branch_name(issue_num, title):
    safe = re.sub(r'[^a-zA-Z0-9_-]', '-', title.lower())[:50]
    return f"fix/issue-{issue_num}-{safe}"


def acquire_lock():
    """Write our PID + hostname to lockfile. Returns False if already locked."""
    if Path(LOCKFILE).exists():
        try:
            with open(LOCKFILE) as f:
                pid, host = f.read().strip().split("|")
            # Check if process still alive
            if int(pid) == os.getpid():
                return True  # we hold the lock
            alive = os.kill(int(pid), 0) is None if os.name != 'nt' else True
            if not alive:
                log(f"Stale lock from {host} PID {pid} — removing")
                Path(LOCKFILE).unlink()
            else:
                log(f"Lock held by {host} PID {pid} — exiting")
                return False
        except Exception:
            Path(LOCKFILE).unlink()

    with open(LOCKFILE, "w") as f:
        f.write(f"{os.getpid()}|{socket.gethostname()}")
    return True


def release_lock():
    Path(LOCKFILE).unlink(missing_ok=True)


def build_agent_prompt(issue_num, title, body, branch):
    return f"""You are an autonomous coding agent fixing GitHub issue #{issue_num} in the Riftbound-App repository.

## Issue #{issue_num}
Title: {title}
Body:
{body[:3000] if body else '(no description)'}

## Your Mission
1. Explore the codebase at /home/panda/riftbound to understand its structure
2. Understand what the issue is asking for
3. Implement the fix or feature
4. Write/update tests if applicable
5. Commit your changes with message: "fix #{issue_num}: {title[:60]}"
6. Push the branch: git push -u origin {branch}
7. Create a PR:
   gh pr create --repo alvin-lim-lx/Riftbound-App \
     --title "fix #{issue_num}: {title[:60]}" \
     --body "## Summary\\nCloses #{issue_num}\\n\\n## Changes\\n- <describe what changed>\\n\\n## Testing\\n- <how was this tested>"
8. On success, print the exact PR URL on its own line: PR_URL:<url>

## Rules
- If the issue is unclear, make a best-effort fix — do NOT ask for help
- Only edit files under /home/panda/riftbound
- Keep commits clean and atomic
- When done, print "DONE" on its own line
- Do NOT merge the PR

Working directory: /home/panda/riftbound
Start now.
"""


def run_hermes_agent(prompt, log_path):
    """Spawn hermes as a background subprocess, streaming to log_path."""
    env = os.environ.copy()
    env["HERMES_NO_ANALYTICS"] = "1"

    log_file = open(log_path, "w", buffering=1)

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

    proc.wait()
    log_file.close()
    return proc.returncode


def extract_pr_url(log_path):
    """Find PR URL from agent log."""
    pr_patterns = [
        re.compile(r'PR_URL:(https://github\.com/alvin-lim-lx/Riftbound-App/pull/\d+)'),
        re.compile(r'(https://github\.com/alvin-lim-lx/Riftbound-App/pull/\d+)'),
        re.compile(r'Created PR #(\d+)'),
    ]
    for pattern in pr_patterns:
        with open(log_path) as f:
            for line in f:
                m = pattern.search(line)
                if m:
                    return m.group(1) if m.lastindex else f"https://github.com/alvin-lim-lx/Riftbound-App/pull/{m.group(1)}"
    return ""


def post_result(issue_num, title, branch, pr_url, log_path):
    """Comment on issue and close it."""
    if pr_url:
        msg = (
            f"## AI Agent Completed\n\n"
            f"An autonomous agent has investigated and attempted to fix this issue.\n\n"
            f"Pull request: {pr_url}\n\n"
            f"Please review the changes, merge the PR if satisfactory, "
            f"and this issue will be closed automatically."
        )
    else:
        msg = (
            f"## AI Agent Completed\n\n"
            f"Agent investigated issue #{issue_num} (`{title}`).\n\n"
            f"Branch `{branch}` was created with changes. "
            f"A PR may not have been created — please review and create one manually if needed.\n\n"
            f"Agent log: (see repository)"
        )

    comment_issue(issue_num, msg)
    close_issue(issue_num)


def main():
    log("=" * 60)
    log("Riftbound-App Issue Agent starting")
    log("=" * 60)

    # Sync git
    log("[1] Syncing with GitHub...")
    run("git fetch origin master 2>&1")
    run("git checkout master 2>&1")
    run("git pull origin master 2>&1")

    # Check lock
    if not acquire_lock():
        log("Another agent is running — exiting.")
        return

    try:
        # Find work
        log("[2] Checking for untriaged issues...")
        issues = get_untriaged_issues()
        if not issues:
            log("  No untriaged issues. Done.")
            return

        issue = issues[0]
        num = issue["number"]
        title = issue["title"]
        body = issue.get("body", "") or ""
        log(f"  Working on: #{num} — {title}")

        # Label in-progress
        log(f"[3] Labeling #{num} as in-progress...")
        label_issue(num, ["in-progress"])

        # Create branch
        branch = create_branch_name(num, title)
        log(f"[4] Creating branch: {branch}")
        run(f"git checkout -b {branch} origin/master 2>&1")

        # Build prompt
        prompt = build_agent_prompt(num, title, body, branch)

        # Log paths
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        log_path = LOGDIR / f"issue-{num}_{ts}.log"
        log(f"[5] Spawning hermes agent, logging to {log_path}")

        # Run agent
        exit_code = run_hermes_agent(prompt, str(log_path))
        log(f"[6] Agent exited with code {exit_code}")

        # Extract PR URL
        pr_url = extract_pr_url(str(log_path))
        log(f"    PR URL: {pr_url or '(not found)'}")

        # Post result
        log(f"[7] Posting result on issue #{num}...")
        post_result(num, title, branch, pr_url, str(log_path))

        log(f"\nDone. Issue #{num} '{title}' — PR: {pr_url}")

    finally:
        release_lock()


if __name__ == "__main__":
    main()
