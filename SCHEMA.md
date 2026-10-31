# Records and the museum document

Two shapes matter: the **records** a source yields, and the **museum
document** (`museum/1`) the builder writes and the page walks through. A new
source only has to produce records; nothing downstream changes.

## Records (what a source yields)

Every record has `type` and `source` (the source's name; the `file` source
fills it in for you).

### `exhibit`: one thing with a date

| Field | Required | Meaning |
|---|---|---|
| `key` | yes | Identity across sources. Two records with one key become one exhibit (the github and git sources both use `github.com/<owner>/<name>`). |
| `date` | yes | ISO date or datetime. The exhibit's place in time; across sources the earliest wins. |
| `title` | | The name on the label. The first source to give one wins. |
| `group` | | Colours the pedestal's trim (an org, a client, a team). |
| `kind` | | Colours and shapes the object (a language, a medium, a type). |
| `blurb` | | One or two sentences. |
| `measures` | | Numbers by name (`{"commits": 812, "stars": 3}`). The config picks which one sizes the object and which one adds gold orbs. Merged across sources. |
| `facts` | | `[{label, value}]` shown on the placard. Merged by label. |
| `links` | | `[{label, url}]`. Merged by url. |
| `badges` | | Short words (`private`, `archived`). Merged. |
| `dim` | | `true` greys the object (archived, abandoned). |
| `enrichOnly` | | `true`: this record only adds to an exhibit some other source shows; if no source shows it on its own, it is dropped. Sources that cannot tell what is private (local clones) set it by default. |

### `activity`: a count on a day

`{"type": "activity", "date": "2021-07-09", "count": 12}`. Summed per day
and kept **per source**, so overlapping sources (the GitHub calendar and
local `git log`) never double count. The config's `activity.primary` picks
the series that the walls and the timeline show.

### `withhold`: keep a thing out

`{"type": "withhold", "key": "github.com/me/secret"}` removes that key from
the museum, together with its activity, whatever other sources say about it.
The github source sends one for each private repository it leaves out.

### `period`: stats for an era

`{"type": "period", "key": "2021", "stats": [{"label": "Pull requests", "value": 387}]}`
adds lines to that era's sign.

## Config

```json
{
  "title": "…", "subtitle": "…",
  "sources": [{"type": "github", "…": "…"}, {"type": "git", "…": "…"}, {"type": "file", "path": "notes.json"}],
  "eras": {"by": "year", "from_year": 2016, "split_over": 60},
  "activity": {"primary": "github", "label": "contributions"},
  "exhibits": {"size": "myCommits", "highlight": "stars",
               "group_label": "Owner", "kind_label": "Language", "dim_label": "archived or forked"},
  "colors": {"Java": "#b07219"},
  "sky": {"unix": 1750532400, "lat": 51.48, "lon": 0.0}
}
```

- `eras.split_over`: a year with more exhibits than this becomes several
  halls of whole months.
- Private things are out by default: the github source withholds private
  repositories unless `include_private` is true, and the git source only
  adds to exhibits others show unless `standalone` is true. Turn both on
  only in a config for a museum you keep to yourself.
- `colors`: fixes the colour of any group or kind; the rest come from a
  colour-blind-friendly palette, most common first.

## The museum document (`museum/1`)

```
schema, title, subtitle, generated
legend:   {group: {label, values: [{id, color, count}]}, kind: {…}, size, glow, dim}
eras:     [{id, label, start, end, stats: [{label, value}],
            halls: [{id, label, start, end, exhibits: [exhibit id]}]}]
activity: {primary, label, series: {<source>: {<date>: count}}}
exhibits: [{id, title, date, group, kind, blurb, badges, dim, measures, facts, links,
            sources, size (0..1), glow (int)}]
sky:      optional {unix, lat, lon}: where and when the sun stands
```
