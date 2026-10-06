# Garden Planner

A client-only React + TypeScript (Vite) app for planning a vegetable garden bed — see the project brief for product context. State lives in `localStorage`; there is no backend yet.

## Before pushing

- `npx tsc -b --noEmit` — typecheck
- `npm run build` — production build
- `npm run lint` — oxlint
- `npm run test` — unit tests (vitest)
- For any change to interaction/rendering code (drag, placement, canvas), verify it in a real browser (e.g. Playwright against `npm run dev`) rather than trusting the build alone — this is a gesture-heavy canvas app where type-correct code can still be visually wrong.

## Architecture: keep logic out of the app

The code is layered; see the README for the full map. In short: `src/data` (static
reference data) ← `src/core` (the headless engine: rules, plan state machine, file
format) ← `src/app` (React UI and browser bindings). A planned `src/api` layer will sit
between `core` and `app`. Dependencies only point one way, and it's enforced:
`.oxlintrc.json` forbids `data` importing `core`/`app` and `core` importing `app`, and
`tsconfig.core.json` typechecks `data` and `core` without the DOM lib, so browser APIs
fail `npx tsc -b --noEmit` there.

Components (`src/app/components/`) should be thin: rendering, gesture wiring, and
calling into pure functions. They should not contain the actual rules — spacing math,
date math, placement geometry, state transitions. That logic belongs in `src/core/` and
`src/data/`, as plain functions with no React or DOM dependency, so it can run and be
verified in Node without a browser.

Concretely:

- **`src/core/reducer.ts`** — the `GardenPlan` state machine (`reducer`) and plan
  (de)serialization (`parsePlan`). This is the app's "controller": every rule about
  how an action changes the plan lives here, not in `src/app/state/gardenStore.tsx`
  (which is only the React binding — context, `useReducer`, and the `localStorage`
  side effect) or in the components that call `dispatch`. `gardenFile.ts` is the
  export/load file format.
- **`src/core/`** (the rest) — pure computations: `spacing.ts` (overlap/fit rules),
  `dates.ts`/`calendar.ts` (planting/harvest scheduling), `geometry.ts` (patch bounding
  boxes, multiply-drag ghost placement), `layout.ts` (bed geometry: frames, resize,
  relocating plants, cloning), `geoZone.ts` (lat→zone fallback mapping),
  `zoneMap.ts`/`usdaZones.ts` (point-in-polygon lookup against the bundled USDA zone
  map), `location.ts` (lat/lng validation and normalization).
- **`src/data/`** — static, codified reference data (crops, zones) plus small
  accessors.
- **`src/app/`** — everything client-specific: components, the React/`localStorage`
  stores (`app/state/`), editor interaction math that only makes sense with a pointer
  and a screen (`layoutInteraction.ts` snapping/guides, `viewport.ts` zoom and pan),
  and thin wrappers over browser services (`geolocation.ts`, `geocode.ts`'s `fetch`).
  Interaction math is still pure and unit-tested, it just isn't engine logic.

When you add a new interaction that implies a rule (a new gesture, a new kind of
spacing/placement/scheduling logic), write the rule as a pure, exported function in
`core/` (or `data/`) first, with unit tests, and have the component call it — don't
inline the computation in the component. If you find yourself writing `Math.` or date
arithmetic directly inside a component, stop and extract it.

## Testing conventions

Tests run on [vitest](https://vitest.dev) (`npm run test`, or `npm run test:watch`
while iterating), colocated with their source as `<name>.test.ts` next to `<name>.ts`.
There is no DOM/jsdom environment configured — tests run in plain Node, which is
sufficient for everything in `core/`, `data/`, and the pure parts of `app/` and keeps the
suite fast. If component-level (DOM) testing is ever needed, add `jsdom` and
`@testing-library/react` rather than reaching for Playwright for anything that
doesn't need a real browser.

Every module under `src/core/` and `src/data/` should have
a test file. At minimum, cover:

- **Boundary conditions**, not just the happy path — e.g. a plant exactly at the
  required spacing gap (not overlapping) vs. one unit inside it; a placement flush
  with the bed edge vs. one unit past it. Off-by-one and `<` vs `<=` bugs are the
  actual risk in this codebase's geometry and spacing rules.
- **Every reducer action**, asserting it only changes what it should touch and
  leaves everything else (and the previous state object) untouched.
- **Malformed/unexpected input** for anything that crosses a boundary (parsing
  stored JSON, an unknown crop id) — assert the documented fallback/throw behavior
  rather than leaving it implicit.
- **Data integrity** for static tables in `src/data/` (e.g. unique crop ids, every
  crop having the fields its sow method requires) so a bad hand-edit to `crops.ts`
  or `zones.ts` fails a test instead of shipping silently.

Do not add tests that duplicate what TypeScript already guarantees (e.g. "returns a
number"). Prefer a few precise boundary-condition tests over many superficial ones.

## Working with pull requests

1. **Add screenshots.** For any PR that changes visible behavior, capture screenshots of the feature (before/after or the key states — e.g. a live-drag frame and a committed frame) and commit them to `docs/screenshots/<branch-name>/`, one subfolder per branch so images from different PRs never collide. Embed them in the PR body as a markdown table using `raw.githubusercontent.com/<owner>/<repo>/<branch>/<path>` links (GitHub's REST API has no endpoint for the web UI's drag-and-drop image upload, so this is the way to get images into a PR body via the API). Skip this for changes with nothing visual to show (docs, config, refactors).
   Every PR also gets a live preview at `https://pz.github.io/garden-planner/pr-preview/pr-<number>/` (`.github/workflows/pr-preview.yml` posts the link on the PR and deletes the preview when the PR is merged or closed). Previews keep their saved gardens separate from the live site's (`src/app/state/storageNamespace.ts`).
2. **Wait for and respond to reviews.** After opening a PR, subscribe to its activity so review comments, requested changes, and CI results come back automatically. Address small, local review asks (nits, a tightened margin, a removed stale asset) by pushing a fix directly and replying with what changed. Treat anything larger or more ambiguous (architecture, API shape, scope) as a proposal to put back to the reviewer, not something to push unilaterally.
3. **Merge once approved.** An approval (with CI green, if CI is ever added) is authorization to merge — no need to ask again before merging. Cancel any scheduled PR check-in once it's merged or closed.
