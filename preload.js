const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Desktop capturer
  getDesktopSources: () => ipcRenderer.invoke('get-desktop-sources'),
  
  // Audio loopback controls
  enableLoopbackAudio: () => ipcRenderer.invoke('enable-loopback-audio'),
  disableLoopbackAudio: () => ipcRenderer.invoke('disable-loopback-audio'),
   // ✅ Add token listener
  onTokenReceived: (callback) => {
    ipcRenderer.on('token-received', (event, token) => callback(token));
  },
  
  // ✅ Add method to get current token
  getToken: () => ipcRenderer.invoke('get-current-token'),

  // System info
  platform: process.platform,
  versions: {
    node: process.versions.node,
    chrome: process.versions.chrome,
    electron: process.versions.electron
  }
});
