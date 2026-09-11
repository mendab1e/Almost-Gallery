const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  removeUnusedLocales,
  stripUnusedElectronLocales,
} = require("../scripts/package-utils");

async function temporaryDirectory(t) {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), "almost-gallery-package-"));
  t.after(() => fs.rm(folder, { recursive: true, force: true }));
  return folder;
}

async function addLocale(resourcesPath, locale) {
  const localePath = path.join(resourcesPath, `${locale}.lproj`);
  await fs.mkdir(localePath, { recursive: true });
  await fs.writeFile(path.join(localePath, "locale.pak"), locale);
}

test("removes non-English Electron locales", async (t) => {
  const resourcesPath = await temporaryDirectory(t);
  await Promise.all([
    addLocale(resourcesPath, "de"),
    addLocale(resourcesPath, "en"),
    addLocale(resourcesPath, "en_GB"),
    addLocale(resourcesPath, "fr"),
    fs.writeFile(path.join(resourcesPath, "resources.pak"), "keep"),
  ]);

  assert.equal(await removeUnusedLocales(resourcesPath), 2);
  assert.deepEqual(
    (await fs.readdir(resourcesPath)).sort(),
    ["en.lproj", "en_GB.lproj", "resources.pak"],
  );
});

test("strips locales from the app and Electron framework resources", async (t) => {
  const buildPath = await temporaryDirectory(t);
  const contentsPath = path.join(buildPath, "Electron.app", "Contents");
  const appResources = path.join(contentsPath, "Resources");
  const frameworkResources = path.join(
    contentsPath,
    "Frameworks",
    "Electron Framework.framework",
    "Versions",
    "A",
    "Resources",
  );

  await Promise.all([
    addLocale(appResources, "en"),
    addLocale(appResources, "es"),
    addLocale(frameworkResources, "en_GB"),
    addLocale(frameworkResources, "ja"),
  ]);

  assert.equal(await stripUnusedElectronLocales(buildPath), 2);
  assert.deepEqual(await fs.readdir(appResources), ["en.lproj"]);
  assert.deepEqual(await fs.readdir(frameworkResources), ["en_GB.lproj"]);
});

test("ignores a missing Electron resource directory", async (t) => {
  const buildPath = await temporaryDirectory(t);

  assert.equal(await stripUnusedElectronLocales(buildPath), 0);
});

test("runtime staging includes only package metadata and source files", async (t) => {
  const { stageRuntime } = require("../scripts/package-utils");
  const root = await temporaryDirectory(t);
  await fs.mkdir(path.join(root, "src"));
  await fs.writeFile(path.join(root, "src", "main.js"), "runtime");
  await fs.writeFile(path.join(root, "package.json"), "{}");
  await fs.writeFile(path.join(root, "unexpected-secret.txt"), "exclude");
  const staged = await stageRuntime(root);
  t.after(() => fs.rm(staged, { recursive: true, force: true }));
  assert.deepEqual((await fs.readdir(staged)).sort(), ["package.json", "src"]);
  assert.equal(await fs.readFile(path.join(staged, "src", "main.js"), "utf8"), "runtime");
});
