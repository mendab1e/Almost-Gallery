# Almost Gallery

A small macOS Electron app for arranging photos before publishing them to a
filename-sorted Hugo gallery.

## Requirements

- Node.js 20 or newer
- ImageMagick 7 (`brew install imagemagick`)

## Run locally

```sh
npm install
npm start
```

Open a folder, drag photos into order, adjust export options if needed, then
choose **Save to output**. The app creates an `output` folder beside the source
photos and writes `000.jpg`, `001.jpg`, `002.jpg`, and so on.

After a successful export, `almost_gallery_output.json` is saved in the source
photo folder. It records the source-photo order and ImageMagick settings. Opening
that folder again restores the saved order and settings; new photos are appended
after the saved photos.

The defaults are equivalent to:

```sh
magick INPUT -auto-orient -resize 2000x2000 -quality 85 OUTPUT
```

## Build the macOS app

```sh
npm run dist
```

The `.app`, `.zip`, and `.dmg` are written to `dist/`. The build uses Electron's
maintained packager and native macOS tools. For distribution to other Macs,
configure Apple code signing and notarization.
