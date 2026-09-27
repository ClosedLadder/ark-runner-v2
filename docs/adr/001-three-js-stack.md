# ADR 001: Three.js for ARK RUNNER v2

## Status

Accepted

## Context

ARK RUNNER v1 was a 2D Canvas game. v2 needed real-time 3D lighting (headlight pools, fog, chase perspective), procedural geometry, and a self-contained browser build with no external asset downloads.

## Decision

Use **Vite + TypeScript (strict) + Three.js** (pinned in `package-lock.json`). All visuals are procedural or generated at runtime (canvas textures, merged geometry). No CDN fetches at runtime; `vite build` produces a static `dist/` folder.

## Consequences

- Positive: One stack for truck, world, particles, and post-processing; strong WebGL ecosystem; type definitions via `@types/three`.
- Positive: Matches evergreen Chrome/Safari/Firefox targets with ES2022 output.
- Trade-off: WebGL performance and draw-call budgets must be managed explicitly (see truck budget checks in `src/truck/ark.ts`).
- Trade-off: Team must pin Three.js versions; addon imports (e.g. `BufferGeometryUtils`) track the pinned release.
