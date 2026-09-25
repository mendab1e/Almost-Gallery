# AGENTS.md

These instructions apply to the entire repository.

## Purpose

Almost Gallery is a native macOS SwiftUI application for ordering source photos
for `nicokaiser/hugo-theme-gallery`. It exports ordered JPEGs named `000.jpg`,
`001.jpg`, and so on.

Preserve these guarantees:

- Source photos are never modified, renamed, or deleted.
- Exports go to `output` inside the selected album in current grid order.
- ImageMagick defaults remain resize `2000x2000` and quality `85`.
- A failed export preserves the previous output and manifest.
- `almost_gallery_output.json` remains version `1`, with source filenames in
  order and the ImageMagick options used.

## Architecture

- `Native/Sources/GalleryApp.swift`: SwiftUI window, grid, settings, preview,
  progress, order history, and bounded thumbnail work.
- `Native/Sources/GalleryCore.swift`: album loading, validation, ImageMagick
  discovery and execution, thumbnail caching, transactional export, manifest.
- `Native/Tests/GalleryCoreChecks.swift`: deterministic filesystem checks with
  temporary albums and fake conversions.
- `Package.swift`: Swift package definition.
- `scripts/build-native.sh`: release build and local `.app` bundle.
- `scripts/test-native.sh`: compile and run native core checks.

## Performance and safety

- Use cached 640px thumbnails in the grid; originals are for one-photo preview
  and export. Cache under the user's macOS caches directory, never the album.
- Keep thumbnail generation off the main actor, bounded to two concurrent
  workers. Ignore results from an album that is no longer open.
- Cache identity changes with source path, size, or modification time. A failed
  thumbnail may fall back to the original without failing the album.
- Validate selected album and every photo immediately before export. Reject
  paths outside the album, symlinks, duplicates, and unsupported extensions.
- Convert into hidden staging first, then replace output, then commit the
  manifest. Roll back output and manifest on a failed commit.
- Restore saved photos in manifest order; ignore missing names and append new
  photos in natural filename order. Warn on malformed JSON and open the album.

## Commands

Requirements: macOS 13+, Swift 5.9+, ImageMagick 7.

```sh
./scripts/test-native.sh
./scripts/build-native.sh
open "dist/Almost Gallery.app"
```

Run core checks after functional changes. Build and inspect the app after UI or
packaging changes. Keep `README.md` synchronized with visible labels, supported
formats, defaults, manifest format, and commands. `dist/`, `.build/`, `tmp/`,
logs, and `.DS_Store` are ignored. Local bundles are ad hoc signed and
unnotarized.
