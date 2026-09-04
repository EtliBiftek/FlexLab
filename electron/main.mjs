import { app, BrowserWindow, Menu, Tray, nativeImage, utilityProcess, ipcMain, shell } from "electron";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let mainWindow = null;
let tray = null;
let daemon = null;
let quitting = false;
const managementToken = crypto.randomBytes(32).toString("hex");
process.env.FLEXLAB_MANAGEMENT_TOKEN = managementToken;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

app.on("second-instance", () => {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
  }
});

function startDaemon() {
  if (daemon) return;
  const serverPath = app.isPackaged
    ? path.join(process.resourcesPath, "app.asar.unpacked", "native", "server.mjs")
    : path.join(__dirname, "..", "native", "server.mjs");
  daemon = utilityProcess.fork(serverPath, [], {
    serviceName: "FlexLab Native Runtime",
    stdio: "pipe",
    env: { ...process.env, FLEXLAB_MANAGEMENT_TOKEN: managementToken },
  });
  daemon.stdout?.on("data", (data) => console.log(`[FlexLab native] ${data}`));
  daemon.stderr?.on("data", (data) => console.error(`[FlexLab native] ${data}`));
  daemon.on("exit", () => { daemon = null; });
}

function stopDaemon() {
  daemon?.kill();
  daemon = null;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: "#0b0b0d",
    title: "FlexLab",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.setMenuBarVisibility(false);
  const dev = process.env.FLEXLAB_DEV_URL;
  if (dev) mainWindow.loadURL(dev);
  else mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.on("close", (event) => {
    if (!quitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
}

function createTray() {
  const iconPath = path.join(__dirname, "..", "build", "icon.png");
  let image = nativeImage.createFromPath(iconPath);
  if (image.isEmpty()) image = nativeImage.createEmpty();
  tray = new Tray(image.resize({ width: 18, height: 18 }));
  tray.setToolTip("FlexLab");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "FlexLab'ı aç", click: () => { mainWindow?.show(); mainWindow?.focus(); } },
    { type: "separator" },
    { label: "Çık", click: () => { quitting = true; app.quit(); } },
  ]));
  tray.on("double-click", () => mainWindow?.show());
}

function parseVersion(value) {
  return String(value || "0").replace(/^v/i, "").split(".").map((n) => Number.parseInt(n, 10) || 0);
}

function isNewerVersion(candidate, current) {
  const a = parseVersion(candidate);
  const b = parseVersion(current);
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i += 1) {
    const av = a[i] || 0;
    const bv = b[i] || 0;
    if (av !== bv) return av > bv;
  }
  return false;
}

async function checkGitHubRelease() {
  try {
    const response = await fetch("https://api.github.com/repos/EtliBiftek/FlexLab/releases/latest", {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": `FlexLab/${app.getVersion()}`,
      },
      signal: AbortSignal.timeout(10000),
    });
    if (response.status === 404) {
      return { ok: true, updateAvailable: false, version: null, currentVersion: app.getVersion() };
    }
    if (!response.ok) throw new Error(`GitHub HTTP ${response.status}`);
    const release = await response.json();
    const version = String(release.tag_name || release.name || "").replace(/^v/i, "");
    return {
      ok: true,
      currentVersion: app.getVersion(),
      version,
      updateAvailable: isNewerVersion(version, app.getVersion()),
      url: release.html_url || "https://github.com/EtliBiftek/FlexLab/releases/latest",
    };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

ipcMain.handle("desktop:get", () => ({
  version: app.getVersion(),
  openAtLogin: app.getLoginItemSettings().openAtLogin,
  packaged: app.isPackaged,
}));
ipcMain.handle("desktop:set-open-at-login", (_event, enabled) => {
  app.setLoginItemSettings({ openAtLogin: Boolean(enabled) });
  return app.getLoginItemSettings().openAtLogin;
});
ipcMain.handle("desktop:check-updates", () => checkGitHubRelease());
ipcMain.handle("desktop:open-releases", () => shell.openExternal("https://github.com/EtliBiftek/FlexLab/releases/latest"));

if (process.argv.includes("--smoke-test")) {
  app.whenReady().then(() => {
    console.log(JSON.stringify({ ok: true, app: "FlexLab", version: app.getVersion(), packaged: app.isPackaged }));
    app.exit(0);
  }).catch((error) => {
    console.error(error);
    app.exit(1);
  });
} else {
  app.whenReady().then(() => {
    app.setAppUserModelId("com.pifo.flexlab");
    startDaemon();
    createWindow();
    createTray();
  });
}

app.on("before-quit", () => {
  quitting = true;
  stopDaemon();
});
app.on("window-all-closed", () => {});
