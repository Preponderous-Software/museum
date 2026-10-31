"""museum: builds a walkable museum document from pluggable history sources.

A *source* yields records (see SCHEMA.md): exhibits (things with a date) and
activity (a count on a day). The *builder* merges records from every source in
a config, splits time into eras, scales exhibits, and writes one museum
document that the web renderer (web/) walks through. Nothing here knows whose
history it is: that lives in the config.
"""
