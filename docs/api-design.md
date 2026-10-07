# Garden Planting API — design

Status: **proposal, no code yet.** Step 1 of 2 (API shape). Step 2 (infra and auth) is sketched at the end.

Goal: every edit to a garden goes through one API, so an AI agent can read and edit plantings with the same rules the UI uses. We dogfood it in the client first and open it to third parties later.

## 1. Principles

1. **One command layer is the only way to change a plan.** A pure `src/api/` module exposes `applyCommands(plan, commands, options) → Result`. It has no React, DOM or transport. The UI, a future HTTP server and a future MCP server all call it. The rules live in `src/core/` and `src/data/`, as `CLAUDE.md` requires; the API validates by calling them.
2. **The wire format is the file format.** The API speaks the same `GardenPlan` v3 JSON that Export garden writes and Load garden reads (`src/core/gardenFile.ts`). See section 2. Nothing is renamed, so existing exports keep loading.
3. **The client talks to an async `GardenApi` interface.** `LocalGardenApi` (localStorage) comes first; `HttpGardenApi` later. The UI doesn't change when we swap them.
4. **Per-frame drag previews stay synchronous.** They call the pure geometry functions directly. Commits and explicit validation go through the API.
5. **Warnings are derived, never stored.** The only stored state is dismissals.

## 2. Data format: consistent with export/load

The canonical document is `GardenPlan` (`version: 3`). Export wraps it:

```jsonc
{ "format": "garden-planner-export", "formatVersion": 1,
  "meta": { "commit": "…", "exportedAt": "…" },
  "plan": { "version": 3, "id", "name", "profile", "beds": [...], "plants": [...], "dismissedConflictKeys": [...] } }
```

The API follows these rules:

- **Same field names and units as the plan.** Plants are `{id, bedId, cropId, x, y, variety?, groupId}`. Beds are the `Bed` type as stored (`shape`, `cx`, `cy`, `widthIn`, `heightIn`, `rotationDeg`, `points?`, `cornerRadiusIn?`). Plant `x`/`y` are inches in the bed's own **unrotated, bed-local frame**, exactly as stored.
- **`groupId` is the patch id.** The API's patch resource is `{groupId, bedId, cropId, plantIds[], bounds}`. Nothing is renamed, so there is no plan version bump and no migration. A solo plant is a patch of 1.
- **Resources are projections of one plan.** `GET /gardens/{g}` returns the plan without `plants` and the dismissal lists, which have their own sub-resources. Both are available inline with `?expand=plants,dismissed`. Concatenated, the projections equal the plan.
- **Round trip.** `GET /gardens/{g}/export` returns a `GardenFile` byte-compatible with the Export button, with `meta.commit` set to the server build. `POST /v1/gardens:import` accepts a `GardenFile` or a bare plan, as `parseGardenFile` does, and creates a new garden with a fresh id (as the UI does). v2 files migrate through `parsePlan`, so the API only ever speaks v3.
- **One validator.** `planProblem` in `gardenFile.ts` is refactored into a shared `validatePlan(plan) → ApiError[]`. Import reports its errors with the same codes and `path`s as command validation: `unknown_crop`, `unknown_bed`, `invalid_garden_file`. The existing human-readable messages are preserved.
- **Additive, optional new fields only.** None of these bump `version` or `formatVersion`, and older builds ignore them:
  - `plan.northDeg?: number`, the compass direction of garden-up (default 0). It is garden-level because beds are placed in garden coordinates. Shade needs it.
  - `plan.dismissedWarnings?: string[]`, the full warning ids of dismissed shade and companion warnings.
  - `dismissedConflictKeys` keeps its meaning and format (sorted `a::b` groupId pairs, spacing only).
- **Bed-local coordinates, deliberately.** Plants are stored relative to their bed, not in absolute garden coordinates, so `moveBed` and `rotateBed` change only the bed and never touch plants. The API converts to garden coordinates (`bedToGarden`) only for derived things such as cross-bed shade. Nesting plants under beds and locking beds that have plants were considered and rejected: nesting is a format change with no new information, and locking would break resizing in the layout editor.
- **Commands that remove plants say so.** `reshapeBed` re-expresses plants so they keep their place in the garden, and drops those the new shape no longer contains. `removeBed` drops the bed's plants. Both report `removed: [{id, groupId, reason}]` (reason `outside_bed` or `bed_removed`) in their result, and support `dryRun` so the confirm dialog (and any later caller) can see the consequences first.
- **Not in the file.** The revision token is derived from the content (a hash), so nothing new is stored or exported. Crop data lives in `crops.json`, and files reference crops by id as today.

## 3. Resources

| Resource | Notes |
|---|---|
| `garden` | `id, name, profile, northDeg?, beds[]` plus a `rev` token |
| `bed` | As stored. Read-only for agents in v1 (see section 8.1). |
| `plant` | `{id, bedId, cropId, x, y, variety?, groupId}` |
| `patch` | `{groupId, bedId, cropId, plantIds[], bounds}`, derived from plants |
| `warning` | Derived, with a stable id (section 6) |
| `crop` | The read-only catalog, including the new reference fields in section 6 |

Versioning: `/v1/…`. Units are inches, y points down, and all plant coordinates are bed-local.

## 4. Reads

```
GET /v1/gardens                                      list
GET /v1/gardens/{g}            ?expand=plants,dismissed
GET /v1/gardens/{g}/export                           GardenFile
GET /v1/gardens/{g}/plants     ?bedId=&cropId=&groupId=
GET /v1/gardens/{g}/patches    ?bedId=
GET /v1/gardens/{g}/warnings   ?kind=&severity=&bedId=&subject=&includeDismissed=
GET /v1/gardens/{g}/layout     ?bedId=&cellIn=6
GET /v1/crops    GET /v1/crops/{id}
```

**`layout`** exists because LLMs reason poorly over raw coordinates. For each bed it returns:

- its garden placement and outline;
- bounds and a legend per patch;
- a coarse text grid in the bed's own (unrotated) frame, at `cellIn` resolution (default 6 in; a `cellIn` that makes more than 10,000 cells is rejected): `#` where the middle of the cell is outside the bed's shape, `.` free, a capital letter where a plant's center is, a lowercase letter where a plant's growing room (radius of half its spacing) covers the cell; the response carries a legend from letter to crop id;
- a free-space fraction (free cells over cells inside the shape).

Free-rectangle extraction was left out: the grid and fraction carry the same information for now. `placements:suggest` is deferred. Implemented as `readLayout` in `src/api/layoutView.ts`.

## 5. Writes

```
POST /v1/gardens/{g}/commands
{ "ifRev": "…", "idempotencyKey": "…", "dryRun": false, "commands": [ … ] }
```

| Command | Fields | Notes |
|---|---|---|
| `addPlant` | `ref?, id?, groupId?, bedId, cropId, x, y, variety?` | `id` and `groupId` are normally generated; supply them to restore a removed plant under its old identity. A supplied `groupId` that already exists joins that patch, if it has the same bed and crop. |
| `addPatch` | `ref?, groupId?, bedId, cropId, (points[] \| grid), variety?, clip?` | Exactly one of `points` and `grid`. `grid` is `{origin, axis:"x"\|"y", columns, rows}`: a block of `columns × rows` plants at the crop's spacing, including the origin, growing in the positive directions (axis `x`: columns run right, rows step down; axis `y`: columns run down, rows step right); at most 1000 plants. `clip: true` drops points outside the bed and reports them as `skipped`; the default is an error. |
| `removePlant` | `id` | |
| `removePatch` | `groupId` | |
| `movePatch` | `groupId, dx, dy` | Rigid translation within the same bed. Cross-bed moves are remove plus add for now. |
| `setVariety` | `id, variety` | `variety: null` clears it. |
| `dismissWarning` / `restoreWarning` | `id` | |

Rules:

- **Atomic.** All commands in a batch apply or none do. Later commands see earlier ones. `ref` names an object a command creates; later commands refer to it as `"$name"` in an id field (`id`, `groupId`). A `$ref` to a plant works wherever a plant id does; a `$ref` to a patch works wherever a `groupId` does. A command that fails keeps its ref claimed, so commands that depend on it are skipped without piling on extra errors.
- **Unknown or misspelt fields are rejected** (`invalid_command`), not ignored, so an agent's typo is reported instead of silently changing nothing.
- **All errors reported, not just the first.** Each has a `commandIndex`.
- **`dryRun`** returns exactly what would happen (results, introduced warnings, errors) without committing.
- **Concurrency and retries.** `ifRev` mismatch returns 409 `stale_revision`. Replaying an `idempotencyKey` returns the original result.
- **Convenience routes** (`POST /plants`, `DELETE /plants/{id}`, `POST /patches`) are one-command wrappers over the same path.
- **Ids** are generated (UUIDs, the same scheme the UI uses today) unless the command supplies one; a supplied id that is already taken is a `duplicate_id` error. The generator is injected into `applyCommands`, so tests and simulations are deterministic.

### Response

```jsonc
{ "rev": "…",
  "results": [{ "ref": "r1", "plantIds": ["p9"], "groupId": "g4", "skipped": [] }],
  "warnings": { "introduced": [ … ], "resolved": [ … ], "unchanged": 3 } }
```

Warnings are computed on the post-state and diffed against the pre-state.

### Mapping to the reducer

Commands are the public, validated layer. The existing reducer actions stay as the internal state transitions that a successful command resolves to:

| Command | Reducer action |
|---|---|
| `addPlant`, `addPatch` | `addPlants` |
| `movePatch` | `moveGroup` |
| `removePlant` | `removePlant` |
| `removePatch` | `removeGroup` |
| `setVariety` | `setVariety` |
| `dismissWarning` | `dismissConflictsForGroup` (generalized) |

## 6. Errors and warnings

### Errors (command rejected, nothing applied; HTTP 422, or 409 for a stale `rev`)

```jsonc
{ "code": "outside_bed", "commandIndex": 2, "path": "/commands/2/points/4",
  "message": "Plant center (101, 20) is outside bed 'Bed 1' (rect 96×48 in).",
  "details": { "bedId": "bed-1", "point": {…} },
  "suggestion": { "nearestValidPoint": {"x":96,"y":20} } }   // from clampToOutline
```

Codes:

- `invalid_command`: the request isn't a well-formed batch (checked by `parseRequest` before any garden is consulted).
- `unknown_crop`
- `unknown_bed`
- `unknown_id`: also for a `$ref` no earlier command defined, a `$ref` to a patch where a plant is needed, and a warning id that doesn't exist.
- `outside_bed`: the center is not inside the bed's outline, which covers rect, rounded corners, ellipse and polygon, via `isInsideOutline`. For `movePatch` the error carries the furthest valid move as `suggestion: {dx, dy}`. At most 20 points are listed per command, then one more error counts the rest.
- `duplicate_ref`
- `duplicate_id`
- `invalid_grid`: columns or rows not a whole number of at least 1, or more than 1000 plants.
- `empty_patch`: no points, or `clip` dropped them all.
- `stale_revision`
- `invalid_garden_file`

Spacing is warn-only, so there is no "too close" error.

### Warnings (accepted; reported and readable later)

```jsonc
{ "id": "spacing:g1::g4", "kind": "spacing|shade|companion",
  "severity": "caution|problem", "bedId": "bed-1", "subjects": ["g1","g4"],
  "message": "…", "dismissed": false, "suggestion": "move g4 ≥ 7 in east" }
```

- **spacing.** This is today's `findOverlapConflicts`, unchanged: same bed only, with groupId pairs and a gap below the average of the two crops' spacing. The id is `spacing:` plus the existing `conflictKey`, so existing dismissals map one-to-one. The old UI refusal band (below 0.7 of the average gap, the `fitsAt` rule) becomes `severity: "problem"`. The UI can keep its own placement refusal as a gesture-level affordance.
- **shade.** A taller crop on the sun side of a shorter, sun-needing crop. It works across beds, using `bedToGarden` for garden coordinates. The sun side comes from `profile.location` (hemisphere; northern if absent) and `plan.northDeg`.
- **companion.** Antagonist pairs, and mismatched water or fertilizer needs among neighbors in the same bed.

New `crops.json` fields, hand-curated and never LLM-generated, with data-integrity tests: `heightIn`, `sunNeed`, `water: low|med|high`, `feeder: light|heavy|fixer`, `companions[]`, `antagonists[]` (each with a reason).

**Dismissal.** Spacing dismissals keep using `dismissedConflictKeys`, and shade and companion dismissals use `dismissedWarnings`. As today, a dismissal persists while the pair exists.

## 7. Dogfooding in the client

1. Add `src/api/` (commands, validation, warnings, `layout`) with unit tests, as pure functions.
2. Add a `GardenApi` interface and `LocalGardenApi`; `gardenStore.tsx` calls it instead of `dispatch`.
3. Move the UI's commits onto commands. Live ghosts and drags keep using the pure functions.
4. Refactor `planProblem` into the shared `validatePlan`, and add the `northDeg` and `dismissedWarnings` fields to the types and `parsePlan`.
5. **Mock API for client tests.** In the same PR, add a mock `GardenApi` (scripted responses, injectable errors and warnings, recorded calls) so the client can be tested without the real command layer, and Playwright tests that run the UI against it (e.g. an `outside_bed` error shows up as the right message; introduced warnings render; a stale `rev` is handled). The store takes its `GardenApi` by injection, with the real local implementation as the default.
6. Add the crop reference data, and the shade and companion warnings.
7. Later: HTTP and MCP adapters, generated from the OpenAPI and JSON Schema source of truth.

## 8. Decisions

1. **Layout edits.** Bed commands (`addBed`, `moveBed`, `reshapeBed`, `rotateBed`, `pasteBed`, `removeBed`, `restoreLayout`) join the same command union so the UI's edits all go through the API, but agent tokens are limited to planting commands for now.
2. **`northDeg`** is garden-level.
3. **Revision token.** A content hash for now (nothing stored); a server counter later. Both are opaque to clients.

4. **History is deferred to step 2.** Only the reduced plan is stored and exported, as today; commands are applied and discarded. A revision log (rev, actor, timestamp, commands, snapshot or inverse) beside the plan, giving audit and undo for agent edits, is decided with the server design. It stays out of export files by default. The existing layout-editor undo (in-memory snapshots) is unchanged. The command format already carries `ref`, `idempotencyKey` and `dryRun`, so it can be logged later without a redesign.

## 9. Step 2 (not yet designed): infra and auth

- A small stateless service importing the same `applyCommands`, with plans stored as the same JSON; `rev` becomes a column for optimistic concurrency.
- Scoped, revocable agent tokens: `garden:read`, `garden:write`, `garden:dismiss`, `layout:write`, each limited to a garden. OAuth for third parties later.
- Hold back dismissal and layout scopes from agents by default.
- Rate limits, an `actor` on every revision (audit log), undo via revision history (`restoreLayout` is a precedent).
- Migrating localStorage-only gardens to server-held ones, using the import endpoint.
