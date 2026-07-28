const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { resolveImageMagickSync } = require("../src/image-magick");

const root = path.resolve(__dirname, "..");
const iconset = path.join(root, "assets", "icon.iconset");
const output = path.join(root, "assets", "icon.icns");
const source = path.join(root, "assets", "icon.png");
const entries = [
  ["ic10", "icon_512x512@2x.png", 1024],
  ["ic09", "icon_512x512.png", 512],
  ["icp5", "icon_16x16@2x.png", 32],
  ["icp4", "icon_16x16.png", 16],
];

fs.mkdirSync(iconset, { recursive: true });
const magick = resolveImageMagickSync();

for (const [, filename, size] of entries) {
  const destination = path.join(iconset, filename);
  const result = spawnSync(
    magick,
    [
      source,
      "-resize",
      `${size}x${size}`,
      "-alpha",
      "on",
      `PNG32:${destination}`,
    ],
    { stdio: "inherit" },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`ImageMagick exited with code ${result.status}.`);
  }
}

const chunks = entries.map(([type, filename]) => {
  const image = fs.readFileSync(path.join(iconset, filename));
  const header = Buffer.alloc(8);
  header.write(type, 0, 4, "ascii");
  header.writeUInt32BE(image.length + header.length, 4);
  return Buffer.concat([header, image]);
});

const fileHeader = Buffer.alloc(8);
fileHeader.write("icns", 0, 4, "ascii");
fileHeader.writeUInt32BE(
  fileHeader.length + chunks.reduce((total, chunk) => total + chunk.length, 0),
  4,
);

fs.writeFileSync(output, Buffer.concat([fileHeader, ...chunks]));
console.log(`Created ${output}`);
