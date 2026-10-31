"""github source: repositories owned by some accounts/orgs, your commits on
each, each repo's first commit, and your daily contribution calendar.

Config:
    {"type": "github", "owners": ["alice", "alice-org"], "from_year": 2016,
     "cache": "cache/github.json", "include_forks": true, "include_private": false,
     "login": "alice"}

`login` names whose commits and contribution calendar to read. Without it,
the signed-in account (`gh`'s viewer) is used, which sees its own private
contributions; with it, any token works (a CI's GITHUB_TOKEN included) and
the calendar is the one the profile shows the public.

Private repositories are left out unless `include_private` is true, and each
one left out is announced as a `withhold` record, so no other source (a local
clone, say) can bring it back. The contribution calendar is kept either way:
it holds counts per day, not repository names.

Uses the `gh` CLI (already signed in). The raw answers are cached, so a
rebuild with a changed config does not refetch; delete the cache to refresh.
"""
import datetime
import json
import os
import subprocess
import sys


def _gh(args):
    return subprocess.run(["gh"] + args, check=True, capture_output=True, text=True).stdout


def _gql(query, **variables):
    args = ["api", "graphql", "-f", "query=" + query]
    for k, v in variables.items():
        args += ["-F", f"{k}={v}"]
    for attempt in range(3):
        try:
            return json.loads(_gh(args))["data"]
        except subprocess.CalledProcessError as e:
            # A partial answer (one repo empty or blocked) still has data.
            try:
                d = json.loads(e.stdout)
                if d.get("data"):
                    return d["data"]
            except ValueError:
                pass
            if attempt == 2:
                raise
    return {}


REPO_FIELDS = ("name,owner,createdAt,pushedAt,stargazerCount,forkCount,primaryLanguage,"
               "isPrivate,isArchived,isFork,description,diskUsage,homepageUrl,url")
BATCH = 30


def _repo_query(alias, r, body):
    return (f'{alias}: repository(owner: "{r["owner"]["login"]}", name: "{r["name"]}") '
            f'{{ defaultBranchRef {{ target {{ ... on Commit {{ {body} }} }} }} }}')


def _head_of(answer, alias):
    return (((answer.get(alias) or {}).get("defaultBranchRef") or {}).get("target")) or {}


def _batched(repos, body_of, apply, header="", variables=None, fallback=None):
    """Asks about repos BATCH at a time. A batch GitHub fails on (one huge
    history can time it out) is split in half until the failing repo is alone;
    that repo then gets `fallback(repo)` (or nothing)."""
    variables = variables or {}

    def run(chunk):
        parts = [_repo_query(f"r{j}", r, body_of(r)) for j, r in enumerate(chunk)]
        try:
            answer = _gql(header + "{" + "\n".join(parts) + "}", **variables)
        except subprocess.CalledProcessError:
            if len(chunk) == 1:
                print(f"github: gave up on {chunk[0]['name']}", file=sys.stderr)
                if fallback:
                    fallback(chunk[0])
                return
            half = len(chunk) // 2
            run(chunk[:half])
            run(chunk[half:])
            return
        for j, r in enumerate(chunk):
            apply(r, _head_of(answer, f"r{j}"))

    for i in range(0, len(repos), BATCH):
        run(repos[i:i + BATCH])
        print(f"github: {min(i + BATCH, len(repos))}/{len(repos)}", file=sys.stderr)


def _apply_totals(r, head):
    r["_oid"] = head.get("oid")
    r["commits"] = (head.get("all") or {}).get("totalCount", 0)
    r["myCommits"] = (head.get("mine") or {}).get("totalCount")
    nodes = (head.get("all") or {}).get("nodes") or []
    r["lastCommit"] = nodes[0]["committedDate"] if nodes else None


def _first_commit_body(r):
    after = f'"{r["_oid"]} {r["commits"] - 2}"' if r["commits"] >= 2 else "null"
    return f"history(first: 1, after: {after}) {{ nodes {{ committedDate messageHeadline author {{ name }} }} }}"


def _apply_first_commit(r, head):
    nodes = (head.get("history") or {}).get("nodes") or []
    if nodes:
        n = nodes[0]
        r["firstCommit"] = {"date": n["committedDate"], "msg": n["messageHeadline"][:160],
                            "author": (n.get("author") or {}).get("name")}


def _calendar(who, year):
    d = _gql(f'''{{ {who} {{ contributionsCollection(from: "{year}-01-01T00:00:00Z", to: "{year}-12-31T23:59:59Z") {{
      totalCommitContributions totalPullRequestContributions totalIssueContributions
      totalPullRequestReviewContributions
      contributionCalendar {{ totalContributions weeks {{ contributionDays {{ date contributionCount }} }} }} }} }} }}''')
    c = next(iter(d.values()))["contributionsCollection"]
    return {"year": year, "total": c["contributionCalendar"]["totalContributions"],
            "commits": c["totalCommitContributions"], "prs": c["totalPullRequestContributions"],
            "issues": c["totalIssueContributions"], "reviews": c["totalPullRequestReviewContributions"],
            "days": [[x["date"], x["contributionCount"]] for w in c["contributionCalendar"]["weeks"]
                     for x in w["contributionDays"] if x["date"].startswith(str(year))]}


def fetch(owners, from_year, login=None):
    # Whose history: a named user, or whoever `gh` is signed in as.
    who = f'user(login: "{login}")' if login else "viewer"
    viewer = next(iter(_gql(f"{{ {who} {{ id login }} }}").values()))
    repos = []
    for o in owners:
        repos += json.loads(_gh(["repo", "list", o, "--limit", "1000", "--json", REPO_FIELDS]))
    print(f"github: {len(repos)} repos", file=sys.stderr)

    totals = ("oid all: history(first: 1) { totalCount nodes { committedDate } } "
              "mine: history(author: {id: $id}) { totalCount }")
    totals_only = "oid all: history(first: 1) { totalCount nodes { committedDate } }"
    _batched(repos, lambda r: totals, _apply_totals, header="query($id: ID!) ", variables={"id": viewer["id"]},
             # The author filter is what times out on huge histories: keep the repo without it.
             fallback=lambda r: _batched([r], lambda _: totals_only, _apply_totals))
    _batched([r for r in repos if r.get("_oid") and r.get("commits")], _first_commit_body, _apply_first_commit)
    years = [_calendar(who, y) for y in range(from_year, datetime.date.today().year + 1)]
    return {"login": viewer["login"], "repos": repos, "years": years}


def collect(cfg, ctx):
    cache = ctx.path(cfg.get("cache", "cache/github.json"))
    if os.path.exists(cache):
        raw = json.load(open(cache))
    else:
        raw = fetch(cfg["owners"], int(cfg.get("from_year", 2008)), cfg.get("login"))
        os.makedirs(os.path.dirname(cache), exist_ok=True)
        json.dump(raw, open(cache, "w"))
    forks = cfg.get("include_forks", True)
    include_private = cfg.get("include_private", False)
    for r in raw["repos"]:
        org = r["owner"]["login"]
        key = f"github.com/{org}/{r['name']}".lower()
        if r.get("isPrivate") and not include_private:
            yield {"type": "withhold", "key": key, "source": "github"}
            continue
        if r.get("isFork") and not forks:
            continue
        first = r.get("firstCommit")
        badges = [b for b, on in (("private", r["isPrivate"]), ("archived", r["isArchived"]), ("fork", r["isFork"])) if on]
        facts = [("Your commits", r.get("myCommits")), ("All commits", r.get("commits", 0)),
                 ("Stars", r["stargazerCount"]), ("Forks", r["forkCount"]),
                 ("Created", r["createdAt"][:10]), ("Last commit", (r.get("lastCommit") or "")[:10])]
        if first:
            facts.append(("First commit", f'{first["date"][:10]} · "{first["msg"]}"'))
        links = [{"label": "GitHub", "url": r["url"]}]
        if r.get("homepageUrl"):
            links.append({"label": "Site", "url": r["homepageUrl"]})
        yield {
            "type": "exhibit",
            "key": key,
            "title": r["name"],
            "date": (first or {}).get("date") or r["createdAt"],
            "group": org,
            "kind": (r.get("primaryLanguage") or {}).get("name") or "Other",
            "blurb": r.get("description") or "",
            "badges": badges,
            "dim": r["isArchived"] or r["isFork"],
            "measures": {"myCommits": r.get("myCommits"), "commits": r.get("commits", 0),
                         "stars": r["stargazerCount"], "forks": r["forkCount"], "sizeKB": r["diskUsage"]},
            "facts": [{"label": k, "value": v} for k, v in facts if v not in (None, "")],
            "links": links,
            "source": "github",
        }
    for y in raw["years"]:
        for date, n in y["days"]:
            if n:
                yield {"type": "activity", "date": date, "count": n, "source": "github"}
        yield {"type": "period", "key": str(y["year"]), "source": "github",
               "stats": [{"label": "Contributions", "value": y["total"]}, {"label": "Commits", "value": y["commits"]},
                         {"label": "Pull requests", "value": y["prs"]}, {"label": "Issues", "value": y["issues"]},
                         {"label": "Reviews", "value": y["reviews"]}]}
