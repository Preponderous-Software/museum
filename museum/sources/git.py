"""git source: local clones, read with `git log`.

Config:
    {"type": "git", "roots": ["~/src"], "depth": 1, "authors": ["me@example.com"], "standalone": false}

`authors` defaults to `git config user.email`, so a config need not carry an
email address.

Each repository found under a root (a directory holding .git, `depth` levels
down) is keyed by its origin remote, so it merges with the same repo from the
github source, and its commits by `authors` become activity. A local clone
cannot tell whether it is private, so by default it only adds to exhibits
another source already shows; `standalone: true` lets clones nothing else
knows become exhibits of their own (fine for a museum you keep to yourself). Clones of one remote are counted once; shallow clones are skipped.
"""
import os
import re
import subprocess


def _git(repo, *args):
    r = subprocess.run(["git", "-C", repo] + list(args), capture_output=True, text=True)
    return r.stdout if r.returncode == 0 else ""


def _key(remote, path):
    m = re.search(r"github\.com[:/]+([^/]+)/([^/\s]+?)(?:\.git)?/?$", remote.strip())
    if m:
        return f"github.com/{m.group(1)}/{m.group(2)}".lower()
    return "local:" + os.path.basename(os.path.abspath(path)).lower()


def _repos(root, depth):
    root = os.path.expanduser(root)
    for dirpath, dirnames, _ in os.walk(root):
        level = dirpath[len(root):].count(os.sep)
        if os.path.isdir(os.path.join(dirpath, ".git")):
            yield dirpath
            dirnames[:] = []
        elif level >= depth:
            dirnames[:] = []
        else:
            dirnames[:] = [d for d in dirnames if not d.startswith(".") and d != "node_modules"]


def collect(cfg, ctx):
    authors = cfg.get("authors") or [e for e in [_git(".", "config", "user.email").strip()] if e]
    seen = set()
    for root in cfg.get("roots", []):
        for repo in _repos(root, int(cfg.get("depth", 1))):
            key = _key(_git(repo, "remote", "get-url", "origin"), repo)
            # A shallow clone's history is cut off: its counts would undercount.
            if key in seen or _git(repo, "rev-parse", "--is-shallow-repository").strip() == "true":
                continue
            seen.add(key)
            args = ["log", "--all", "--no-merges", "--format=%aI%x09%ae%x09%s"]
            log = [ln.split("\t", 2) for ln in _git(repo, *args).splitlines() if ln.count("\t") >= 2]
            if not log:
                continue
            mine = [c for c in log if not authors or c[1].lower() in [a.lower() for a in authors]]
            first = log[-1]
            yield {"type": "exhibit", "key": key, "title": os.path.basename(repo), "date": first[0],
                   "enrichOnly": not cfg.get("standalone", False),
                   "measures": {"localCommits": len(mine)},
                   "facts": [{"label": "Local commits by you", "value": len(mine)},
                             {"label": "First commit", "value": f'{first[0][:10]} · "{first[2][:160]}"'}],
                   "source": "git"}
            days = {}
            for c in mine:
                days[c[0][:10]] = days.get(c[0][:10], 0) + 1
            for d, n in days.items():
                yield {"type": "activity", "date": d, "count": n, "source": "git", "key": key}
