# ADR 003: Procedural assets (no external models)

## Status

Accepted

## Context

The ARK expedition truck must match a detailed visual reference, ship in a static web bundle, and stay within GPU budgets (≤ 25k triangles and ≤ 25 draw calls for the truck). Downloading glTF or texture packs adds latency, licensing overhead, and inconsistent art direction.

## Decision

Build the truck entirely in code in `src/truck/ark.ts`:

- Box, cylinder, extruded, and instanced geometries merged into material groups (paint / glass / trim)
- A single 256×256 canvas roughness atlas generated at boot
- Six instanced wheels from shared tire and rim geometries
- Two SpotLights for headlight cones
- Runtime damage and wear via vertex displacement and atlas wear, exposed through `setDamageVisual`, `setSteerVisual`, and `setSpeedVisual`

No external image or model files are imported.

## Consequences

- Positive: Zero asset pipeline; reproducible builds; strict triangle/draw-call enforcement at construction time.
- Positive: Visual state (steer, suspension bob, lamp flicker, hull damage) is data-driven on one rig API.
- Trade-off: Large single-file model code; changes require TypeScript edits rather than DCC export.
- Trade-off: World landmarks and highway props (planned as separate procedural modules) are not present in this repository slice—only the truck module is included here.
