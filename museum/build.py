"""Turns source records into one museum document (schema in SCHEMA.md).

    python3 -m museum build museum.config.json -o web/museum.json
"""
import datetime
import json
import math
import os
import sys
from collections import Counter, defaultdict

from . import sources

SCHEMA = "museum/1"
MONTHS = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split()
# Colour-blind-friendly, distinct on a stone floor; assigned by frequency, then cycled.
PALETTE = ["#4e79a7", "#f28e2b", "#59a14f", "#e15759", "#b07aa1", "#76b7b2", "#edc948",
           "#ff9da7", "#9c755f", "#bab0ac", "#2f6b9a", "#c85200"]
OTHER = "#8a8f98"


class Context:
    """What a source may ask of the build: paths relative to the config."""

    def __init__(self, config_path):
        self.base = os.path.dirname(os.path.abspath(config_path))

    def path(self, p):
        return os.path.join(self.base, os.path.expanduser(p))


def collect(config, ctx):
    for src in config["sources"]:
        if src.get("enabled", True):
            print(f"museum: source {src['type']}", file=sys.stderr)
            yield from sources.load(src["type"]).collect(src, ctx)


def merge_exhibit(into, rec):
    """Two sources describing one thing (same key): keep the earliest date and
    every fact, link, badge and measure either knows."""
    for field in ("title", "group", "kind", "blurb"):
        if not into.get(field) and rec.get(field):
            into[field] = rec[field]
    if rec.get("date") and (not into.get("date") or rec["date"] < into["date"]):
        into["date"] = rec["date"]
    into["dim"] = into.get("dim", False) or rec.get("dim", False)
    into.setdefault("measures", {}).update({k: v for k, v in (rec.get("measures") or {}).items() if v is not None})
    labels = {f["label"] for f in into.setdefault("facts", [])}
    into["facts"] += [f for f in rec.get("facts", []) if f["label"] not in labels]
    urls = {l["url"] for l in into.setdefault("links", [])}
    into["links"] += [l for l in rec.get("links", []) if l["url"] not in urls]
    into["badges"] = sorted(set(into.get("badges", [])) | set(rec.get("badges", [])))
    into["sources"] = sorted(set(into.get("sources", [])) | {rec["source"]})
    # Shown only if some source vouches for it on its own (see gather).
    into["_enrichOnly"] = into.get("_enrichOnly", True) and bool(rec.get("enrichOnly"))


def gather(records):
    """Records -> exhibits, activity per source, period stats.

    Two rules keep things a source withheld (private repos) out of the
    museum whatever other sources say: a `withhold` record removes its key
    and that key's activity, and an exhibit only `enrichOnly` sources know
    (a local clone nothing public matches) is dropped."""
    exhibits, periods, withheld, keyed_activity = {}, defaultdict(list), set(), []
    for rec in records:
        kind = rec["type"]
        if kind == "exhibit":
            merge_exhibit(exhibits.setdefault(rec["key"], {"id": rec["key"]}), rec)
        elif kind == "activity":
            keyed_activity.append(rec)
        elif kind == "period":
            periods[rec["key"]] += rec.get("stats", [])
        elif kind == "withhold":
            withheld.add(rec["key"])
    exhibits = {k: e for k, e in exhibits.items() if k not in withheld and not e.pop("_enrichOnly", False)}
    activity = defaultdict(Counter)
    for rec in keyed_activity:
        if rec.get("key") not in withheld:
            activity[rec["source"]][rec["date"][:10]] += rec["count"]
    return exhibits, activity, periods


def palette(values, overrides):
    order = [v for v, _ in Counter(values).most_common()]
    out = [{"id": v, "color": overrides.get(v) or (PALETTE[i] if i < len(PALETTE) else OTHER), "count": c}
           for i, (v, c) in enumerate(Counter(values).most_common())]
    return sorted(out, key=lambda e: order.index(e["id"]))


def scale(exhibits, measure):
    """0..1 on a log scale over the exhibits' `measure` (missing counts as 0)."""
    top = max((e["measures"].get(measure) or 0 for e in exhibits), default=0)
    for e in exhibits:
        v = e["measures"].get(measure) or 0
        e["size"] = round(math.log1p(v) / math.log1p(top), 3) if top else 0.0


def month_halls(year, items, split_over):
    """Splits a crowded year into runs of whole months, each up to split_over exhibits."""
    by_month = defaultdict(list)
    for e in items:
        by_month[int(e["date"][5:7])].append(e)
    halls, run = [], []
    for m in range(1, 13):
        if run and sum(len(by_month[x]) for x in run) + len(by_month[m]) > split_over:
            halls.append(run)
            run = []
        run.append(m)
    halls.append(run)
    out = []
    for months in halls:
        first, last = months[0], months[-1]
        label = MONTHS[first - 1] if first == last else f"{MONTHS[first - 1]}–{MONTHS[last - 1]}"
        end_day = (datetime.date(year + (last == 12), last % 12 + 1, 1) - datetime.timedelta(days=1)).day
        out.append({"id": f"{year}-{first:02d}", "label": f"{label} {year}",
                    "start": f"{year}-{first:02d}-01", "end": f"{year}-{last:02d}-{end_day:02d}",
                    "exhibits": [e["id"] for m in months for e in by_month[m]]})
    return [h for h in out if h["exhibits"]] or out[:1]


def eras_by_year(exhibits, activity, periods, cfg):
    years = [int(e["date"][:4]) for e in exhibits] + [int(d[:4]) for s in activity.values() for d in s]
    first = int(cfg.get("from_year") or min(years))
    last = int(cfg.get("to_year") or max(years))
    split_over = int(cfg.get("split_over", 60))
    eras = []
    for y in range(first, last + 1):
        items = sorted((e for e in exhibits if e["date"].startswith(str(y))), key=lambda e: e["date"])
        if len(items) > split_over:
            halls = month_halls(y, items, split_over)
        else:
            halls = [{"id": str(y), "label": str(y), "start": f"{y}-01-01", "end": f"{y}-12-31",
                      "exhibits": [e["id"] for e in items]}]
        stats = [{"label": "Exhibits", "value": len(items)}] + periods.get(str(y), [])
        eras.append({"id": str(y), "label": str(y), "start": f"{y}-01-01", "end": f"{y}-12-31",
                     "stats": stats, "halls": halls})
    return eras


def build(config_path):
    config = json.load(open(config_path))
    ctx = Context(config_path)
    exhibits, activity, periods = gather(collect(config, ctx))
    rules = config.get("exhibits", {})
    items = [e for e in exhibits.values() if e.get("date")]
    for e in items:
        e.setdefault("group", "Other")
        e.setdefault("kind", "Other")
        e["glow"] = int(e["measures"].get(rules.get("highlight", "")) or 0)
    scale(items, rules.get("size", ""))
    items.sort(key=lambda e: e["date"])
    era_cfg = config.get("eras", {})
    if era_cfg.get("by", "year") != "year":
        raise SystemExit(f"museum: eras.by={era_cfg['by']!r} is not supported yet (only 'year')")
    primary = config.get("activity", {}).get("primary") or next(iter(activity), None)
    colors = config.get("colors", {})
    return {
        "schema": SCHEMA,
        "title": config.get("title", "Museum"),
        "subtitle": config.get("subtitle", ""),
        "generated": datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
        "legend": {
            "group": {"label": rules.get("group_label", "Group"), "values": palette([e["group"] for e in items], colors)},
            "kind": {"label": rules.get("kind_label", "Kind"), "values": palette([e["kind"] for e in items], colors)},
            "size": rules.get("size_label", rules.get("size", "")),
            "glow": rules.get("highlight_label", rules.get("highlight", "")),
            "dim": rules.get("dim_label", "dimmed by its source"),
        },
        "eras": eras_by_year(items, activity, periods, era_cfg),
        "activity": {"primary": primary, "label": config.get("activity", {}).get("label", "activity"), "series": {k: dict(sorted(v.items())) for k, v in activity.items()}},
        "exhibits": items,
        **({"sky": config["sky"]} if config.get("sky") else {}),
    }


def main(argv):
    import argparse
    ap = argparse.ArgumentParser(prog="museum")
    sub = ap.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("build", help="collect every source in a config and write the museum document")
    b.add_argument("config")
    b.add_argument("-o", "--out", default="web/museum.json")
    args = ap.parse_args(argv)
    doc = build(args.config)
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, "w") as f:
        json.dump(doc, f, separators=(",", ":"))
    print(f"museum: {len(doc['exhibits'])} exhibits in {len(doc['eras'])} eras -> {args.out}", file=sys.stderr)
