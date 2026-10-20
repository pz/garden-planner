# Garden Planner

A client-only React + TypeScript ([Vite](https://vite.dev)) app for planning vegetable
garden beds: lay out beds, place plants with the right spacing, and see when to start,
plant and harvest for your USDA zone. There is no backend yet; each garden is saved in
`localStorage` and can be exported to / loaded from a JSON file.

## Commands

| | |
| --- | --- |
| `npm run dev` | Dev server |
| `npm run build` | Typecheck (`tsc -b`) and production build |
| `npx tsc -b --noEmit` | Typecheck only |
| `npm run lint` | [oxlint](https://oxc.rs) |
| `npm run test` / `npm run test:watch` | Unit tests ([vitest](https://vitest.dev), plain Node) |
| `npm run test:e2e` | Browser tests ([Playwright](https://playwright.dev), `e2e/`); starts the dev server itself |

CI (`.github/workflows/ci.yml`) runs typecheck, lint, unit tests and the browser tests on every PR.
First time running the browser tests locally: `npx playwright install chromium` (or set
`PW_CHROMIUM_PATH` to an existing Chromium).

## Code organization

The code is split into layers that only depend "downward". The point is that everything
that decides what a garden *is* and what is *valid* can run, and be tested, headless in
Node: no browser, no React.

```
src/
  types.ts        Shared type definitions (GardenPlan, Bed, PlantInstance, CropDef, …)
  data/           Static reference data
  core/           The headless engine
  api/            Formal API over core: commands, errors, warnings, layout view — see docs/api-design.md
  app/            The React app and everything browser-specific
```

### `src/data/` — reference data

Crops, USDA zones and the per-crop tips, as JSON plus tiny accessors (`getCrop`,
`getZone`, …). Hand-curated, never generated at runtime. See
[`src/data/README.md`](src/data/README.md) for the field meanings and how to add a crop.

### `src/core/` — the engine

Pure functions and types with no React, DOM or storage. This is where the rules live:

- **State machine and file format.** `reducer.ts` (`GardenPlan` state transitions and
  `parsePlan`), `gardenFile.ts` (export/load format and validation), `migration.ts`
  (legacy plan upgrades), `gardenIndex.ts` (the list of saved gardens).
- **Planting rules.** `spacing.ts` (overlap and fit), `geometry.ts` (outlines, patch
  boxes, multiply-drag ghosts), `layout.ts` (bed frames, resizing, relocating plants,
  cloning).
- **Scheduling.** `dates.ts`, `calendar.ts`.
- **Location and zones.** `location.ts`, `geoZone.ts`, `zoneMap.ts`, `usdaZones.ts`.

### `src/api/` — the API layer

Pure, headless, and the only way the app (and later an agent) is meant to read a plan's
problems and change it:

- `commands.ts`: the command types and `parseRequest`, which validates untrusted JSON.
- `apply.ts`: `applyCommands(plan, commands, {newId, ifRev?, dryRun?})`. Atomic; returns the
  new plan, its revision, what each command did, and the warnings it introduced and resolved,
  or every error with its command index.
- `warnings.ts` (`computeWarnings` / `diffWarnings`), `rev.ts` (content-hash revision
  tokens), `layoutView.ts` (`readLayout`, a text-grid picture of each bed), `types.ts`
  (`Warning`, `ApiError`).

- `gardenApi.ts`: `GardenApi`, what the UI talks to for one garden (a store-shaped
  `getSnapshot` / `subscribe` plus a synchronous `apply`), and `createMemoryGardenApi`.
- `mockGardenApi.ts`: `createMockGardenApi`, a `GardenApi` for testing a client: it records
  every call and can fail the next one, report chosen warnings, or have the garden change
  behind the client's back.

The UI's planting edits go through it. Bed and profile edits still use reducer actions (via
`GardenApi.dispatch`) until they have commands. The design, and what's still to come (bed
commands, shade and companion warnings), is in [`docs/api-design.md`](docs/api-design.md).

### `src/app/` — the app

Everything that needs a browser or React:

- `components/` — thin UI: rendering, gesture wiring and calls into `core`.
- `state/` — React contexts and `localStorage` persistence: `gardenStore` (binds a
  `GardenApi` to React), `gardenApiFactory` (the real, localStorage-backed `GardenApi`), `gardensStore`,
  dismissed tips, storage namespacing for PR previews, editor undo.
- `layoutInteraction.ts`, `viewport.ts` — layout-editor interaction math that only
  exists with a pointer and a screen: snapping, alignment guides, zoom and pan. Pure and
  unit-tested, but not part of the engine.
- `geolocation.ts`, `geocode.ts`, `pointer.ts` — wrappers over browser services.
- `main.tsx`, `App.tsx` — entry points.

### Dependency rules

```
data  ←  core  ←  api  ←  app
```

- `data` imports nothing from `core`, `api` or `app`.
- `core` imports only `data` and `types`.
- `api` imports `core`, `data` and `types`, never `app`.
- `app` may import `core` for pure read-only helpers (e.g. computing a patch's
  bounding box to draw it). Changes to a garden go through `api` (planting edits now; bed
  edits once they have commands).

These are enforced, not conventions: `.oxlintrc.json` has `no-restricted-imports`
overrides, and `tsconfig.core.json` typechecks `data`, `core` and `api` with no DOM lib, so
using `window`, `document` or `localStorage` in those layers fails `npx tsc -b --noEmit`.

### Tests

Tests are colocated (`foo.ts` → `foo.test.ts`) and run in plain Node. Everything in
`core` and `data` is testable headless, which is also what lets the engine be driven
without a UI (scripted or randomized simulations). See [`CLAUDE.md`](CLAUDE.md) for the
testing conventions and the pre-push checklist.

`e2e/` holds the Playwright suite: a small set of real-browser tests of what users do (plant,
drag, remove and undo, spacing warnings, the layout editor, export/load, first-run setup). They
seed a garden into `localStorage`, assert on what the app saves as well as on what it shows,
block all non-local network requests, and fail on any uncaught page error. They exist so the
state layer can be refactored (e.g. onto `api`) without silently changing how the app behaves.
`e2e/mock-api.spec.ts` runs the UI against the mock `GardenApi` instead of the real one, to test the
client on its own: what it asks the API for, and how it shows what comes back (see
`e2e/fixtures.ts`; the mock is only available in development builds).

## Docs

- [`docs/api-design.md`](docs/api-design.md) — design of the planting API (in progress).
- `docs/screenshots/` — per-PR screenshots.
