# AGENTS.md

These instructions apply to the entire repository.

## Project purpose

Almost Gallery is a macOS Electron application built for the photo-ordering
workflow of `nicokaiser/hugo-theme-gallery`. The Hugo theme sorts images by
filename by default, so the app lets users arrange source photos visually and
exports ordered JPEGs named `000.jpg`, `001.jpg`, and so on.

Preserve these core guarantees:

- Source photos are never modified, renamed, or deleted.
- Exports are written to an `output` directory inside the selected album.
- Export order follows the current drag-and-drop grid order.
- Default ImageMagick settings remain resize `2000x2000` and quality `85` unless
  the product requirements explicitly change.
- A failed export leaves the previous output and manifest intact.
- `almost_gallery_output.json` stores manifest version `1`, source filenames in
  order, and the ImageMagick options used for export.

## Runtime architecture

The project uses CommonJS, plain HTML/CSS/JavaScript, and no renderer framework
or bundler.

- `src/main.js`: Electron lifecycle, native dialogs, IPC registration, and
  ImageMagick process execution.
- `src/preload.js`: the narrow `contextBridge` API exposed to the renderer.
- `src/renderer.js`: DOM behavior, drag and drop, thumbnail updates, options,
  export progress, and gallery preview.
- `src/ui-state.js`: pure UI-state helpers shared by the renderer and tests.
- `src/photo-exporter.js`: validation, ordered conversion, staging, atomic
  output replacement, progress, and manifest persistence.
- `src/thumbnail-service.js`: bounded-concurrency generation and reuse of 640px
  cached thumbnails.
- `src/manifest-store.js`: atomic manifest reads and writes.
- `src/album-state.js`: restoration of saved order and options.
- `src/export-utils.js`: supported formats, filenames, option validation, and
  manifest serialization.
- `src/image-magick.js`: ImageMagick discovery through an override, Homebrew
  locations, and `PATH`.
- `scripts/build-mac.js`: `.app`, `.zip`, and `.dmg` packaging.
- `scripts/create-icns.js`: native ICNS regeneration from `assets/icon.png`.

Keep Electron's security boundary intact:

- `contextIsolation` must remain enabled.
- `nodeIntegration` must remain disabled.
- The renderer must not access Node.js or the filesystem directly.
- Expose only narrowly scoped preload methods.
- Treat IPC payloads as untrusted and validate album paths and photo paths in
  the main process or service layer.

## Performance constraints

Grid cards must use cached thumbnails rather than decoding full-resolution
source photos. Full originals are appropriate only for the one-photo preview
and ImageMagick export.

- Keep thumbnail work outside the renderer and bounded to low concurrency.
- Preserve lazy loading, async image decoding, and offscreen rendering hints.
- Do not rebuild every grid card after a reorder; move/reuse existing DOM nodes.
- Cancel or ignore stale thumbnail work when another album is opened.
- Cache successful ImageMagick discovery.
- Avoid expensive full-window filters or animations that regress scrolling or
  preview navigation.

Thumbnail cache files belong under Electron's macOS cache directory, never in
the user's album. Cache identity must change when the source path, size, or
modification time changes. If thumbnail generation fails for one image, the UI
may fall back to that original without failing the entire album.

## Export and manifest invariants

The export workflow is intentionally transactional:

1. Validate the selected folder, every source path, and export options.
2. Convert all images into the hidden staging directory.
3. Replace the previous `output` directory only after all conversions succeed.
4. Write the manifest atomically after successful output replacement.
5. Remove temporary staging and backup directories.

Do not write directly over a working output set one image at a time. This would
leave stale or partially updated galleries after a failure.

When loading a manifest:

- Restore matching saved photos in their saved order.
- Ignore saved filenames that no longer exist.
- Append newly added photos in their normal folder order.
- Warn about malformed JSON without preventing the album from opening.

## Development commands

Requirements are Node.js 22.12 or newer, ImageMagick 7, and macOS for app
launching and packaging.

```sh
npm install       # install development dependencies
npm test          # run the complete Node test suite
npm start         # launch Electron locally
npm run icon      # regenerate icon.iconset and icon.icns
npm run dist      # build .app, .zip, and .dmg into dist/
npm audit         # query dependency advisories
```

Do not add a package when the platform or Node standard library already covers
the requirement. Both direct dependencies are development dependencies:
Electron runs the application and `@electron/packager` creates macOS bundles.

## Testing expectations

Use the built-in `node:test` runner and `node:assert/strict`. Tests live under
`test/` and should remain deterministic and independent of a user's photo
library.

- Use temporary directories for filesystem tests and remove them with
  `t.after()`.
- Inject fake `runMagick` functions rather than invoking ImageMagick in unit
  tests.
- Keep state transformations in testable pure helpers where practical.
- Test successful behavior, invalid paths/options, malformed state, and failure
  recovery.
- Changes to export behavior must test preservation of the previous output and
  manifest on failure.
- Changes to thumbnail behavior must test caching, invalidation, fallback, and
  album path validation.
- Changes to grid or preview behavior must update `ui-state` tests for ordering,
  boundaries, disabled controls, and open/close navigation.

Run `npm test` after every functional change. For preload, IPC, or renderer
wiring changes, also launch with `npm start`. For build or icon changes, run
`npm run dist` and inspect the resulting application bundle.

## Code style

- Use two-space indentation, semicolons, double-quoted strings, and trailing
  commas in multiline structures.
- Prefer small modules with explicit exports and dependency injection for
  process or filesystem side effects.
- Use `async`/`await` for asynchronous control flow.
- Keep user-facing errors concise and actionable.
- Preserve natural filename sorting and case-insensitive extension handling.
- Keep renderer DOM updates targeted; avoid unnecessary global queries and
  repeated listener creation.

## Generated and packaged files

- `node_modules/`, `dist/`, `tmp/`, logs, and `.DS_Store` are ignored and must
  not be committed.
- `assets/icon.png`, `assets/icon.iconset/`, and `assets/icon.icns` are tracked.
  Edit the PNG source and use `npm run icon`; do not manually edit the ICNS.
- The packaged ASAR should contain only `package.json` and runtime files under
  `src/`. Do not accidentally include tests, source icon assets, caches, build
  scripts, or temporary files.
- Local builds are unsigned and unnotarized unless explicit signing credentials
  and distribution requirements are provided.

## Documentation

Keep `README.md` synchronized with visible labels, requirements, supported file
types, defaults, manifest format, commands, and build behavior. User-facing
feature changes are incomplete until the README and relevant tests are updated.
