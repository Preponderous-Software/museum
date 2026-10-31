// The museum scene: Strata draws what the page lays out.
//
// The page (web/museum-layout.js) turns a museum document into rows of
// primitives; this file only draws them. Static rows (floors, walls,
// pedestals, exhibits) are handed over once and culled by distance from the
// eye; dynamic rows (things that move) and the lights near the visitor are
// handed over every frame. Nothing here knows what an exhibit is.
//
// Row layout, kRowStride floats: kind, x, y, z, sx, sy, sz, r, g, b
// (kind is a STRATA_PRIMITIVE_*, colour is linear 0..1).
// Light layout, kLightStride floats: x, y, z, range, r, g, b, intensity.
#define STRATA_KIT_MAIN
#include "strata_kit.h"

#include <vector>

namespace {

constexpr int kRowStride = 10;
constexpr int kLightStride = 8;

struct Scene {
    std::vector<float> staticRows;
    std::vector<float> dynamicRows;
    std::vector<float> lights;
    float cullDistance = 70.0f;
} scene;

void addRows(strata_kit::Host& h, const std::vector<float>& rows, bool cull) {
    const float cull2 = scene.cullDistance * scene.cullDistance;
    for (size_t i = 0; i + kRowStride <= rows.size(); i += kRowStride) {
        const float* r = &rows[i];
        if (cull) {
            const float dx = r[1] - h.eye[0], dz = r[3] - h.eye[2];
            // A big thing (a floor, a long wall) is kept while any of it might be near.
            const float reach = 0.5f * std::max(r[4], r[6]);
            const float d = std::max(0.0f, std::sqrt(dx * dx + dz * dz) - reach);
            if (d * d > cull2) continue;
        }
        h.add(static_cast<int>(r[0]), r[1], r[2], r[3], r[4], r[5], r[6], {r[7], r[8], r[9]});
    }
}

void copyRows(std::vector<float>& into, const float* rows, int count, int stride) {
    into.assign(rows, rows + static_cast<size_t>(std::max(count, 0)) * stride);
}

}  // namespace

void strata_kit_configure(strata_kit::Options& o) {
    o.name = "museum";
    o.fovDegrees = 70.0f;
    o.nearPlane = 0.05f;
    o.farPlane = 220.0f;
    o.shadowDistanceMin = 45.0f;
    o.shadowDistancePerDist = 0.0f;  // the camera sits at the eye: distance says nothing here
}

void strata_kit_engine_ready(strata_kit::Host&) {}

void strata_kit_build(strata_kit::Host& h, double) {
    addRows(h, scene.staticRows, true);
    addRows(h, scene.dynamicRows, false);
    for (size_t i = 0; i + kLightStride <= scene.lights.size(); i += kLightStride) {
        const float* l = &scene.lights[i];
        h.light(l[0], l[1], l[2], l[3], {l[4], l[5], l[6]}, l[7]);
    }
}

STRATA_KIT_EXPORT void mu_set_static(const float* rows, int count) { copyRows(scene.staticRows, rows, count, kRowStride); }
STRATA_KIT_EXPORT void mu_set_dynamic(const float* rows, int count) { copyRows(scene.dynamicRows, rows, count, kRowStride); }
STRATA_KIT_EXPORT void mu_set_lights(const float* rows, int count) { copyRows(scene.lights, rows, count, kLightStride); }
STRATA_KIT_EXPORT void mu_set_cull_distance(float metres) { scene.cullDistance = std::max(metres, 5.0f); }
