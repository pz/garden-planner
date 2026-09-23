# `src/data/`

Static, codified reference data — never LLM-generated, never user-editable at
runtime. `crops.ts` and `zones.ts` are thin accessors (`getCrop`, `getZone`,
`zoneLastFrostDate`, `zoneFirstFrostDate`) over this data; nothing outside this
folder should import `crops.json` directly. `tips.ts` (`getTip`) does the same
for `tips.json`.

## `crops.json`

An array of crop definitions. Each entry matches the `CropDef` type in
[`src/types.ts`](../types.ts), which is the source of truth for field types —
this doc explains what each field *means*.

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | string | Stable identifier. Referenced by `PlantInstance.cropId` in saved plans — **never rename or remove an id**; add a new crop instead, or a garden someone already planted will fail to look it up (`getCrop` throws on an unknown id). |
| `name` | string | Display name. |
| `family` | one of `"fruiting" \| "brassica" \| "root" \| "allium" \| "legume" \| "leafy" \| "cucurbit" \| "herb"` | Drives the flat family glyph in `PlantMark`. Must be one of `CropFamily` in `types.ts`. |
| `spacingIn` | number > 0 | Minimum center-to-center spacing between plants of this crop, in inches. Used for overlap/fit checks (`utils/spacing.ts`). |
| `defaultPatch` | boolean | Whether this crop is normally grown as a multi-plant patch (affects UI defaults, not scheduling). |
| `sowMethod` | `"transplant" \| "direct-sow"` | Which planting-schedule fields below apply — see next row. |
| `startIndoorsWeeksBeforeLastFrost` | number (weeks) | **Transplant crops only.** Weeks before the zone's last frost to start seeds indoors. |
| `transplantWeeksAfterLastFrost` | number (weeks, may be negative) | **Transplant crops only.** Weeks after last frost it's safe to move outside; negative means before last frost (e.g. a frost-tolerant crop). |
| `directSowWeeksRelativeToLastFrost` | number (weeks, may be negative) | **Direct-sow crops only.** Weeks relative to last frost to sow outside; negative means before last frost. |
| `daysToMaturity` | number > 0 | Days from sowing/transplanting outside to first harvest. |

A `transplant` crop must set `startIndoorsWeeksBeforeLastFrost` (and normally
`transplantWeeksAfterLastFrost`); a `direct-sow` crop must set
`directSowWeeksRelativeToLastFrost`. `utils/dates.ts#scheduleFor` defaults a
missing offset to `0` rather than failing, but omitting it is a data bug, not
a supported shorthand — `crops.test.ts` asserts every crop sets the offset its
`sowMethod` requires, so a bad hand-edit fails a test rather than shipping
silently.

### Adding a crop

Append an entry to `crops.json` with a new, unique `id`, and add its tip to
`tips.json` under the same id. No code changes are
needed — `CROPS` in `crops.ts` is just the parsed JSON, typed as `CropDef[]`.
Run `npm run test` afterward; `crops.test.ts` checks id uniqueness, that each
crop's `sowMethod`-specific offset is present, and that `spacingIn` /
`daysToMaturity` are positive; `tips.test.ts` checks the crop has a tip.

## `tips.json`

The per-crop growing tips shown on the plant info card, kept in their own file
so the wording can be reviewed and edited in one place without wading through
scheduling data. It's a single object mapping crop `id` → tip string:

```json
{
  "tomato": "Give it a stake or cage before it needs one — roots resent disturbance later.",
  "kale": "Tolerates a light frost — flavor sweetens after a cold snap."
}
```

Tips are short, human-written, and never LLM-generated. `tips.test.ts` asserts
every crop in `crops.json` has a non-blank tip and that every key matches an
existing crop id, so adding a crop without a tip — or a typo'd key — fails a
test. The UI tolerates a missing tip (`getTip` returns `undefined` and the card
just omits it), but that's a fallback, not a supported state.

Users can dismiss a tip from the info card; that preference is stored per crop
in `localStorage` (see `src/state/dismissedTips.ts`), shared across all gardens,
and reversible via the card's "Show growing tip" link.

## `zones.ts`

USDA hardiness zone data (average last/first frost dates) is small enough to
stay as a plain TypeScript array (`ZONES: ZoneInfo[]`) rather than JSON — it
changes far less often than crops and isn't a candidate for non-developer
editing the way crop data is.
