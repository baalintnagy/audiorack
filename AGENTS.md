# Source style

Follows the conventions of the sibling PermaFormula projects, applied to TypeScript:

- Use Prettier (`.prettierrc.json`): four-space indentation, 100-column width, single quotes,
  trailing commas, LF endings. Two spaces in `.yml`/`.yaml`. Run `npm run format` before
  committing; CI runs `npm run format:check`.
- Always use braces for conditional and loop bodies.
- Use `_` for unused exception variables in catch clauses (or omit the binding).
- Prefer collection operations (`map`, `filter`, `reduce`, …) over loops when no extra mutable
  state is needed. Keep explicit loops in per-sample DSP code and other stateful or
  performance-sensitive paths.
- Put arguments containing function calls, constructor calls or lambdas on separate
  continuation lines when a call has to wrap.
- Keep TypeScript strict and free of compiler warnings (`npm run check`).
- Apply these conventions to maintained sources, not generated output (`dist/`, `release/`,
  `public/icons/`) or lockfiles.

# Architecture decisions

- DSP lives in `src/dsp` as host-independent kernels that process stereo blocks in place and
  allocate only on parameter or block-size changes. Cover behavior with Vitest tests.
- The whole chain runs in a single AudioWorklet (`src/engine/worklet.ts`); reordering or
  bypassing never rewires the Web Audio graph.
- Rack state from storage, presets or imported files is untrusted: pass it through
  `normalizeRack` before use. When an effect type is renamed, add its old name to
  `LEGACY_EFFECT_TYPES` in `src/shared/normalize.ts` and keep it there: stored racks and
  exported files may carry the old name indefinitely.
- The chain is a tree: `ChainItem` is an effect or a parallel group whose branches hold effects
  only (no nesting). Edit it through the pure helpers in `src/shared/chain.ts`. The DSP mirrors it
  with `Stage` implementations built by `StagePool`, which reuses stages by id; bypass and
  parallel branches compensate latency so timing never changes when toggling.
- Tabs get their own rack by default (`resolveTabRack`): a copy of the shared rack in
  `chrome.storage.session` under `tabRack:<tabId>`, removed when the tab closes. A tab switched
  to the shared rack (`chrome.storage.local`) is marked with `tabScope:<tabId>`. Rack
  messages to the offscreen document carry the tab and its scope.
- The offscreen document only has `chrome.runtime`; it receives rack updates by message and
  never reads storage directly.
- Releases go through `.github/workflows/release.yml` (Chrome Web Store API v2). Do not publish
  manually from a developer machine except for the first listing.
