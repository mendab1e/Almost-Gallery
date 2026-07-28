const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const iconset = path.join(root, "assets", "icon.iconset");
const output = path.join(root, "assets", "icon.icns");
const entries = [
  ["ic10", "icon_512x512@2x.png"],
  ["ic09", "icon_512x512.png"],
  ["icp5", "icon_16x16@2x.png"],
  ["icp4", "icon_16x16.png"],
];

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
