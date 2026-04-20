#!/usr/bin/env python3
"""GitHub Issue Agent — polls issues, spawns hermes to fix, posts PR + closes."""
import subprocess, json, re, os, socket
from pathlib import Path
from datetime import datetime

REPO = "alvin-lim-lx/Riftbound-App"
WORKDIR = "/home/panda/riftbound"
LOCKFILE = Path(WORKDIR) / ".agent.lock"
LOGDIR = Path(WORKDIR) / ".agent_logs"
LOGDIR.mkdir(exist_ok=True)

def run(cmd): return subprocess.run(cmd, shell=True, capture_output=True, text=True, cwd=WORKDIR).stdout.strip()

def gh_json(e):
    t = run("gh auth token").strip()
    return json.loads(subprocess.run(f"curl -s -H 'Authorization: token {t}' 'https://api.github.com{e}'", shell=True, capture_output=True, text=True).stdout)

def gh(method, endpoint, data=None):
    token = run("gh auth token").strip()
    body = json.dumps(data) if data else ""
    data_arg = f"-d '{body}'" if body else ""
    cmd = (f"curl -s -X {method} -H 'Authorization: token {token}' "
           f"-H 'Content-Type: application/json' {data_arg} 'https://api.github.com{endpoint}'")
    return run(cmd)

def label_issue(n, labels):
    gh("POST", f"/repos/{REPO}/issues/{n}/labels", {"labels": labels})

def comment_issue(n, body):
    gh("POST", f"/repos/{REPO}/issues/{n}/comments", {"body": body})

def close_issue(n):
    gh("PATCH", f"/repos/{REPO}/issues/{n}", {"state": "closed", "state_reason": "completed"})

def get_untriaged():
    issues = gh_json(f"/repos/{REPO}/issues?state=open&per_page=30")
    if not isinstance(issues, list): return []
    return [i for i in issues
            if "pull_request" not in i
            and not any(l["name"] in {"in-progress","done","wontfix","discussion"}
                        for l in i.get("labels", []))]

def sanitize(s): return re.sub(r'[^a-zA-Z0-9_-]', '-', s.lower())[:50]

def branch_name(n, title): return f"fix/issue-{n}-{sanitize(title)}"

def acquire_lock():
    if LOCKFILE.exists():
        try:
            pid, host = LOCKFILE.read_text().strip().split("|")
            alive = os.kill(int(pid), 0) is None if os.name != "nt" else True
            if alive:
                print(f"Lock held by {host} PID {pid} — exiting"); return False
        except: pass
        LOCKFILE.unlink()
    LOCKFILE.write_text(f"{os.getpid()}|{socket.gethostname()}"); return True

def release_lock(): LOCKFILE.unlink(missing_ok=True)

def extract_pr_url(log_path):
    patterns = [
        re.compile(r'PR_URL:(https://github\.com/[\w-]+/[\w-]+/pull/\d+)'),
        re.compile(r'(https://github\.com/[\w-]+/[\w-]+/pull/\d+)'),
    ]
    for p in patterns:
        for line in open(log_path):
            m = p.search(line)
            if m: return m.group(1)
    return ""

def build_prompt(num, title, body, branch, owner_repo):
    return f"""You are fixing GitHub issue #{num} in the {owner_repo} repository.

Issue #{num}: {title}
Body: {body[:3000] if body else '(no description)'}

Your mission:
1. Explore the codebase to understand the issue
2. Implement the fix
3. Write/update tests if applicable
4. Commit: git commit -m "fix #{num}: {title[:60]}"
5. Push: git push -u origin {branch}
6. Create PR:
   gh pr create --repo {owner_repo} \
     --title "fix #{num}: {title[:60]}" \
     --body "Closes #{num}\n\n## Summary\n- <describe changes>\n\n## Testing\n- <how tested>"
7. Print the PR URL as: PR_URL:<url>
8. Print DONE when finished.

Rules:
- Do NOT ask for clarification — best-effort is fine
- Do NOT merge the PR
- Working directory: {WORKDIR}

Start now.
"""

def run_hermes(prompt, log_path):
    env = os.environ.copy()
    env["HERMES_NO_ANALYTICS"] = "1"
    log_file = open(log_path, "w", buffering=1)
    proc = subprocess.Popen(
        ["hermes", "chat", "-q", prompt, "--source", "github-issue-agent", "--pass-session-id"],
        cwd=WORKDIR, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1
    )
    for line in proc.stdout:
        log_file.write(line); log_file.flush()
    proc.wait(); log_file.close(); return proc.returncode

def post_result(num, title, branch, pr_url):
    body = (f"## AI Agent Completed\n\nAn autonomous agent investigated issue #{num} (`{title}`).\n\n"
            + (f"Pull request: {pr_url}\n\nPlease review and merge if satisfactory." if pr_url
               else f"Branch `{branch}` was created. A PR may not have been auto-created — please review."))
    comment_issue(num, body); close_issue(num)

def main():
    print(f"[{datetime.now():%H:%M:%S}] Issue Agent starting")
    run("git fetch origin master 2>&1"); run("git checkout master 2>&1"); run("git pull origin master 2>&1")
    if not acquire_lock(): return
    try:
        issues = get_untriaged()
        if not issues: print("No untriaged issues."); return
        i = issues[0]; num, title, body = i["number"], i["title"], i.get("body", "") or ""
        print(f"Working on: #{num} — {title}")
        label_issue(num, ["in-progress"])
        branch = branch_name(num, title)
        run(f"git checkout -b {branch} origin/master 2>&1")
        prompt = build_prompt(num, title, body, branch, REPO)
        log_path = LOGDIR / f"issue-{num}_{datetime.now():%Y%m%d_%H%M%S}.log"
        print(f"Running hermes, logging to {log_path}")
        run_hermes(prompt, str(log_path))
        pr_url = extract_pr_url(str(log_path))
        print(f"PR URL: {pr_url or 'not found'}")
        post_result(num, title, branch, pr_url)
        print(f"Done. Issue #{num} — PR: {pr_url}")
    finally: release_lock()

if __name__ == "__main__": main()
