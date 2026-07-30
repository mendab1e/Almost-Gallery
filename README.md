# Almost Gallery

A macOS Electron app for arranging and preparing photos for a filename-sorted
Hugo gallery.

## Features

- Opens folders containing JPG, JPEG, PNG, WebP, TIFF, HEIC, and HEIF images.
- Generates 640px thumbnails progressively with bounded background work and
  keeps them in the macOS cache. Source photos and album folders are untouched.
- Reuses cached thumbnails until a source photo changes.
- Initially sorts photos naturally by filename.
- Reorders photos with drag and drop.
- Changes grid thumbnail size with the −/+ controls.
- Previews one photo at a time from the toolbar or by clicking a thumbnail.
- Navigates the gallery preview with its ←/→ buttons or the keyboard arrow keys;
  Escape closes it.
- Configures ImageMagick resize geometry and JPEG quality. Defaults are
  `2000x2000` and `85`.
- Applies EXIF auto-orientation, converts every exported image to JPEG, and
  leaves source photos unchanged.
- Exports in grid order as `000.jpg`, `001.jpg`, `002.jpg`, and so on.
- Replaces the previous `output` directory only after every conversion
  succeeds, so stale files and partial failed exports are not retained.
- Saves photo order and ImageMagick options to
  `almost_gallery_output.json`.
- Restores saved order and options when an album is reopened. Newly added
  photos are appended and missing photos are ignored.
- Displays a warning and opens the album normally if its saved JSON is invalid.

## Requirements

- macOS
- Node.js 22.12 or newer
- ImageMagick 7

Install ImageMagick with Homebrew:

```sh
brew install imagemagick
```

Almost Gallery checks `ALMOST_GALLERY_MAGICK`, standard Apple Silicon and Intel
Homebrew locations, and `PATH`. To use a custom installation:

```sh
ALMOST_GALLERY_MAGICK=/custom/path/magick npm start
```

## Run locally

```sh
npm install
npm start
```

Choose **Open folder**, arrange the grid, optionally adjust **Options**, and
choose **Export**. The generated photos are written to an `output` directory
inside the selected album folder.

The default conversion is equivalent to:

```sh
magick INPUT -auto-orient -resize 2000x2000 -quality 85 OUTPUT
```

## Saved album state

After a successful export, `almost_gallery_output.json` is written atomically
in the selected album folder:

```json
{
  "version": 1,
  "imageMagick": {
    "resize": "2000x2000",
    "quality": 85
  },
  "photos": [
    "IMG_1032.HEIC",
    "portrait.jpg"
  ]
}
```

The filenames are source-photo names, in export order.

## Tests

```sh
npm test
```

The test suite covers filename generation, supported formats, option and
manifest validation, manifest filesystem behavior, album restoration,
ImageMagick discovery, cached-thumbnail generation and fallback behavior,
atomic exports and failure recovery, drag ordering, grid size boundaries,
gallery-preview navigation, control states, and folder-open warnings.

To check dependency advisories:

```sh
npm audit
```

## App icon

The active source icon is `assets/icon.png`. Regenerate its size variants and
native macOS ICNS file with:

```sh
npm run icon
```

This updates `assets/icon.iconset/` and `assets/icon.icns`.

## Build the macOS app

```sh
npm run dist
```

The `.app`, `.zip`, and `.dmg` are written to `dist/`. The build targets the
current Mac architecture and uses Electron Packager plus native macOS tools.
The local build is not signed or notarized; configure an Apple Developer
certificate and notarization before distributing it to other Macs.
