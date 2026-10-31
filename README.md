# museum

A walkable 3D museum of someone's history, built from pluggable sources and
drawn in the browser with [Strata](https://github.com/Preponderous-Software/strata).

You enter a lobby whose timeline has one plinth per year, as tall as that
year's activity. A straight aisle then runs through one hall per year (a
crowded year becomes several halls of whole months). Each thing you made
stands on a pedestal:

- the trim is its **group**'s colour (for example an org);
- the object's colour and shape are its **kind** (for example a language);
- its size comes from a measure you choose (for example your commits);
- gold orbs circle it for another measure (for example stars).

Each hall's left wall is a relief of that period's weekly activity. Walk up
to a pedestal and press <kbd>E</kbd> (or tap it) to read its placard: the
first commit, your commits, links.

## How it fits together

```
sources (github, git, file, …)  ──records──▶  builder  ──museum.json──▶  web page (layout + walk) ──rows──▶  Strata scene
```

- **`museum/sources/`**: each module turns one kind of history into records
  (see [SCHEMA.md](SCHEMA.md)). The bundled ones:
  - `github`: repos, your commits, first commits, and the contribution
    calendar, through `gh`;
  - `git`: local clones, through `git log`;
  - `file`: records written by hand or by any other tool.
- **`museum/build.py`** merges records by key, splits time into eras, scales
  exhibits, and writes one document. It knows nothing about whose history it
  is; that lives in your config.
- **`web/museum-layout.js`**: document → building (pure, tested under node).
- **`web/museum-walk.js`**: first-person walking, collisions, the joystick.
- **`scene/main.cpp`**: a Strata web-kit scene that draws the rows it is
  handed. It knows nothing about museums.

## Use it

Write a config for your history. Start from one in [`examples/`](examples/), and
keep it **outside this repository**, together with its cache. The config is
yours; the repository is the tool.

```sh
cp examples/github-public.json ~/my-museum/config.json      # then set owners, title, from_year
python3 -m museum build ~/my-museum/config.json -o web/museum.json
cd web && python3 -m http.server 8765                        # open http://127.0.0.1:8765/
```

The builder needs only Python 3.8+ (stdlib). The github source needs the `gh`
CLI signed in. Its answers are cached next to the config (`cache/`), so
rebuilding after a config change takes seconds; delete the cache to refetch.

| Example | What it shows |
|---|---|
| [`github-public.json`](examples/github-public.json) | Public repositories, your commits, and the contribution calendar, enriched by local clones. Safe to publish. |
| [`everything-private.json`](examples/everything-private.json) | The same with private repositories and local-only clones. Keep what it builds to yourself. |
| [`career.json`](examples/career.json) | No accounts needed: jobs, talks and courses from a hand-written list ([`career-records.json`](examples/career-records.json)). |

Controls: <kbd>WASD</kbd> or arrows to walk, Shift to run, drag to look,
<kbd>E</kbd> to read, <kbd>M</kbd> for the directory (search, or jump to a
hall), <kbd>L</kbd> for the legend. On a phone: the left thumb walks, drag to
look, tap a pedestal. `?at=<title>` or `?hall=<id>` opens at a spot, and
`?doc=<url>` walks another museum document.

A config can also set `"sky": {"unix": …, "lat": …, "lon": …}` to light the
museum with the real sun at that time and place (Strata's solar position),
and `exhibits.dim_label` to say what greyed exhibits mean.

**Private by default.** Private repositories are left out unless a config
asks for them: the github source needs `"include_private": true`, and the
git source (which cannot tell what is private) only adds to exhibits other
sources show unless it has `"standalone": true`. Built documents
(`web/museum*.json`) and caches are git-ignored: publish a document by
shipping it with your site, not by committing it.

## Add a source

Write `museum/sources/<name>.py` with `collect(cfg, ctx)` yielding records,
then name it in a config's `sources`. `ctx.path()` resolves paths against the
config. If another tool can already export JSON, the `file` source may be
all you need.

## License

MIT (see [LICENSE](LICENSE)). The Strata web kit in `scene/strata-kit/` is MIT too.

## Tests and the scene build

```sh
python3 -m unittest discover -s tests     # builder
node tests/layout_test.js                 # layout and walking
scene/build.sh                            # emsdk 6.0.11 active; rebuilds web/museum-scene.{js,wasm}
```

`scene/strata-kit/` is the Strata web kit, vendored at the commit in
`scene/strata-kit/PIN`, and the Strata release is pinned by SHA-256 in
`scene/build.sh`.
