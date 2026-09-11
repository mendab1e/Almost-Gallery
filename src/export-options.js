(function exposeOptions(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.galleryOptions = api;
})(typeof window === "undefined" ? null : window, function createOptionsApi() {
  const DEFAULT_OPTIONS = Object.freeze({ resize: "2000x2000", quality: 85 });

  function parseGeometry(geometry) {
    const match = /^(\d+)x(\d+)([><^!]?)$/.exec(geometry);
    if (!match) return null;
    return { width: match[1], height: match[2], fit: match[3] };
  }

  function validateOptions(options) {
    const resize = String(options?.resize ?? "").trim();
    const quality = Number(options?.quality);

    if (!parseGeometry(resize)) {
      throw new Error("Resize must look like 2000x2000 (optional suffix: >, <, ^, or !).");
    }
    if (!Number.isInteger(quality) || quality < 1 || quality > 100) {
      throw new Error("Quality must be a whole number from 1 to 100.");
    }
    return { resize, quality };
  }

  function resizeDescription(geometry) {
    const parsed = parseGeometry(geometry);
    if (!parsed) return geometry;
    const labels = { "": "Fit within", ">": "Shrink to fit", "<": "Enlarge to fit", "^": "Cover", "!": "Stretch to" };
    return `${labels[parsed.fit]} ${parsed.width} × ${parsed.height}`;
  }

  return { DEFAULT_OPTIONS, parseGeometry, validateOptions, resizeDescription };
});
