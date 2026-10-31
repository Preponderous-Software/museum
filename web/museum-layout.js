/* museum-layout.js: a museum document (schema museum/1) -> a building.

   Pure functions, no DOM and no engine, so tests/layout_test.js runs them
   under node. The page hands `rows` to the scene (scene/main.cpp) once.

     const b = MuseumLayout.layout(doc);
     b.rows       // Float32Array, ROW_STRIDE floats per primitive (kind, x, y, z, sx, sy, sz, r, g, b)
     b.halls      // [{id, label, era, x0, x1, z0, z1, exhibits, stats}] along +z, oldest first
     b.exhibits   // [{id, x, z, top, rgb, shape, ref}] — ref is the document's exhibit
     b.colliders  // [{kind: "box", x, z, hx, hz} | {kind: "circle", x, z, r}]
     b.lamps      // [{x, y, z, hall}] ceiling-height lights along each aisle
     b.spawn      // {x, z, yaw} in the lobby, facing the first hall

   The visitor enters a lobby holding the timeline (one plinth per era, as
   tall as its activity), then walks a straight aisle through one hall per
   era (a crowded era is several halls). Each hall's left wall is a relief of
   its weekly activity. Exhibits stand on pedestals either side of the aisle:
   the trim is their group's colour, the object their kind's colour and
   shape, its size their `size`. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.MuseumLayout = factory();
}(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const ROW_STRIDE = 10;
  const CUBE = 0, CAPSULE = 1, CYLINDER = 2, SPHERE = 3;
  const SHAPES = [CUBE, SPHERE, CYLINDER, CAPSULE];

  const AISLE = 3.6;          // m, kept clear down the middle of every hall
  const SPACING = 3.2;        // m between pedestal centres
  const MAX_COLS = 6;         // pedestal columns per side of the aisle
  const WALL_H = 3.8, WALL_T = 0.3;
  const RELIEF_DEPTH = 0.9;   // m the activity relief stands out from the left wall
  const RELIEF_MAX_H = 3.0;
  const DOOR_W = AISLE;
  const GAP = 1.6;            // m of threshold between halls
  const LOBBY_D = 18, LOBBY_MIN_W = 26;
  const PEDESTAL_R = 0.45, PEDESTAL_H = 1.0;
  const LAMP_EVERY = 7, LAMP_Y = 3.3;

  const PLASTER = hex("#e9e2d4"), PLASTER_DARK = hex("#d6cdbb"), STONE = hex("#b9b2a5"), STONE_ALT = hex("#a9a294");
  const PEDESTAL = hex("#f4f1ea"), GRASS = hex("#6f8f4e"), PLINTH = hex("#c9c1b0");
  const ACTIVITY_LOW = hex("#9be9a8"), ACTIVITY_HIGH = hex("#216e39");  // the familiar contribution greens

  /* ------------------------------------------------------------ colour */
  function srgbToLinear(c) { return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  function hex(h) {
    const n = parseInt(h.replace("#", ""), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => srgbToLinear(v / 255));
  }
  function mix(a, b, t) { return [0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * t); }
  const GREY = hex("#9a9a9a");

  /* -------------------------------------------------------------- rows */
  function Rows() {
    const data = [];
    return {
      add(kind, x, y, z, sx, sy, sz, rgb) { data.push(kind, x, y, z, sx, sy, sz, rgb[0], rgb[1], rgb[2]); },
      // An axis-aligned box from its floor-level footprint and height.
      box(x0, z0, x1, z1, y0, y1, rgb) {
        this.add(CUBE, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, Math.abs(x1 - x0), y1 - y0, Math.abs(z1 - z0), rgb);
      },
      get count() { return data.length / ROW_STRIDE; },
      done() { return Float32Array.from(data); },
    };
  }

  /* -------------------------------------------------------------- data */
  function index(doc) {
    const byId = new Map(doc.exhibits.map((e) => [e.id, e]));
    const colorOf = (legend) => new Map(((legend && legend.values) || []).map((v, i) => [v.id, {rgb: hex(v.color), i}]));
    return {byId, groups: colorOf(doc.legend && doc.legend.group), kinds: colorOf(doc.legend && doc.legend.kind)};
  }

  // Activity per ISO week inside [start, end], from the primary series.
  function weeklyActivity(series, start, end) {
    const weeks = [];
    const t0 = Date.parse(start + "T00:00:00Z"), t1 = Date.parse(end + "T00:00:00Z");
    for (let t = t0; t <= t1; t += 7 * 86400000) weeks.push({start: new Date(t).toISOString().slice(0, 10), count: 0});
    for (const [date, n] of Object.entries(series || {})) {
      const t = Date.parse(date + "T00:00:00Z");
      if (t < t0 || t > t1 + 86400000 - 1) continue;
      weeks[Math.min(weeks.length - 1, Math.floor((t - t0) / (7 * 86400000)))].count += n;
    }
    return weeks;
  }

  function total(series, start, end) {
    let n = 0;
    for (const [d, c] of Object.entries(series || {})) if (d >= start && d <= end) n += c;
    return n;
  }

  /* --------------------------------------------------------- the halls */
  function hallSize(n) {
    const cols = Math.max(1, Math.min(MAX_COLS, Math.ceil(Math.sqrt(n / 2 / 1.4))));
    const rows = Math.max(1, Math.ceil(n / (2 * cols)));
    const width = AISLE + 2 * cols * SPACING + 2 * RELIEF_DEPTH + 1.2;
    const depth = Math.max(10, rows * SPACING + 4.4);
    return {cols, rows, width, depth};
  }

  // A wall across the hall at z with a doorway at x = 0 (or none).
  function crossWall(rows, colliders, x0, x1, z, door) {
    const segs = door ? [[x0, -DOOR_W / 2], [DOOR_W / 2, x1]] : [[x0, x1]];
    for (const [a, b] of segs) {
      rows.box(a, z - WALL_T / 2, b, z + WALL_T / 2, 0, WALL_H, PLASTER);
      colliders.push({kind: "box", x: (a + b) / 2, z, hx: (b - a) / 2, hz: WALL_T / 2});
    }
    if (door) rows.box(-DOOR_W / 2 - 0.2, z - WALL_T / 2 - 0.05, DOOR_W / 2 + 0.2, z + WALL_T / 2 + 0.05,
      WALL_H - 0.5, WALL_H, PLASTER_DARK);  // lintel
  }

  function sideWalls(rows, colliders, x0, x1, z0, z1) {
    for (const x of [x0, x1]) {
      rows.box(x - WALL_T / 2, z0, x + WALL_T / 2, z1, 0, WALL_H, PLASTER);
      colliders.push({kind: "box", x, z: (z0 + z1) / 2, hx: WALL_T / 2, hz: (z1 - z0) / 2});
    }
  }

  function relief(rows, colliders, x, z0, z1, weeks, peak) {
    if (!weeks.length) return;
    const step = (z1 - z0) / weeks.length;
    for (let i = 0; i < weeks.length; i++) {
      const k = peak ? Math.sqrt(weeks[i].count / peak) : 0;
      const h = 0.08 + RELIEF_MAX_H * k;
      const rgb = weeks[i].count ? mix(ACTIVITY_LOW, ACTIVITY_HIGH, k) : PLASTER_DARK;
      rows.box(x, z0 + i * step + 0.03, x + RELIEF_DEPTH * (0.35 + 0.65 * k), z0 + (i + 1) * step - 0.03, 0, h, rgb);
    }
    colliders.push({kind: "box", x: x + RELIEF_DEPTH / 2, z: (z0 + z1) / 2, hx: RELIEF_DEPTH / 2, hz: (z1 - z0) / 2});
  }

  function exhibitPiece(rows, e, x, z, ix) {
    const group = ix.groups.get(e.group), kind = ix.kinds.get(e.kind);
    let rgb = kind ? kind.rgb : GREY;
    if (e.dim) rgb = mix(rgb, GREY, 0.65);
    const shape = SHAPES[(kind ? kind.i : 0) % SHAPES.length];
    rows.add(CYLINDER, x, PEDESTAL_H / 2, z, PEDESTAL_R * 2, PEDESTAL_H / 2, PEDESTAL_R * 2, PEDESTAL);
    rows.add(CYLINDER, x, PEDESTAL_H + 0.02, z, PEDESTAL_R * 2.15, 0.03, PEDESTAL_R * 2.15, group ? group.rgb : GREY);
    const s = 0.28 + 0.62 * (e.size || 0);
    let h = s;
    if (shape === CAPSULE) { h = s * 1.4; rows.add(CAPSULE, x, PEDESTAL_H + 0.05 + h / 2, z, s * 0.7, h / 2, s * 0.7, rgb); }
    else if (shape === CYLINDER) rows.add(CYLINDER, x, PEDESTAL_H + 0.05 + h / 2, z, s * 0.85, h / 2, s * 0.85, rgb);
    else rows.add(shape, x, PEDESTAL_H + 0.05 + h / 2, z, s, s, s, rgb);
    return {top: PEDESTAL_H + 0.05 + h, rgb, shape};
  }

  function placeExhibits(rows, colliders, ids, hall, size, ix, out) {
    // Fill rows nearest the entrance first, alternating left/right of the aisle, inner columns first.
    const zFirst = hall.z0 + 3.4;  // room to stand in the doorway and see the first row
    let k = 0;
    for (let r = 0; r < size.rows && k < ids.length; r++) {
      for (let c = 0; c < size.cols && k < ids.length; c++) {
        for (const side of [-1, 1]) {
          if (k >= ids.length) break;
          const e = ix.byId.get(ids[k++]);
          if (!e) continue;
          const x = side * (AISLE / 2 + SPACING / 2 + c * SPACING);
          const z = zFirst + r * SPACING;
          const piece = exhibitPiece(rows, e, x, z, ix);
          colliders.push({kind: "circle", x, z, r: PEDESTAL_R + 0.05});
          out.push({id: e.id, x, z, top: piece.top, rgb: piece.rgb, shape: piece.shape, hall: hall.id, ref: e});
        }
      }
    }
  }

  /* --------------------------------------------------------- the lobby */
  function lobby(rows, colliders, doc, halls, series, z1) {
    const eras = doc.eras || [];
    const width = Math.max(LOBBY_MIN_W, eras.length * 2.2 + AISLE + 8);
    const x0 = -width / 2, x1 = width / 2, z0 = z1 - LOBBY_D;
    rows.box(x0, z0, x1, z1, -0.1, 0.0, STONE);
    sideWalls(rows, colliders, x0, x1, z0, z1);
    crossWall(rows, colliders, x0, x1, z0, false);
    crossWall(rows, colliders, x0, x1, z1, true);
    // The timeline: one plinth per era, as tall as its activity, left to right.
    const totals = eras.map((e) => total(series, e.start, e.end));
    const peak = Math.max(1, ...totals);
    const timeline = [];
    // Plinths 2.2 m apart, split around the aisle so the way in stays clear.
    const zT = z0 + 5.5, pitch = 2.2, half = Math.ceil(eras.length / 2);
    eras.forEach((era, i) => {
      const x = i < half ? -AISLE / 2 - 1 - (half - 1 - i) * pitch : AISLE / 2 + 1 + (i - half) * pitch;
      const k = Math.sqrt(totals[i] / peak);
      const h = 0.15 + 3.2 * k;
      rows.box(x - 0.6, zT - 0.6, x + 0.6, zT + 0.6, 0, 0.12, PLINTH);
      rows.box(x - 0.45, zT - 0.45, x + 0.45, zT + 0.45, 0.12, 0.12 + h, totals[i] ? mix(ACTIVITY_LOW, ACTIVITY_HIGH, k) : PLASTER_DARK);
      colliders.push({kind: "box", x, z: zT, hx: 0.6, hz: 0.6});
      timeline.push({era: era.id, label: era.label, x, z: zT, top: 0.12 + h, activity: totals[i],
        exhibits: halls.filter((hl) => hl.era === era.id).reduce((n, hl) => n + hl.exhibits.length, 0)});
    });
    return {hall: {id: "lobby", label: doc.title || "Lobby", era: null, x0, x1, z0, z1, exhibits: [], stats: []},
      timeline, spawn: {x: 0, z: z0 + 2.2, yaw: -Math.PI / 2}};
  }

  /* ------------------------------------------------------------ layout */
  function layout(doc) {
    const ix = index(doc);
    const rows = Rows(), colliders = [], exhibits = [], lamps = [], halls = [];
    const series = ((doc.activity || {}).series || {})[(doc.activity || {}).primary] || {};

    // Halls first (the lobby's timeline needs them), each era's halls in order.
    const plan = [];
    for (const era of doc.eras || []) {
      for (const h of era.halls) plan.push({era, hall: h, size: hallSize(h.exhibits.length)});
    }
    const weekPeak = Math.max(1, ...plan.flatMap((p) => weeklyActivity(series, p.hall.start, p.hall.end).map((w) => w.count)));

    let z = 0;
    plan.forEach((p, i) => {
      const {width, depth} = p.size;
      const x0 = -width / 2, x1 = width / 2, z0 = z + (i ? GAP : 0), z1 = z0 + depth;
      const hall = {id: p.hall.id, label: p.hall.label, era: p.era.id, x0, x1, z0, z1, exhibits: p.hall.exhibits,
        stats: p.era.halls.length > 1 ? [{label: "Exhibits", value: p.hall.exhibits.length}] : p.era.stats || [],
        activity: total(series, p.hall.start, p.hall.end), start: p.hall.start, end: p.hall.end};
      halls.push(hall);
      rows.box(x0, z0, x1, z1, -0.1, 0.0, i % 2 ? STONE_ALT : STONE);
      if (i) rows.box(-DOOR_W / 2, z0 - GAP, DOOR_W / 2, z0, -0.1, 0.0, PLINTH);  // threshold
      if (i) {
        // The threshold's own walls, so the gap between halls is not a way out.
        for (const x of [-DOOR_W / 2 - WALL_T / 2, DOOR_W / 2 + WALL_T / 2]) {
          rows.box(x - WALL_T / 2, z0 - GAP, x + WALL_T / 2, z0, 0, WALL_H, PLASTER_DARK);
          colliders.push({kind: "box", x, z: z0 - GAP / 2, hx: WALL_T / 2, hz: GAP / 2});
        }
      }
      sideWalls(rows, colliders, x0, x1, z0, z1);
      crossWall(rows, colliders, x0, x1, z0, true);
      crossWall(rows, colliders, x0, x1, z1, i < plan.length - 1);
      relief(rows, colliders, x0 + WALL_T / 2, z0 + 0.6, z1 - 0.6, weeklyActivity(series, p.hall.start, p.hall.end), weekPeak);
      placeExhibits(rows, colliders, p.hall.exhibits, hall, p.size, ix, exhibits);
      for (let lz = z0 + LAMP_EVERY / 2; lz < z1; lz += LAMP_EVERY) lamps.push({x: 0, y: LAMP_Y, z: lz, hall: hall.id});
      z = z1;
    });

    const front = lobby(rows, colliders, doc, halls, series, 0);
    halls.unshift(front.hall);
    for (let lx = -6; lx <= 6; lx += 6) lamps.push({x: lx, y: LAMP_Y, z: front.hall.z0 + LOBBY_D / 2, hall: "lobby"});

    // The grounds around the building.
    const minX = Math.min(...halls.map((h) => h.x0)), maxX = Math.max(...halls.map((h) => h.x1));
    rows.box(minX - 40, front.hall.z0 - 40, maxX + 40, z + 40, -0.3, -0.1, GRASS);

    return {rows: rows.done(), count: rows.count, halls, exhibits, colliders, lamps,
      timeline: front.timeline, spawn: front.spawn, bounds: [minX, front.hall.z0, maxX, z]};
  }

  // The hall holding (x, z), or null.
  function hallAt(halls, x, z) {
    return halls.find((h) => x >= h.x0 && x <= h.x1 && z >= h.z0 && z <= h.z1) || null;
  }

  return {layout, hallAt, hallSize, weeklyActivity, hex, ROW_STRIDE, AISLE, PEDESTAL_H};
}));
