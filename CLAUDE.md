# Garden Planner

A client-only React + TypeScript (Vite) app for planning a vegetable garden bed — see the project brief for product context. State lives in `localStorage`; there is no backend yet.

## Before pushing

- `npx tsc -b --noEmit` — typecheck
- `npm run build` — production build
- `npm run lint` — oxlint
- For any change to interaction/rendering code (drag, placement, canvas), verify it in a real browser (e.g. Playwright against `npm run dev`) rather than trusting the build alone — this is a gesture-heavy canvas app where type-correct code can still be visually wrong.

## Working with pull requests

1. **Add screenshots.** For any PR that changes visible behavior, capture screenshots of the feature (before/after or the key states — e.g. a live-drag frame and a committed frame) and commit them to `docs/screenshots/<branch-name>/`, one subfolder per branch so images from different PRs never collide. Embed them in the PR body as a markdown table using `raw.githubusercontent.com/<owner>/<repo>/<branch>/<path>` links (GitHub's REST API has no endpoint for the web UI's drag-and-drop image upload, so this is the way to get images into a PR body via the API). Skip this for changes with nothing visual to show (docs, config, refactors).
2. **Wait for and respond to reviews.** After opening a PR, subscribe to its activity so review comments, requested changes, and CI results come back automatically. Address small, local review asks (nits, a tightened margin, a removed stale asset) by pushing a fix directly and replying with what changed. Treat anything larger or more ambiguous (architecture, API shape, scope) as a proposal to put back to the reviewer, not something to push unilaterally.
3. **Merge once approved.** An approval (with CI green, if CI is ever added) is authorization to merge — no need to ask again before merging. Cancel any scheduled PR check-in once it's merged or closed.
