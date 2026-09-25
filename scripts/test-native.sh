#!/bin/sh
set -eu

cd "$(dirname "$0")/.."
runner="${TMPDIR:-/tmp}/almost-gallery-checks-$$"
trap 'rm -f "$runner"' EXIT
swiftc Native/Sources/GalleryCore.swift Native/Tests/GalleryCoreChecks.swift -o "$runner"
"$runner"
