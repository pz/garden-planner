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
| 3. Greedy solve, end to end (fill) | done: `normalize`, `allocate`, `evaluator`, `greedy`, `emit`, `verify`, `results`, `solve`, the CLI and `check.ts` |
| 4. Scoring and local search | done: `pairRules`, the remaining score terms, `anneal`, `--sweep` |
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
17. **Fixed plants never count toward a demand.** `placed`, a demand's `min`/`max` and the demand curve all count only plants the solver places or keeps (blocks). In adjust mode a demand means "the desired total", and the existing patches of that crop are blocks, so they are included; locked or non-grid patches are fixed and are not. This settles the doc's open question about whether the free area `A` and the count `n` use the same base.
18. **Allocation area is per crop.** A crop's `A` is the free area (bed area minus the growing rooms of fixed plants) of the beds it may use. `Σw` is over every demand that survived the filters. A crop asked for always gets a target of at least 1; whether even one fits is for the search to find out.
19. **Candidate blocks.** From each lattice anchor, for each width, the tallest block that satisfies the hard constraints, cut to land on the remaining count (rounded down, or up if that overshoots by at most one plant). Feasibility only shrinks as a block grows, so trying the tallest is enough. Candidates are tried best demand-gain first and the search stops when no remaining one can beat the best found, since every penalty only lowers a score.
20. **Greedy tie-breaks.** The doc says seeded random. Equal scores prefer the block nearest the bed's top-left corner (then the earlier bed), which packs far better, and only exact remaining ties use the seeded random choice. Annealing (milestone 4) supplies the diversity.
21. **A block must gain more than `MIN_GAIN` (1e-9) to be added.** So the greedy pass never adds a block whose crowding or spill costs more than it earns, even below the target.
22. **No `iterations`/timing in the greedy result yet, and no clock in `solve`.** Timing is measured by the CLI, so `solve` stays deterministic. The season check takes `options.year` (default: this year); tests and the CLI pass 2026.
23. **Season fixture.** In the zone table, a watermelon (transplant 1 week after the last frost, 80 days) still ripens in zone 3 (Aug 25 against a Sep 1 frost), so `fill-short-season` uses an artichoke (150 days) for the "too short" case and keeps the watermelon as a control.
24. **A tiny bed is not "no room".** The doc lets a plant's growing room spill past the bed edge as long as its center is inside, so a 24 in bed always takes one squash. `insufficient_space` therefore comes from fixed plants crowding a spot out (see `solve.test.ts`), and `fill-tiny-bed` now expects one squash, one tomato and radishes for the rest.
25. **Pending scenarios.** `scenarios.test.ts` lists the scenarios that need a later milestone (shade terms, adjust and replace) with `it.skip` and the reason; each milestone removes its entries.
26. **Pair terms are recomputed on removal.** A pair is counted when its later block is added, so removing the earlier block must also take out the pairs it has with blocks added since. `Evaluator.remove` therefore recomputes the group's contribution against what is left instead of replaying what it stored. `search.test.ts` checks the running totals against a fresh evaluator after random adds and removes, and `previewAdd` against `add`.
27. **Shade and companion rules are the core rules, vectorised by patch.** `pairRules.ts` repeats `findShadeConflicts` and `findCompanionConflicts` per pair of patches with a bounding-box prefilter, and `consistency.test.ts` checks both against core on 200 random gardens with turned beds and any north (including a southern latitude). Shade is charged per plant of the shaded patch; companion per pair, 1 for extension evidence and 0.5 for anecdotal.
28. **"Downstream" in the doc means where the shadow ends up.** Shadows fall toward north in the northern hemisphere, so tall crops belong on the north side of a bed or garden, where nothing lies ahead of them. `search.test.ts` checks that on `north-row` and `north-row-east` the tall corn ends up with no shade conflict at all, whichever way north points.
29. **Annealing.** Geometric cooling from `T_START` 0.05 to `T_END` 0.0005 (a plant is worth 0.02 to 0.15). Moves, with probabilities: translate 0.35, grow/shrink 0.2, swap 0.1, relocate to another bed 0.1, delete 0.1, add a block for an under-target crop 0.15. A move that breaks a hard constraint is undone before it counts. The best state seen is kept and restored at the end, so the result never scores below the greedy start.
30. **First-guess weights** (all in `scoring.ts`): spacing 0.05 per unit of pair penalty, shade 0.08 per shaded plant, companion 0.3 per pair, clustering 0.1 per extra block, spill 0.04 per plant, sun 0.02 per full-sun plant in part shade, change 2 (milestone 5), BIG 1000. A median over 20 seeds of the score with search beats greedy alone by 0.01 to 0.15 on 11 of 15 scenarios, and ties on the rest, where the greedy pass is already best (`npm run solve -- --sweep`). The doc says "beats greedy on every scenario"; a tie on a scenario the greedy pass already solves optimally cannot be beaten, so the tests require a strict win on the scenarios that leave room and "never worse" everywhere. They have not been tuned further yet.
31. **Capacity is physical.** For "would it fit alone" (the `outcompeted` / `limited_by_bed_restriction` / `insufficient_space` reasons) `results.ts` repeatedly takes the largest block that satisfies the hard constraints, ignoring every soft cost. Using the real objective made a crop look as if it had no room when the search had merely chosen not to plant its last plants. A full-sun crop that falls short in a part-shade garden gets `insufficient_sun` instead of `outcompeted`.
32. **Performance.** 3000 iterations on `two-raised-beds` take about 150 ms in Node (the target was 300 ms); the unit test allows 1.5 s so a slow CI machine does not make it flaky. The greedy pass on the four-bed `odd-shapes` takes about half a second, dominated by candidate enumeration over several hundred anchors per bed.
