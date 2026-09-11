const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { pathToFileURL } = require("node:url");
const { loadAlbumState } = require("./album-state");
const { isSupportedImage } = require("./export-utils");
const { resolveImageMagick } = require("./image-magick");
const { MANIFEST_FILENAME } = require("./manifest-store");
const { exportAlbum } = require("./photo-exporter");
const { generateThumbnails } = require("./thumbnail-service");

const { createAlbumSession } = require("./album-session");
const albumSession = createAlbumSession();
let lastOutputFolder = null;
let openingFolder = false;

let mainWindow;
let imageMagickExecutable;
let thumbnailGenerationId = 0;

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
  if (openingFolder || albumSession.exporting) return null;
  openingFolder = true;
  try {
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
    let savedPhotos = null;
    try {
      const albumState = await loadAlbumState(folder, images);
      images = albumState.images;
      savedOptions = albumState.options;
      projectLoaded = albumState.projectLoaded;
      savedPhotos = albumState.savedPhotos || null;
    } catch (error) {
      loadWarning = `Could not load ${MANIFEST_FILENAME}: ${error.message}`;
    }

    const albumId = albumSession.select(folder, images);
    thumbnailGenerationId += 1;
    lastOutputFolder = null;
    return {
      albumId,
      folder,
      images,
      options: savedOptions,
      projectLoaded,
      loadWarning,
      savedPhotos,
    };
  } finally {
    openingFolder = false;
  }
});

ipcMain.handle("folder:reveal", async () => {
  if (lastOutputFolder) {
    const error = await shell.openPath(lastOutputFolder);
    if (error) throw new Error(error);
  }
});

ipcMain.handle("thumbnails:generate", async (event, request) => {
  const selection = albumSession.resolve(request);
  const generationId = ++thumbnailGenerationId;
  return generateThumbnails({
    ...selection,
    cacheFolder: path.join(app.getPath("cache"), "almost-gallery-thumbnails"),
    runMagick,
    onThumbnail: (thumbnail) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send("photos:thumbnail", { ...thumbnail, albumId: request.albumId });
      }
    },
    shouldContinue: () => generationId === thumbnailGenerationId,
  });
});

ipcMain.handle("photos:export", async (event, request) => {
  if (openingFolder) throw new Error("Finish choosing an album first.");
  return albumSession.export(request, async (selection) => {
    const result = await exportAlbum({
      ...selection,
      options: request?.options,
      runMagick,
      onProgress: (progress) => {
        if (!event.sender.isDestroyed()) event.sender.send("photos:progress", progress);
      },
    });
    lastOutputFolder = result.outputFolder;
    return result;
  });
});

async function runMagick(args) {
  if (!imageMagickExecutable) {
    imageMagickExecutable = await resolveImageMagick();
  }
  return new Promise((resolve, reject) => {
    const child = spawn(imageMagickExecutable, args, {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      if (error.code === "ENOENT") {
        imageMagickExecutable = null;
        reject(
          new Error(
            "ImageMagick was not found. Install it with: brew install imagemagick",
          ),
        );
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
