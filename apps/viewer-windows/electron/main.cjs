const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { Menu, app, BrowserWindow, shell } = require("electron");

app.disableHardwareAcceleration();

function normalizeApiBaseUrl(value) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = new URL(trimmed);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return null;
    }
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

function readExternalRuntimeConfig() {
  try {
    const configPath = path.join(app.getPath("userData"), "app-config.json");
    if (!fs.existsSync(configPath)) {
      return null;
    }

    const parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    const apiBaseUrl = normalizeApiBaseUrl(parsed.apiBaseUrl);
    const webAppUrl = normalizeWebAppUrl(parsed.webAppUrl);
    return {
      apiBaseUrl,
      webAppUrl
    };
  } catch {
    return null;
  }
}

function normalizeWebAppUrl(value) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = new URL(trimmed);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function resolveRuntimeOverrides() {
  const fromEnv = normalizeApiBaseUrl(process.env.FLIXIFY_API_BASE_URL);
  const fromWebEnv = normalizeWebAppUrl(process.env.FLIXIFY_WEB_APP_URL);
  const fromPublicWebEnv = normalizeWebAppUrl(process.env.PUBLIC_APP_BASE_URL);
  const fromViewerWebosEnv = normalizeWebAppUrl(process.env.VITE_WEB_APP_URL);
  const fromConfig = readExternalRuntimeConfig();

  return {
    apiBaseUrl: fromEnv ?? fromConfig?.apiBaseUrl ?? null,
    webAppUrl: fromWebEnv ?? fromPublicWebEnv ?? fromViewerWebosEnv ?? fromConfig?.webAppUrl ?? null
  };
}

async function hardReload(mainWindow) {
  try {
    await mainWindow.webContents.session.clearCache();
  } catch {
    // noop
  }
  mainWindow.webContents.reloadIgnoringCache();
}

function createAppMenu(mainWindow) {
  const template = [
    {
      label: "Flixify Pro",
      submenu: [
        {
          label: "Guncelle",
          accelerator: "CmdOrCtrl+Shift+R",
          click: () => {
            void hardReload(mainWindow);
          }
        },
        { type: "separator" },
        { role: process.platform === "darwin" ? "close" : "quit" }
      ]
    },
    {
      label: "View",
      submenu: [
        {
          label: "Yeniden Yukle",
          accelerator: "CmdOrCtrl+R",
          click: () => {
            mainWindow.webContents.reload();
          }
        },
        {
          label: "Onbelleksiz Yeniden Yukle",
          accelerator: "CmdOrCtrl+Alt+R",
          click: () => {
            void hardReload(mainWindow);
          }
        },
        { type: "separator" },
        { role: "togglefullscreen" },
        { role: "toggleDevTools" }
      ]
    },
    {
      label: "Window",
      submenu: [{ role: "minimize" }, { role: "zoom" }, { role: "front" }]
    }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function createMainWindow() {
  const mainWindow = new BrowserWindow({
    width: 1366,
    height: 820,
    minWidth: 1024,
    minHeight: 640,
    autoHideMenuBar: true,
    backgroundColor: "#05070B",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  const indexPath = path.join(__dirname, "..", "web-dist", "index.html");
  const runtime = resolveRuntimeOverrides();

  if (!runtime.webAppUrl && !fs.existsSync(indexPath)) {
    mainWindow.loadURL(
      "data:text/html;charset=UTF-8," +
        encodeURIComponent(
          "<h2>Flixify Pro paketi hazir degil.</h2><p>Calistirmadan once `npm run prepare:desktop` komutunu calistirin.</p>"
        )
    );
    return;
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  // Prevent stale hashed CSS/JS from previous installs causing broken layouts.
  await mainWindow.webContents.session.clearCache().catch(() => undefined);
  const entryUrl = runtime.webAppUrl ? new URL(runtime.webAppUrl) : pathToFileURL(indexPath);
  if (runtime.apiBaseUrl) {
    entryUrl.searchParams.set("apiBaseUrl", runtime.apiBaseUrl);
  }

  void mainWindow.loadURL(entryUrl.toString());
  createAppMenu(mainWindow);
}

app.whenReady().then(() => {
  void createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
