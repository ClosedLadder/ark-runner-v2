# Release Notes

## v1.0.0 — 2026-09-27

Initial public portfolio release of the ARK RUNNER v2 truck slice.

### Included

- **Procedural ARK truck** (`src/truck/ark.ts`): matte-black 6×6 expedition rig built from Three.js primitives, merged geometry, instanced wheels, canvas roughness atlas, and headlight SpotLights.
- **Preview / turntable harness** (`src/preview.ts`): static and animated camera presets for model review and screenshot capture.
- **Screenshot plates** (`screenshots/`): eight PNG stills (front, 3/4, side, rear, top, low chase, night).
- **Headless capture script** (`capture.mjs`): Puppeteer helper for regenerating stills (requires a local Chrome/Chromium path configured for your machine).
- **Build tooling**: Vite 5, TypeScript 5.6 (strict), Three.js 0.170.0.

### Preview harness features

- URL-driven camera shots: `front`, `front34`, `side`, `rear`, `rear34`, `top`, `chase`, `night`
- Optional turntable animation (`?turntable=1`)
- Visual state knobs: `hull`, `steer`, `rpm` (0–1)
- Clean HUD-free mode (`?clean=1`)
- Self-test hook (`?selftest=1`) for automated pose checks

### Known limits

- **This repository slice does not include the full driving game loop** (input, scoring, highway world, hazards, audio, UI menus). Those modules were developed in a separate multi-workstream pipeline; only the truck model and preview harness are published here.
- `capture.mjs` ships with a Linux Chrome path from the original dev VM; update `executablePath` before running locally on macOS.
- `npm run shoot` depends on a dev server already listening on port 5179.
- No multiplayer, cloud saves, or commercial polish pass.

### Build

```bash
npm install --no-audit --no-fund
npm run dev    # http://127.0.0.1:5179
npm run build  # outputs to dist/
```
