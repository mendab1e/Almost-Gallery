const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { pathToFileURL } = require("node:url");
const {
  applySavedOrder,
  isSupportedImage,
  outputName,
  validateOptions,
} = require("./export-utils");
const {
  MANIFEST_FILENAME,
  loadExportManifest,
  saveExportManifest,
} = require("./manifest-store");

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 760,
    minHeight: 560,
    titleBarStyle: "hiddenInset",
    backgroundColor: "#f5f3ee",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.loadFile(path.join(__dirname, "index.html"));
}

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

ipcMain.handle("folder:open", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Choose a photo folder",
    properties: ["openDirectory"],
  });
  if (result.canceled) return null;

  const folder = result.filePaths[0];
  const entries = await fs.readdir(folder, { withFileTypes: true });
  let images = entries
    .filter((entry) => entry.isFile() && isSupportedImage(entry.name))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
    .map((entry) => {
      const filePath = path.join(folder, entry.name);
      return {
        id: filePath,
        name: entry.name,
        path: filePath,
        url: pathToFileURL(filePath).href,
      };
    });

  let savedOptions = null;
  let projectLoaded = false;
  let loadWarning = null;
  try {
    const manifest = await loadExportManifest(folder);
    if (manifest) {
      images = applySavedOrder(images, manifest.photos);
      savedOptions = manifest.options;
      projectLoaded = true;
    }
  } catch (error) {
    loadWarning = `Could not load ${MANIFEST_FILENAME}: ${error.message}`;
  }

  return {
    folder,
    images,
    options: savedOptions,
    projectLoaded,
    loadWarning,
  };
});

ipcMain.handle("folder:reveal", async (_event, folder) => {
  if (typeof folder === "string") await shell.openPath(folder);
});

ipcMain.handle("photos:export", async (_event, request) => {
  const options = validateOptions(request?.options);
  const folder = request?.folder;
  const photos = request?.photos;
  if (typeof folder !== "string" || !Array.isArray(photos) || photos.length === 0) {
    throw new Error("Open a folder containing photos before exporting.");
  }

  const outputFolder = path.join(folder, "output");
  await fs.mkdir(outputFolder, { recursive: true });

  for (let index = 0; index < photos.length; index += 1) {
    const source = photos[index]?.path;
    if (typeof source !== "string" || path.dirname(source) !== folder) {
      throw new Error("The photo list contains an invalid file.");
    }
    const destination = path.join(outputFolder, outputName(index, photos.length));
    await runMagick([
      source,
      "-auto-orient",
      "-resize",
      options.resize,
      "-quality",
      String(options.quality),
      destination,
    ]);
    mainWindow?.webContents.send("photos:progress", {
      current: index + 1,
      total: photos.length,
    });
  }

  const manifestPath = await saveExportManifest(
    folder,
    photos.map((photo) => path.basename(photo.path)),
    options,
  );

  return {
    outputFolder,
    manifestPath,
    count: photos.length,
  };
});

function runMagick(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("magick", args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      if (error.code === "ENOENT") {
        reject(new Error("ImageMagick was not found. Install it with: brew install imagemagick"));
      } else {
        reject(error);
      }
    });
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `ImageMagick exited with code ${code}.`));
    });
  });
}
