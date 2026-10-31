// node tests/layout_test.js — the building a museum document becomes.
"use strict";
const assert = require("assert");
const path = require("path");
const fs = require("fs");
const MuseumLayout = require("../web/museum-layout.js");
const MuseumWalk = require("../web/museum-walk.js");

const sample = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "sample.museum.json"), "utf8"));

// A synthetic document with one crowded era, to exercise splitting and big halls.
function crowded(n) {
  const exhibits = Array.from({length: n}, (_, i) => ({id: "e" + i, title: "E" + i, date: "2026-08-01", group: "g", kind: "k",
    size: (i % 10) / 10, glow: 0, measures: {}}));
  return {title: "Crowded", exhibits, legend: {group: {values: [{id: "g", color: "#ff0000"}]}, kind: {values: [{id: "k", color: "#00ff00"}]}},
    eras: [{id: "2026", label: "2026", start: "2026-01-01", end: "2026-12-31", stats: [],
      halls: [{id: "2026-08", label: "Aug 2026", start: "2026-08-01", end: "2026-08-31", exhibits: exhibits.map((e) => e.id)}]}],
    activity: {primary: "s", series: {s: {"2026-08-03": 40}}}};
}

const tests = {
  "every exhibit gets a pedestal, once"() {
    for (const doc of [sample, crowded(130)]) {
      const b = MuseumLayout.layout(doc);
      assert.strictEqual(b.exhibits.length, doc.exhibits.length);
      assert.strictEqual(new Set(b.exhibits.map((x) => x.id)).size, doc.exhibits.length);
    }
  },
  "rows are whole primitives of a known kind"() {
    const b = MuseumLayout.layout(sample);
    assert.strictEqual(b.rows.length % MuseumLayout.ROW_STRIDE, 0);
    for (let i = 0; i < b.rows.length; i += MuseumLayout.ROW_STRIDE) assert.ok(b.rows[i] >= 0 && b.rows[i] <= 3);
  },
  "no pedestal stands in the aisle or inside a wall"() {
    const b = MuseumLayout.layout(crowded(130));
    const walls = b.colliders.filter((c) => c.kind === "box");
    for (const x of b.exhibits) {
      assert.ok(Math.abs(x.x) > MuseumLayout.AISLE / 2, `${x.id} is in the aisle`);
      for (const w of walls) {
        const inside = Math.abs(x.x - w.x) < w.hx + 0.45 && Math.abs(x.z - w.z) < w.hz + 0.45;
        assert.ok(!inside, `${x.id} at ${x.x},${x.z} overlaps a wall at ${w.x},${w.z}`);
      }
    }
  },
  "halls follow each other along the aisle, oldest first"() {
    const b = MuseumLayout.layout(sample);
    assert.strictEqual(b.halls[0].id, "lobby");
    for (let i = 2; i < b.halls.length; i++) assert.ok(b.halls[i].z0 >= b.halls[i - 1].z1, "halls overlap");
    assert.deepStrictEqual(b.halls.slice(1).map((h) => h.era), ["2019", "2020", "2021"]);
  },
  "the lobby timeline has one plinth per era, tallest for the busiest"() {
    const b = MuseumLayout.layout(sample);
    assert.deepStrictEqual(b.timeline.map((t) => t.era), ["2019", "2020", "2021"]);
    const busiest = b.timeline.reduce((a, t) => (t.activity > a.activity ? t : a));
    assert.strictEqual(busiest.era, "2021");
    assert.ok(b.timeline.every((t) => t.top <= busiest.top));
  },
  "walking straight ahead from the lobby reaches the last hall"() {
    for (const doc of [sample, crowded(130)]) {
      const b = MuseumLayout.layout(doc);
      let v = {x: b.spawn.x, z: b.spawn.z, yaw: b.spawn.yaw, pitch: 0};
      for (let i = 0; i < 4000; i++) v = MuseumWalk.step(v, {forward: 1, run: true}, 0.05, b.colliders);
      const last = b.halls[b.halls.length - 1];
      assert.ok(v.z > last.z0 && v.z < last.z1, `stopped at z=${v.z.toFixed(1)}, last hall ${last.z0}..${last.z1}`);
    }
  },
  "nobody walks out through a wall"() {
    const b = MuseumLayout.layout(sample);
    let v = {x: b.spawn.x, z: b.spawn.z, yaw: 0, pitch: 0};  // yaw 0 looks along -x: at the lobby's side wall
    for (let i = 0; i < 400; i++) v = MuseumWalk.step(v, {forward: 1, run: true}, 0.05, b.colliders);
    assert.ok(MuseumLayout.hallAt(b.halls, v.x, v.z), "left the building");
  },
  "the view looks the way the visitor faces"() {
    const v = {x: 2, z: 3, yaw: -Math.PI / 2, pitch: 0};
    const c = MuseumWalk.lookAt(v, 1.6);
    // The kit puts the eye at target + dist * (cos p cos yaw, sin p, cos p sin yaw).
    const eye = [c.tx + c.dist * Math.cos(c.yaw), c.ty, c.tz + c.dist * Math.sin(c.yaw)];
    assert.ok(Math.abs(eye[0] - 2) < 1e-9 && Math.abs(eye[1] - 1.6) < 1e-9 && Math.abs(eye[2] - 3) < 1e-9);
    assert.ok(c.tz > eye[2], "yaw -pi/2 should look along +z");
  },
  "facing finds what is ahead, not behind"() {
    const v = {x: 0, z: 0, yaw: -Math.PI / 2};
    const ahead = {x: 0, z: 2}, behind = {x: 0, z: -1};
    assert.strictEqual(MuseumWalk.facing(v, [ahead, behind]).thing, ahead);
    assert.strictEqual(MuseumWalk.facing(v, [behind]), null);
  },
  "weekly activity sums days into the right weeks"() {
    const w = MuseumLayout.weeklyActivity({"2021-01-01": 2, "2021-01-07": 3, "2021-01-08": 5, "2020-12-31": 9}, "2021-01-01", "2021-01-14");
    assert.deepStrictEqual(w.map((x) => x.count), [5, 5]);
  },
};

let failed = 0;
for (const [name, fn] of Object.entries(tests)) {
  try { fn(); console.log("ok   " + name); } catch (e) { failed++; console.log("FAIL " + name + "\n     " + e.message); }
}
process.exit(failed ? 1 : 0);
