# Garden Planner

A client-only React + TypeScript ([Vite](https://vite.dev)) app for planning vegetable
garden beds: lay out beds, place plants with the right spacing, and see when to start,
plant and harvest for your USDA zone. There is no backend yet; each garden is saved in
`localStorage` and can be exported to / loaded from a JSON file.

## Overview

Garden Planner helps you plan a vegetable garden before you dig. You describe where you
live and how sunny the garden is, draw your beds, and place plants in them. The app checks
the plan against a few gardening rules as you go, and tells you when to start seeds, put
plants out and expect a harvest.

What it does:

- **Set up a garden.** Pick a location on a map (which gives your USDA hardiness zone, and so
  your average frost dates), and say how much sun the garden gets.
- **Lay out beds.** Draw rectangular, rounded, elliptical or polygonal beds, move, turn and
  resize them, add lines (paths, fences, hoses), and set which way north points. Layout edits
  can be undone.
- **Plant.** Choose a crop and click, paint or stamp it into a bed. Plants keep the spacing the
  crop needs. Select, move, copy and remove them singly or in groups. Add your own plants if a
  crop isn't built in.
- **Get warnings.** Plants too close together, a tall plant shading one that needs full sun, and
  crops that are traditionally kept apart are flagged, with a suggestion for fixing each.
  You can dismiss a warning you disagree with.
- **See the season.** A planting calendar shows, for your zone, when to start each crop indoors,
  sow or transplant it outside, and expect the first harvest. Each crop also has a short tip.
- **Keep several gardens**, saved in your browser, and export a garden to a file (or load one).
- **Adjust the plan (early, in progress).** With nothing selected, the card on the right lists the
  garden's crops with their counts. Click a bed to see just its crops. On any row, ask for more
  (an arrow), fewer (an arrow), or an exact number (type it), or add a crop that isn't planted yet,
  then press Suggest: the suggestion is drawn on the garden (new plants ringed, removals faded) and
  you choose Apply, Try again or Discard. Today the suggestions come from a simple placeholder; the
  planting solver is next.
- **Plan by asking (in progress).** A planting solver turns a description of what you want
  ("tomatoes, peppers and lettuce, fewer melons") into a proposed set of plantings. It is
  built and tested, and has an experimental viewer (`#/_solver`), but is not yet part of the app's main UI;
  it is the foundation for an assistant that plans with you.

There is no backend yet: everything runs in the browser and is saved in `localStorage`.

## Terminology

The words below are used the same way in the UI, the code and the docs. Type names are in
`code` where there is one (most are in [`src/types.ts`](src/types.ts)).

### The garden

| Term | Meaning |
| --- | --- |
| **Garden** (plan) | Everything about one garden: its name, profile, beds, plants and lines. In code a `GardenPlan`. You can keep several; each has an id. |
| **Bed** | A named area plants grow in, with a shape (`rect`, `ellipse` or `polygon`), a size, a position and a rotation. |
| **Layout** | Where the beds and lines are. The **layout editor** changes it; **planting view** is the other mode, where you place plants. |
| **Line** | A straight line drawn on the layout, such as a path or fence. It has no effect on rules. |
| **Profile** | The garden-level facts the rules need: hardiness zone, sun exposure, the optional map location. |
| **Zone** | A USDA hardiness zone, which gives average last-spring and first-fall frost dates. Found from the map location, or picked by hand. |
| **Sun exposure** | How sunny the whole garden is: `full-sun`, `part-shade` or `shade`. It is a property of the garden, not of each bed. |
| **North** | Which way north points on the layout (`northDeg`). Shadows fall toward north in the northern hemisphere, so shade rules need it. |
| **Garden coordinates** | Inches across the whole layout, y pointing down. Beds are placed in these. |
| **Bed-local coordinates** | Inches from a bed's own top-left corner, before the bed is turned. Plants are stored this way, so moving or turning a bed never touches its plants. |

### Plants

| Term | Meaning |
| --- | --- |
| **Crop** | A kind of plant, with the facts the rules use (`CropDef`): spacing, height, sun need, how it is sown, days to maturity, and any crops to avoid near it. Built-in crops live in [`src/data/`](src/data/README.md) and are never generated at runtime. |
| **Custom plant** | A crop the gardener makes (ids start with `custom-`), with a spacing, an optional height and a look. It has no planting schedule. |
| **Plant** | One plant in a bed (`PlantInstance`): a crop, a bed and a point. |
| **Patch** | Plants of one crop that move, warn and are dismissed together: they share a `groupId`. A lone plant is a patch of one. |
| **Variety** | An optional free-text label on a plant ("Cherokee Purple"). |
| **Spacing** | The least distance, in inches, between plants of a crop. Each plant has a **growing room**, a circle of half that. |
| **Stamp** | A set of plants copied so the same arrangement can be placed again. |
| **Selection** | The plants you have picked (by click, modifier-click or dragging a box) to move, copy or remove together. |

### Rules, warnings and the season

| Term | Meaning |
| --- | --- |
| **Crops card** | The card on the right of the planting view when no plant is selected: the garden's (or one bed's) crops with counts, and where you ask for more, fewer or an exact number of each. |
| **Request** (adjust) | What was asked of each crop on the card: *more* or *fewer* (a direction; the suggestion decides how many) or an exact target (0 takes the crop out). Not to be confused with an API request below. |
| **Suggestion** | A proposed change to the garden, drawn on it before it is applied, with the changes crop by crop. Apply sends it as one batch of commands (one Undo); Discard drops it. |
| **Warning** | A derived problem with the garden as it is now, never stored. Three kinds: **spacing** (two patches closer than the average of their crops' spacing), **shade** (a plant at least 12 in taller sits sun-side of one that needs full sun) and **companion** (two crops usually kept apart are within 24 in). |
| **Severity** | `caution` (not ideal) or `problem` (spacing closer than 70% of what is wanted, which the planting UI will not let you place). |
| **Dismissed** | A warning you waved off. It stays readable but is not reported as new. |
| **Planting schedule** | For a crop in your zone: when to start indoors, sow or transplant outside, and first harvest. Worked out from the zone's frost dates (`dates.ts`). |
| **Calendar** | The season view of every planted crop's schedule. |
| **Tip** | A one-line piece of growing advice for a crop, which you can dismiss. |

### Saving and sharing

| Term | Meaning |
| --- | --- |
| **Saved garden** | A garden kept in the browser's `localStorage`. |
| **Garden file** | The export format: the garden plus where it came from (and any custom plants it uses). Loading one creates a new garden. |
| **Preview** | Every pull request gets a live copy of the app whose saved gardens are kept apart from the real site's. |

### The API

Everything that changes a garden is a request to one API, so the app and, later, an
assistant follow the same rules (see [`docs/api-design.md`](docs/api-design.md)).

| Term | Meaning |
| --- | --- |
| **Command** | One edit: add or remove a patch, move a bed, rename the garden, dismiss a warning, and so on. |
| **Request** | A batch of commands applied all together or not at all. Every problem is reported with a path into the request. |
| **`GardenApi`** | What the UI talks to for one garden: read the current garden, subscribe to changes, `apply` commands. |
| **Revision** (`rev`) | A hash of the garden's content. Sending `ifRev` makes a request fail with `stale_revision` if the garden changed since you read it. |
| **Dry run** | Apply a request and report the result and the warnings it would cause, without changing the garden. |
| **Scope** | `planting` limits a request to plants (what an agent gets); `all` also allows beds and the profile. |

### The planting solver

The solver ([`src/solver/`](src/solver/README.md)) decides *where* plants go; a **spec**
says only *what* you want. Its output is ordinary API commands, checked with a dry run.

| Term | Meaning |
| --- | --- |
| **Planting spec** | The request to the solver (`PlantingSpec`): a mode, demands, and optional scope, locks, exclusions and preferences. It says what to plant and what may change, never where. |
| **Demand** | One crop you want, with a **weight** (its relative share of the planted area, so "lower priority" is a smaller weight, and 0 means ignore the crop), an optional `min` and `max` number of plants, and optionally the beds it may go in. |
| **Mode** | `fill`: use only free space, touch nothing. `adjust`: existing plants may be moved, resized or removed at a cost. `replace`: clear the scope and plan it from empty. |
| **Scope** | The beds the solver may plant in. Plants outside it are never touched, but still count for spacing and shade. |
| **Locked / exclude** | Locked patches are never touched. An excluded crop is not planted, and in `adjust` and `replace` its existing patches in scope are removed. |
| **Fill ratio** | The share of free space to aim to plant (default 0.85). |
| **Edge clearance** | How far in from a bed's edge a plant's center must stay, as a share of the plant's own growing-room radius: 0.5 by default (about a quarter of the plant may overhang), 1 keeps the whole plant inside, 0 allows plants right on the edge. |
| **Minimum group** | The smallest block a crop is planted in: corn needs at least 3 by 3 (it is wind-pollinated), crops grown in patches at least 4 plants. A crop that would get fewer is left out and says so. |
| **Preferences** | How much the solver minds each cost: spacing, shade, companions, clustering, coverage (using each bed's share of the space), tidiness (several crops in one bed), and (in `adjust`) disturbing what is there. |
| **Block** | The solver's unit of planting: a rectangular grid of one crop at its spacing in one bed, which becomes one patch. |
| **Target** | How many plants of a crop the solver aims for, from its weight and the space available. |
| **Proposal** | What `solve` returns: the commands, a result per crop (placed against target, and why if short), the score, and the warnings the commands would cause. Accepting it is `GardenApi.apply`. |
| **Objective / score** | The number the solver maximizes: reward for meeting each crop's target, minus costs for crowding, shade, companion conflicts, scattered blocks, and plants that spill past a bed's edge. |
| **Hard constraint** | A rule a proposal never breaks: every plant inside its bed, and no problem-severity spacing. Closer-than-ideal spacing is only a cost. |
| **Fixture / scenario** | A garden file, a spec, and a scenario pairing them with what the result must satisfy: the test and demo inputs for the solver. |
| **Solver viewer** | An experimental page (`/_solver`, or `#/_solver` on the hosted site) for running a scenario or your garden and applying the result. It is in the app and in PR previews. |

## Commands

| | |
| --- | --- |
| `npm run dev` | Dev server |
| `npm run build` | Typecheck (`tsc -b`) and production build |
| `npx tsc -b --noEmit` | Typecheck only |
| `npm run lint` | [oxlint](https://oxc.rs) |
| `npm run test` / `npm run test:watch` | Unit tests ([vitest](https://vitest.dev), plain Node) |
| `npm run solve -- --all` | Planting solver CLI: solve fixture scenarios, `--sweep` to compare settings (see [`src/solver/README.md`](src/solver/README.md)) |
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
  solver/         The planting solver and its test harness — see src/solver/README.md
  app/            The React app and everything browser-specific
```

### `src/data/` — reference data

Crops, USDA zones and the per-crop tips, as JSON plus tiny accessors (`getCrop`,
`getZone`, …). Hand-curated, never generated at runtime. See
[`src/data/README.md`](src/data/README.md) for the field meanings and how to add a crop.

### `src/core/` — the engine

Pure functions and types with no React, DOM or storage. This is where the rules live:

- **State machine and file format.** `reducer.ts` (`GardenPlan` state transitions and
  `parsePlan`), `gardenFile.ts` (export/load format and validation, including the user-made plants a garden file carries), `migration.ts`
  (legacy plan upgrades), `gardenIndex.ts` (the list of saved gardens).
- **Planting rules.** `spacing.ts` (overlap warnings), `shade.ts` and `companions.ts` (what a
  neighbor's shadow or an unlucky pairing does), `geometry.ts` (bed outlines, grids),
  `layout.ts` (bed frames, resizing, relocating plants, cloning), `planting.ts` (the
  planting gestures: brush placement, hit testing, selection, stamps),
  `placement.ts` (which bed a garden point is in and where dragged or stamped plants land),
  `selectionSummary.ts` (what the selection panel says).
- **Scheduling.** `dates.ts`, `calendar.ts`.
- **Location and zones.** `location.ts`, `geoZone.ts`, `zoneMap.ts`, `usdaZones.ts`.

### `src/api/` — the API layer

Pure, headless, and the only way the app (and later an agent) is meant to read a plan's
problems and change it:

- `commands.ts`: the command types and `parseRequest`, which validates untrusted JSON.
- `apply.ts`: `applyCommands(plan, commands, {newId, ifRev?, dryRun?})`. Atomic; returns the
  new plan, its revision, what each command did, and the warnings it introduced and resolved,
  or every error with its command index.
- `warnings.ts` (`computeWarnings` / `diffWarnings`: spacing, shade and companion warnings), `rev.ts` (content-hash revision
  tokens), `layoutView.ts` (`readLayout`, a text-grid picture of each bed), `types.ts`
  (`Warning`, `ApiError`).

- `gardenApi.ts`: `GardenApi`, what the UI talks to for one garden (a store-shaped
  `getSnapshot` / `subscribe` plus a synchronous `apply`), and `createMemoryGardenApi`.
- `mockGardenApi.ts`: `createMockGardenApi`, a `GardenApi` for testing a client: it records
  every call and can fail the next one, report chosen warnings, or have the garden change
  behind the client's back.

Every edit the UI makes (planting, beds, layout undo, profile, name) is a command through
`GardenApi.apply`; the reducer is only the state machine underneath. `scope: "planting"` is how
an agent's request will be limited to planting. The design, and what's still to come (shade and
companion warnings, the HTTP/MCP layer), is in [`docs/api-design.md`](docs/api-design.md).

### `src/app/` — the app

Everything that needs a browser or React:

- `components/` — thin UI: rendering, gesture wiring and calls into `core`.
- `planting/` — the planting view: `PlantingView` (camera, gestures, keyboard, undo; all edits
  go through `GardenApi`), `GardenSvg` (the garden as one SVG in garden inches), the plant list,
  selection panel, help box and menus.
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
  bounding box to draw it). Every change to a garden goes through `api` (lint forbids importing the reducer into `app`).

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
