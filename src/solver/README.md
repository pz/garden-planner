# `src/solver/` — the planting solver

Turns a `PlantingSpec` plus a `GardenPlan` into a batch of API commands (`solve`), and a harness
to run it against fixture gardens. It is the engine behind the planned planting assistant, but has
no LLM in it. It sits between `src/api` and `src/app`: it may import `types`, `data`, `core` and
`api`; nothing in those layers may import it, and it must not import `app` (enforced in
`.oxlintrc.json`; `tsconfig.core.json` typechecks it without the DOM lib).

The design is the "Planting Solver & Test Harness — Design" doc. This README records what has
been built and every decision made while building it that the doc left open or changed.

## Status

| Milestone | State |
| --- | --- |
| 1. Scaffolding and spec | done: lint/tsconfig rules, `core/random.ts`, `tsx`, `spec.ts`, fixtures and loaders |
| 2. Geometry primitives | done: `block.ts`, `discIndex.ts`, `rules.ts`, `fastSpacing.ts` |
| 3. Greedy solve, end to end (fill) | not started |
| 4. Scoring and local search | not started |
| 5. Adjust and replace modes | not started |
| 6. Viewer (`#/solver`) | not started |

## Layout

- `spec.ts`: `PlantingSpec` and `parseSpec(raw, plan)`; the defaults (`DEFAULT_FILL_RATIO`, `DEFAULT_PREFS`).
- `scenario.ts`: the scenario file type and `parseScenario`.
- `catalog.ts`: the fixture registry plus `loadGarden` and `loadScenario`.
- `fixtures/{gardens,specs,scenarios}/`: plain JSON. A garden is the app's Export file, so a garden made in the app can be dropped in.
- `cli.node.ts`: `npm run solve -- --list | <scenario> | --all`.

## Decisions

Numbered so later milestones can refer to them.

1. **Integration branch.** Work happens on `planting-solver`; each milestone is a PR on its own branch (`solver-m<N>-…`) stacked on the previous one, and the stack is merged into `planting-solver` before it goes to `main`.
2. **Spec shape.** The doc's type block didn't survive, so the shape is ours: `{ mode, demands, scope?: { bedIds? }, locked?, exclude?, fillRatio?, prefs? }`. The scope is an object so it can grow (for example per-bed rules) without a breaking change.
3. **Spec validation.** `parseSpec` reports every error with a JSON pointer, in the API's `ApiError` shape. `invalid_command` is a bad shape or value, `unknown_crop` / `unknown_bed` an id that matches nothing, `unknown_id` a locked groupId that matches no patch. Beyond the doc: an empty `bedIds` list is an error (it would otherwise be read as "nowhere"), a crop demanded twice is an error, and a crop both demanded and excluded is an error. A demand's `bedIds` must lie inside the scope.
4. **Defaults.** `fillRatio` 0.85. Preferences run 0 to 1, defaulting to spacing 1, shade 1, companions 1, clustering 0.3, stability 0.5. All are first guesses, to be tuned with the sweep in milestone 4. `parseSpec` returns the spec as given; applying defaults is the solver's job.
5. **Scenario files are strict.** An unknown expectation kind or field fails the load, so a typo can't silently remove a check. Expectation names are as in the doc, with `warningKind` as the field that names the warning kind (the bare word `kind` is the expectation's own).
6. **Fixtures are imported by name, not globbed.** `catalog.ts` imports each JSON file explicitly. That works the same in Node, tsx, vitest and the app, and typechecks under `tsconfig.core.json` (no Vite types). `catalog.node.test.ts` fails if a file in `fixtures/` isn't registered. The viewer can switch to `import.meta.glob` later if it wants to.
7. **Node-only files.** Files named `*.node.ts` or `*.node.test.ts` may use Node APIs. `tsconfig.core.json` and `tsconfig.app.json` exclude them and `tsconfig.node.json` checks them. To let that config import the JSON fixtures, it now uses `module: esnext` with bundler resolution (it only covered the Vite/Vitest config files before).
8. **Garden fixtures.** The doc's "48×96 bed" is the app's default bed, which is 96 wide by 48 tall, so that is what `empty-4x8` uses. Three gardens beyond the six in the doc, which specs need: `north-row-east` (the doc's "northDeg 90 variant"), `short-season` (zone 3) and `custom-crop` (carries a user-made crop in the file's `customCrops`). Fixtures with a location use latitude 40 so the shade direction is defined.
9. **Custom crops are process-wide state.** `loadGarden` registers the garden file's custom crops with `data/crops` (replacing earlier ones), because `findCrop` reads from there. Specs are therefore validated after their garden loads. "Has no schedule" in the solver means `hasSchedule(crop) === false`, which already exists.
10. **Scenario expectations are provisional.** Milestone 1 only checks that scenarios load and validate. The expectations were written from the doc, before a solver exists, and may be tightened or corrected in milestones 3 to 5 when they first run.
11. **PRNG.** `mulberry32` moved to `src/core/random.ts` with tests (including a pinned value), and `api/simulation.test.ts` imports it.
12. **`HARD_SPACING_FACTOR`** already exists in `core/spacing.ts` (0.7); the solver will import it rather than define a second copy.
13. **Blocks are always axis `x`.** A `columns × rows` block on axis `y` is the same points as a `rows × columns` block on axis `x`, and the search tries every shape, so searching both axes would only duplicate candidates. `asBlock` also normalizes to `x`. The field stays in the type so a block round-trips to an `addPatch` grid.
14. **Rules mirror core exactly.** `rules.ts` uses the same distance formula (`sqrt(dx²+dy²)`), the same average-of-spacings gap and the same strict comparisons as `core/spacing.ts` and `api/warnings.ts`, so the solver and the warnings cannot disagree by a rounding error. The one deliberate difference: the hard limit is `HARD_SLACK_IN` (1e-9 in) conservative, so a placement exactly on the 0.7 line is refused rather than left to floating point.
15. **Grid tolerance.** `asBlock` accepts coordinates within 0.01 in of a grid line (what the UI's rounding can produce) and nothing looser. A patch that fails is fixed, never reshaped.
16. **Edge spill samples** are written out as eight exact offsets rather than computed with `cos`/`sin`, so a plant flush with a straight wall does not count the sample along the wall as outside (`cos(π/2)` is not exactly 0).
