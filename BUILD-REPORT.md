# BUILD-REPORT — ARK RUNNER v2 portfolio package

**Date:** 2026-09-27  
**Destination:** `~/github-portfolio/ark-runner-v2/`  
**Source (read-only):** `~/github-portfolio-src/ark-runner-v2/`

## File list (tracked project files, excluding `node_modules/` and `dist/`)

```
.github/workflows/ci.yml
.gitignore
LICENSE
README.md
RELEASE-NOTES.md
capture.mjs
docs/adr/001-three-js-stack.md
docs/adr/002-chase-and-preview-cameras.md
docs/adr/003-procedural-assets.md
index.html
package-lock.json
package.json
screenshots/01-front.png
screenshots/02-front-three-quarter.png
screenshots/03-side.png
screenshots/04-rear-three-quarter.png
screenshots/05-rear.png
screenshots/06-top.png
screenshots/07-low-chase.png
screenshots/08-night.png
src/preview.ts
src/truck/ark.ts
tsconfig.json
vite.config.ts
```

## Build result

**Local build: PASS**

Commands run on Air (network available):

```text
$ npm install --no-audit --no-fund
added 105 packages in 2s

$ npm run build
> ark-runner-v2@1.0.0 build
> tsc --noEmit && vite build

vite v5.4.11 building for production...
✓ 7 modules transformed.
dist/index.html                  0.92 kB │ gzip:   0.57 kB
dist/assets/index-BdMySqhX.js  531.82 kB │ gzip: 139.10 kB
✓ built in 610ms
```

TypeScript syntax check: **PASS** (`npx tsc --noEmit` exit 0)

CI workflow (`.github/workflows/ci.yml`) uses the same install/build commands and was verified locally before commit.

## Secrets grep

**Exact command (as specified):**

```bash
grep -rniE 'api_key|apikey|password|passwd|bearer [A-Za-z0-9_-]{8,}|BEGIN.*PRIVATE' ~/github-portfolio/ark-runner-v2
```

**Result:** 560 matches — all inside `node_modules/` (dependency README/type examples, e.g. Zod password-form docs, Node `crypto` API docs). **No real secret values in project source.**

**Project source only** (excluding `node_modules/` and `dist/`): **CLEAN** (0 matches)

No API keys, tokens, private keys, or credentials were found in authored files.

## Judgment calls

| Decision | Rationale |
|----------|-----------|
| **Honest scope in README** | Staged source contains only `src/truck/ark.ts` + `src/preview.ts` (turntable harness), not the full driving game (`main.ts`, world, hazards, UI). README documents the truck slice; does not claim National Parks landmarks or playable driving that are absent from code. |
| **Removed internal docs** | Deleted `WS*.md`, `CONTRACTS.md`, `new-cursor-agent-brief.md`, `inbox-README.md`, `itch-page-draft.md`, `SOURCE-NOTE.md`, `vite.log` — fleet work orders and internal drafts, not player-facing game docs. |
| **Kept `capture.mjs`** | Useful dev tooling tied to `screenshots/`; noted Linux Chrome path caveat in README and release notes. |
| **Kept `screenshots/`** | Eight real review PNGs from source; embedded in README. |
| **Added `docs/adr/`** | Three short ADRs grounded in actual stack/camera/procedural decisions visible in code and preview harness. |
| **Updated `package.json`** | Renamed to `ark-runner-v2`, removed `private`, added MIT license/author metadata. Scripts unchanged. |
| **Did not add `public/`** | Source had no `public/` directory. |
| **CI badge repo** | Points to `ClosedLadder/ark-runner-v2` as specified; will activate after GitHub push. |

## What was not in the staged source

The portfolio brief described a full chase-cam driving game with procedural National Parks landmarks. The culled source at `github-portfolio-src/ark-runner-v2/` contains **36 files** and no `src/world/`, `src/engine/`, `src/scene/`, or game entry `main.ts`. National Parks landmark strings do not appear anywhere in the source tree. This package publishes what exists: the procedural ARK truck and preview tooling from the v2 rebuild pipeline.
