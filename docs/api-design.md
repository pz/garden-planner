# Garden Planting API — design

Status: **proposal, no code yet.** Step 1 of 2 (API shape). Step 2 (infra and auth) is sketched at the end.

Goal: every edit to a garden goes through one API, so an AI agent can read and edit plantings with the same rules the UI uses. We dogfood it in the client first and open it to third parties later.

## 1. Principles

1. **One command layer is the only way to change a plan.** A pure `src/api/` module exposes `applyCommands(plan, commands, options) → Result`. It has no React, DOM or transport. The UI, a future HTTP server and a future MCP server all call it. The rules live in `src/utils/`, as `CLAUDE.md` requires; the API validates by calling them.
2. **The wire format is the file format.** The API speaks the same `GardenPlan` v3 JSON that Export garden writes and Load garden reads (`src/state/gardenFile.ts`). See section 2. Nothing is renamed, so existing exports keep loading.
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
- a coarse text grid in the bed's local frame, at `cellIn` resolution (default `LAYOUT_SNAP_IN`, 6 in): `#` outside the outline, `.` free, a letter per crop;
- a free-space fraction.

Free-rectangle extraction is decided at implementation. `placements:suggest` is deferred.

## 5. Writes

```
POST /v1/gardens/{g}/commands
{ "ifRev": "…", "idempotencyKey": "…", "dryRun": false, "commands": [ … ] }
```

| Command | Fields | Notes |
|---|---|---|
| `addPlant` | `ref?, bedId, cropId, x, y, variety?` | |
| `addPatch` | `ref?, bedId, cropId, (points[] \| grid), variety?, clip?` | `grid` is `{origin, axis:"x"\|"y", cols, rows}` with `computeGhosts` semantics. `clip: true` silently drops points outside the bed and reports them as `skipped`; the default is an error. |
| `removePlant` | `id` | |
| `removePatch` | `groupId` | |
| `movePatch` | `groupId, dx, dy` | Rigid translation within the same bed. Cross-bed moves are remove plus add for now. |
| `setVariety` | `id, variety` | |
| `dismissWarning` / `restoreWarning` | `id` | |

Rules:

- **Atomic.** All commands in a batch apply or none do. Later commands see earlier ones, and `ref` names objects created earlier in the batch.
- **All errors reported, not just the first.** Each has a `commandIndex`.
- **`dryRun`** returns exactly what would happen (results, introduced warnings, errors) without committing.
- **Concurrency and retries.** `ifRev` mismatch returns 409 `stale_revision`. Replaying an `idempotencyKey` returns the original result.
- **Convenience routes** (`POST /plants`, `DELETE /plants/{id}`, `POST /patches`) are one-command wrappers over the same path.
- **Ids** are server-assigned UUIDs, the same scheme the UI uses today.

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

- `unknown_crop`
- `unknown_bed`
- `unknown_id`
- `outside_bed`: the center is not inside the bed's outline, which covers rect, rounded corners, ellipse and polygon, via `isInsideOutline`.
- `duplicate_ref`
- `invalid_grid`
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
5. Add the crop reference data, and the shade and companion warnings.
6. Later: HTTP and MCP adapters, generated from the OpenAPI and JSON Schema source of truth.

## 8. Open questions

1. **Layout edits.** The UI also edits beds (`addBed`, `moveBed`, `reshapeBed`, `rotateBed`, `pasteBed`, `removeBed`, `restoreLayout`). To make *all* edits go through the API, these join the same command union, but agent tokens can't use them in v1 (planting only). Confirm?
2. **`northDeg`** is garden-level. Per-bed orientation isn't needed unless you plan curved or terraced layouts.
3. **Revision token.** A content hash for now (nothing stored); a server counter later. Both are opaque to clients.

## 9. Step 2 (not yet designed): infra and auth

- A small stateless service importing the same `applyCommands`, with plans stored as the same JSON; `rev` becomes a column for optimistic concurrency.
- Scoped, revocable agent tokens: `garden:read`, `garden:write`, `garden:dismiss`, `layout:write`, each limited to a garden. OAuth for third parties later.
- Hold back dismissal and layout scopes from agents by default.
- Rate limits, an `actor` on every revision (audit log), undo via revision history (`restoreLayout` is a precedent).
- Migrating localStorage-only gardens to server-held ones, using the import endpoint.
