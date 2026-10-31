"""Source adapters. Each module defines `collect(cfg, ctx) -> iterable of records`.

Register a new source by adding a module here and naming it in a config's
`sources[].type`. Records are plain dicts; see SCHEMA.md for their shape.
"""
import importlib


def load(kind):
    return importlib.import_module(f"{__name__}.{kind}")
