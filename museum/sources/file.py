"""file source: records written by hand (or by another tool), as JSON.

Config:
    {"type": "file", "path": "notes.json", "source": "notes"}

The file holds a list of records exactly as SCHEMA.md describes them, so
anything that can write JSON — a script over another service's export, a
list of talks given, jobs held — becomes a source without new code. Each
record's `source` defaults to the config's `source` (or "file").
"""
import json


def collect(cfg, ctx):
    name = cfg.get("source", "file")
    with open(ctx.path(cfg["path"])) as f:
        records = json.load(f)
    for rec in records:
        rec.setdefault("source", name)
        yield rec
