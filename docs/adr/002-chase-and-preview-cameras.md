# ADR 002: 3/4 and chase camera framing

## Status

Accepted

## Context

ARK RUNNER is read at speed from behind the truck. Marketing stills and in-game readability both depend on a consistent 3/4 and low-chase framing that shows the ARK silhouette, light bar, and road context without orthographic "catalog" flatness.

## Decision

Use **perspective cameras for hero angles** (3/4 front, 3/4 rear, low chase, night chase) and orthographic cameras only for axis-aligned reference shots (front, side, rear, top). The preview harness (`src/preview.ts`) selects framing via the `shot` query parameter; the shipped game module (`scene/chasecam.ts` in the full project) follows the truck at +Z with a low rear offset similar to the `chase` preset.

Example chase preset in the preview harness:

- Camera position roughly behind and above the truck (`z ≈ +7`, `y ≈ 1.5`)
- Look-at near cab height so the hood, mirrors, and roof markers stay in frame

## Consequences

- Positive: One harness generates review stills (`screenshots/`) and validates camera readability before gameplay integration.
- Positive: Orthographic reference shots isolate modeling issues; perspective shots match player-facing composition.
- Trade-off: Preview cameras are static (or turntable-only); the live game camera adds follow smoothing and lane-relative offset in separate code not included in this repository slice.
