/* museum-walk.js: first-person walking for the museum.

   The top half is pure (no DOM, no engine) so tests/walk_test.js runs it
   under node:

     MuseumWalk.resolve(x, z, colliders)          -> {x, z} pushed out of walls and pedestals
     MuseumWalk.step(visitor, input, dt, colliders) -> the visitor after dt seconds of input
     MuseumWalk.lookAt(visitor, eyeY)             -> the kit camera {yaw, pitch, dist, tx, ty, tz} for that view
     MuseumWalk.facing(visitor, things, maxD, cone) -> the nearest thing ahead within maxD, or null
     MuseumWalk.stick(dx, dy, radius)             -> joystick offset (CSS px) -> {forward, right, run}

   The visitor is {x, z, yaw, pitch}. Like the Strata kit's orbit camera,
   yaw and pitch describe where the eye sits relative to what it looks at,
   so the view runs along -(cos pitch cos yaw, sin pitch, cos pitch sin yaw):
   the kit's own drag-to-orbit then works as drag-to-look unchanged.

   The bottom half, MuseumWalk.attach(ctx), reads the keyboard and a touch
   joystick into that input. All pointer maths is in CSS pixels. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.MuseumWalk = factory();
}(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const RADIUS = 0.35;                       // m, the visitor's body
  const WALK_SPEED = 3.2, RUN_SPEED = 7.5;   // m/s
  const KEY_TURN = 1.9;                      // rad/s on ArrowLeft/Right and Q/E-less keyboards
  const SUBSTEP = 0.05;                      // s, keeps collisions solid at low frame rates
  const CAMERA_DIST = 0.05;                  // m between the kit's orbit target and the eye
  const MIN_PITCH = -0.9, MAX_PITCH = 0.9;

  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

  function resolve(x, z, colliders, r = RADIUS) {
    for (let iter = 0; iter < 4; iter++) {
      let moved = false;
      for (const o of colliders) {
        if (o.kind === "circle") {
          let dx = x - o.x, dz = z - o.z, d = Math.hypot(dx, dz);
          const min = o.r + r;
          if (d >= min) continue;
          if (d < 1e-6) { dx = 1; dz = 0; d = 1; }
          x = o.x + (dx / d) * min; z = o.z + (dz / d) * min;
        } else {
          const cx = clamp(x, o.x - o.hx, o.x + o.hx), cz = clamp(z, o.z - o.hz, o.z + o.hz);
          const dx = x - cx, dz = z - cz, d = Math.hypot(dx, dz);
          if (d >= r) continue;
          if (d > 1e-6) { x = cx + (dx / d) * r; z = cz + (dz / d) * r; }
          else {
            // Inside the box: out through the nearest side.
            const px = o.hx - Math.abs(x - o.x), pz = o.hz - Math.abs(z - o.z);
            if (px < pz) x = o.x + (x >= o.x ? 1 : -1) * (o.hx + r);
            else z = o.z + (z >= o.z ? 1 : -1) * (o.hz + r);
          }
        }
        moved = true;
      }
      if (!moved) break;
    }
    return {x, z};
  }

  // Unit vectors on the ground for the visitor's view.
  function forwardOf(yaw) { return {x: -Math.cos(yaw), z: -Math.sin(yaw)}; }
  function rightOf(yaw) { const f = forwardOf(yaw); return {x: -f.z, z: f.x}; }

  /* input: {forward, right, turn} in -1..1, run (bool). */
  function step(v, input, dt, colliders) {
    dt = clamp(dt, 0, 0.25);
    const yaw = v.yaw + (input.turn || 0) * KEY_TURN * dt;
    let f = input.forward || 0, r = input.right || 0;
    const mag = Math.hypot(f, r);
    if (mag > 1) { f /= mag; r /= mag; }
    const fw = forwardOf(yaw), rt = rightOf(yaw);
    const speed = input.run ? RUN_SPEED : WALK_SPEED;
    const vx = (fw.x * f + rt.x * r) * speed, vz = (fw.z * f + rt.z * r) * speed;
    let x = v.x, z = v.z;
    if (mag > 0.05) {
      for (let left = dt; left > 1e-6; left -= SUBSTEP) {
        const h = Math.min(SUBSTEP, left);
        const p = resolve(x + vx * h, z + vz * h, colliders);
        x = p.x; z = p.z;
      }
    }
    return {x, z, yaw, pitch: clamp(v.pitch, MIN_PITCH, MAX_PITCH), moving: mag > 0.05};
  }

  function lookAt(v, eyeY) {
    const cp = Math.cos(v.pitch);
    return {yaw: v.yaw, pitch: v.pitch, dist: CAMERA_DIST,
      tx: v.x - CAMERA_DIST * cp * Math.cos(v.yaw),
      ty: eyeY - CAMERA_DIST * Math.sin(v.pitch),
      tz: v.z - CAMERA_DIST * cp * Math.sin(v.yaw)};
  }

  // The nearest thing (with x, z) within maxD whose bearing is inside the view cone (radians either side).
  function facing(v, things, maxD = 2.6, cone = 0.6) {
    const fw = forwardOf(v.yaw);
    let best = null;
    for (const t of things) {
      const dx = t.x - v.x, dz = t.z - v.z, d = Math.hypot(dx, dz);
      if (d > maxD || d < 1e-6) continue;
      const cos = (dx * fw.x + dz * fw.z) / d;
      if (cos < Math.cos(cone)) continue;
      if (!best || d < best.d) best = {thing: t, d};
    }
    return best;
  }

  function stick(dx, dy, radius) {
    let x = dx / radius, y = -dy / radius;
    const m = Math.hypot(x, y);
    if (m > 1) { x /= m; y /= m; }
    if (m < 0.12) return {forward: 0, right: 0, run: false};
    return {forward: y, right: x, run: m > 0.92};
  }

  /* ---------------------------------------------------------- the page */
  // ctx: {stickEl, knobEl, onInteract(), isTyping()}. Returns {input(), touchSeen}.
  function attach(ctx) {
    const keys = new Set();
    let stickIn = {forward: 0, right: 0, run: false}, stickPointer = null;
    // A phone starts in touch mode (joystick, touch hints), before its first tap.
    const coarse = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
    const api = {touchSeen: coarse};
    if (coarse) ctx.stickEl.hidden = false;
    const MOVE = new Set(["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright", "shift"]);

    // Capture phase on window, so these keys never reach the kit's orbit keys.
    window.addEventListener("keydown", (e) => {
      if (ctx.isTyping(e) || e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (MOVE.has(k)) { keys.add(k); e.preventDefault(); e.stopPropagation(); }
      else if ((k === "e" || k === "enter") && !e.repeat) { if (ctx.onInteract()) { e.preventDefault(); e.stopPropagation(); } }
    }, true);
    window.addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()), true);
    window.addEventListener("blur", () => keys.clear());
    window.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "touch" && !api.touchSeen) { api.touchSeen = true; ctx.stickEl.hidden = false; }
    }, true);

    const STICK_R = 56;
    function stickMove(e) {
      const r = ctx.stickEl.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
      stickIn = stick(dx, dy, STICK_R);
      const m = Math.hypot(dx, dy), k = m > STICK_R ? STICK_R / m : 1;
      ctx.knobEl.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
    }
    function stickEnd(e) {
      if (e.pointerId !== stickPointer) return;
      stickPointer = null;
      stickIn = {forward: 0, right: 0, run: false};
      ctx.knobEl.style.transform = "";
    }
    ctx.stickEl.addEventListener("pointerdown", (e) => {
      e.preventDefault(); e.stopPropagation();
      stickPointer = e.pointerId;
      ctx.stickEl.setPointerCapture(e.pointerId);
      stickMove(e);
    });
    ctx.stickEl.addEventListener("pointermove", (e) => { if (e.pointerId === stickPointer) stickMove(e); });
    ctx.stickEl.addEventListener("pointerup", stickEnd);
    ctx.stickEl.addEventListener("pointercancel", stickEnd);

    api.input = function () {
      const has = (k) => (keys.has(k) ? 1 : 0);
      return {
        forward: clamp(has("w") + has("arrowup") - has("s") - has("arrowdown") + stickIn.forward, -1, 1),
        right: clamp(has("d") - has("a") + stickIn.right, -1, 1),
        turn: has("arrowright") - has("arrowleft"),
        run: keys.has("shift") || stickIn.run,
      };
    };
    api.clear = () => { keys.clear(); stickIn = {forward: 0, right: 0, run: false}; };
    return api;
  }

  return {resolve, step, lookAt, facing, stick, attach, forwardOf, RADIUS};
}));
