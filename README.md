# Almost Gallery

Almost Gallery is an Electron application for preparing photos for the
workflow of the
[nicokaiser/hugo-theme-gallery](https://github.com/nicokaiser/hugo-theme-gallery/)
theme for Hugo.


![Image](https://github.com/user-attachments/assets/b7b9a98d-cdfa-4114-a397-efbb5af4a5ca)


The theme displays album photos in a configurable order, but its default is to
sort image resources by `Name` — the filename. This makes the filenames part of
the gallery layout: changing the visual order normally means manually renaming
every photo so that alphabetical sorting produces the desired sequence.

Almost Gallery replaces that inconvenient manual step with a visual workflow.
Open an album folder, arrange its photos in a drag-and-drop grid, preview the
result, and export through ImageMagick. The exported files are resized,
optimized, and named `000.jpg`, `001.jpg`, `002.jpg`, and so on, so their
filename order matches the order chosen in the grid.

## Features

- Opens folders containing JPG, JPEG, PNG, WebP, TIFF, HEIC, and HEIF images.
- Initially sorts photos naturally by filename.
- Shows complete photos in neutral thumbnail frames, without cropping.
- Reorders photos with drag and drop; insertion markers show the exact drop edge.
- Supports keyboard ordering: Tab to a photo, then Option + Left/Right to move
  it one position. Enter or Space opens that photo in Preview.
- Provides Undo and Redo buttons and Command + Z / Shift + Command + Z shortcuts
  (Control works too). History is kept for the current open album.
- Changes grid thumbnail size with the −/+ controls.
- Previews one photo at a time using **Preview** in the toolbar or by clicking a thumbnail.
- Navigates the gallery preview with its ←/→ buttons or the keyboard arrow keys;
  Escape closes it.
- Offers width, height, and sizing controls under **Export settings**, plus
  optional advanced ImageMagick geometry. Fit preserves the whole photo;
  Cover preserves proportions and may exceed one dimension without cropping;
  Exact dimensions stretches the image. Defaults are
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
- Keeps the photo count, JPEG settings, and export state visible in a footer.
  Order and settings changes, including added or removed filenames on reopening,
  are compared with the last successful export. This status does not detect
  changes to source image contents or externally changed/deleted output files.
- Shows export progress and a **Show in Finder** button after successful export.
  Opening another album, changing settings, and reordering are disabled during
  export. Preview remains available.
- Displays a warning and opens the album normally if its saved JSON is invalid.

## Requirements

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

Choose **Open folder**, arrange the grid, optionally adjust **Export settings**, and
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

## Build the macOS app

```sh
npm run dist
```

The `.app`, `.zip`, and `.dmg` are written to `dist/`. The build targets the
current Mac architecture and uses Electron Packager plus native macOS tools.
The local build is not signed or notarized.
