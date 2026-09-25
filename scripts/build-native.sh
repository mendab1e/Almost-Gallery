#!/bin/sh
set -eu

cd "$(dirname "$0")/.."
swift build -c release --disable-sandbox

app="dist/Almost Gallery.app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
cp .build/release/AlmostGallery "$app/Contents/MacOS/AlmostGallery"
cp Native/Info.plist "$app/Contents/Info.plist"
cp assets/icon.icns "$app/Contents/Resources/AlmostGallery.icns"
codesign --force --sign - --timestamp=none "$app"
echo "$app"
