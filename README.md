# Almost Gallery

Almost Gallery is a native macOS app for preparing photo albums for
[nicokaiser/hugo-theme-gallery](https://github.com/nicokaiser/hugo-theme-gallery/).
The theme sorts images by filename by default. Almost Gallery lets you arrange
source photos visually, then exports JPEGs named `000.jpg`, `001.jpg`, and so on
in that order.

## Features

- Uses a native macOS window toolbar, system appearance, and grouped export settings.
- Opens folders containing JPG, JPEG, PNG, WebP, TIFF, HEIC, and HEIF images.
- Sorts new albums naturally by filename and restores saved order and options.
- Shows cached 640px thumbnails in a resizable grid. Drag a thumbnail to reorder,
  or click to select it and use the arrow buttons or Option + Left/Right.
  Adjust thumbnail size with the slider above the grid.
- Limits thumbnail conversions to two at a time, including when switching albums.
- Provides Undo and Redo for the current album, including Command + Z and
  Shift + Command + Z.
- Opens a full photo preview by double-clicking a thumbnail or choosing **Preview**.
  Navigate with the arrow buttons or Left/Right keys; Escape closes the preview.
- Offers width, height, sizing mode, JPEG quality, and advanced ImageMagick
  geometry under **Export Settings**. The defaults are `2000x2000` and `85`.
  Fit preserves the whole photo. Cover preserves proportions and may exceed one
  dimension without cropping. Exact dimensions stretches the image.
- Applies EXIF auto-orientation and exports JPEGs without modifying source photos.
- Stages every conversion in a unique hidden directory before replacing the
  `output` folder. A failed export preserves the previous output and manifest.
  If the selected folder is moved or replaced, reopen it before exporting.
- Reports old backups that could not be removed after a successful export and
  offers **Show Backups in Finder** so they can be reviewed and deleted.
- Saves order and options to `almost_gallery_output.json`. Missing source photos
  are ignored on reopening, and newly added photos are appended. Invalid saved
  JSON produces a warning while the album still opens.
- Shows export progress and a **Show in Finder** button after success.

## Requirements

- macOS 13 or newer
- Swift 5.9 or newer with the macOS SDK (Xcode or Command Line Tools)
- ImageMagick 7 (`brew install imagemagick`)

The app checks `ALMOST_GALLERY_MAGICK`, standard Apple Silicon and Intel
Homebrew paths, and `PATH` for the `magick` executable.

## Build and run

```sh
./scripts/build-native.sh
open "dist/Almost Gallery.app"
```

The build creates a locally ad hoc signed `.app` in `dist/`. It is not notarized
or prepared for external distribution. The Swift package can also be built with
`swift build` and run with `swift run AlmostGallery`.

Choose **Open Folder…**, arrange the grid, optionally adjust **Export Settings**,
and choose **Export**. Generated photos are written to `output` inside the
selected album. The default conversion is equivalent to:

```sh
magick INPUT -auto-orient -resize 2000x2000 -quality 85 OUTPUT
```

After a successful export, `almost_gallery_output.json` is written in the
album folder:

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

This format is compatible with albums exported by the previous Electron app.

## Tests

```sh
./scripts/test-native.sh
```

The checks use temporary albums and fake conversion output to verify saved
state, malformed JSON handling, ordered export, rollback after conversion and
manifest failures, backup cleanup reporting, folder replacement rejection,
path validation, thumbnail cache identity, and output filenames.
