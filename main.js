const { app, BrowserWindow, desktopCapturer, ipcMain, Menu, session } = require('electron');
const path = require('path');
// Express server for local token relay
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');

// Initialize audio loopback for system audio capture
const { initMain } = require('electron-audio-loopback');

let mainWindow;

// Localhost server config
const LOCAL_PORT = 4545;
let latestToken = null;

function startLocalServer() {
  const appServer = express();
  appServer.use(cors({
    origin: 'http://localhost:8080', // <-- set to your web app URL
    credentials: true
  }));
  appServer.use(bodyParser.json());

  // Receive token from web app
  appServer.post('/token', (req, res) => {
    const { token } = req.body;
    if (!token) {
      return res.status(400).json({ error: 'No token provided' });
    }
    console.log('Received Azure AD token:', token);
    latestToken = token;
    
    // Send token to renderer process immediately
    if (mainWindow && mainWindow.webContents) {
      mainWindow.webContents.send('token-received', token);
    }
    
    forwardTokenToBackend(token);
    res.json({ status: 'Token received' });
  });

  appServer.listen(LOCAL_PORT, () => {
    console.log(`Electron local server listening on http://localhost:${LOCAL_PORT}`);
  });
}

async function forwardTokenToBackend(token) {
  try {
    const fetch = (...args) => import('node-fetch').then(m => m.default(...args));
    const response = await fetch('https://api.mydomain.com/electron-auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token })
    });
    const data = await response.json();
    console.log('Backend response:', data);
  } catch (err) {
    console.error('Error forwarding token to backend:', err);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 700,
    minWidth: 400,
    minHeight: 400,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      webSecurity: true,
    },
    icon: path.join(__dirname, 'assets', 'wiproLogoBig.png'),
    title: 'Wipro Audio Streamer - GenAI Foundry',
    show: false,
    resizable: true,
    maximizable: true,
    fullscreenable: true,
  });

  mainWindow.loadFile('index.html');

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  createMenu();
  setupAudioHandlers();
}

function createMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Quit',
          accelerator: process.platform === 'darwin' ? 'Cmd+Q' : 'Ctrl+Q',
          click: () => app.quit(),
        },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About',
          click: () => {
            const { dialog } = require('electron');
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'About Wipro Audio Streamer',
              message: 'Wipro Audio Streamer v1.0.0',
              detail:
                'Desktop audio streaming application\nDeveloped by Wipro GenAI Foundry\n\n© 2025 Wipro Limited',
            });
          },
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

function setupAudioHandlers() {
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    desktopCapturer.getSources({ types: ['screen', 'window'] }).then((sources) => {
      const primaryScreen =
        sources.find((source) => source.name.includes('Entire Screen')) || sources[0];
      callback({
        video: primaryScreen,
        audio: 'loopback',
      });
    });
  });
}

// ✅ FIXED: Register IPC handlers ONCE, outside any event listeners
ipcMain.handle('get-desktop-sources', async () => {
  try {
    const sources = await desktopCapturer.getSources({
      types: ['window', 'screen'],
      fetchWindowIcons: true,
    });
    return sources;
  } catch (error) {
    console.error('Error getting desktop sources:', error);
    return [];
  }
});

// ✅ FIXED: Register token handler ONCE
ipcMain.handle('get-current-token', async () => {
  console.log('get-current-token called, returning:', latestToken ? 'Token exists' : 'No token');
  return latestToken;
});

// ✅ Prevent new windows from opening
app.on('web-contents-created', (event, contents) => {
  contents.on('new-window', (event) => {
    event.preventDefault();
  });
  
  // Also handle will-navigate to prevent navigation
  contents.on('will-navigate', (event, navigationUrl) => {
    const parsedUrl = new URL(navigationUrl);
    // Allow only local file navigation
    if (parsedUrl.protocol !== 'file:') {
      event.preventDefault();
    }
  });
});

app.whenReady().then(() => {
  initMain(); // Initialize audio loopback
  startLocalServer(); // Start the local HTTP server for token relay
  createWindow();
  
  // Log the latest token (if any) when app is loaded
  if (latestToken) {
    console.log('Latest Azure AD token on app load:', latestToken);
  } else {
    console.log('No Azure AD token received yet on app load.');
  }
  
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// ✅ Cleanup on quit
app.on('before-quit', () => {
  console.log('Application quitting, cleaning up...');
  latestToken = null;
});
