const { contextBridge, ipcRenderer } = require('electron');

// Expose limited APIs to the renderer process for security
contextBridge.exposeInMainWorld('electronAPI', {
  // Allow renderer to close window
  closeWindow: () => ipcRenderer.send('close-window'),
  
  // Allow renderer to minimize window
  minimizeWindow: () => ipcRenderer.send('minimize-window'),
  
  // Allow renderer to open dev tools (dev mode only)
  openDevTools: () => ipcRenderer.send('open-dev-tools'),

  // Platform info for renderer
  platform: process.platform,
  
  // App version
  appVersion: require('electron').app.getVersion(),
});

// Handle IPC responses from main process
ipcRenderer.on('main-process-message', (event, message) => {
  // Handle messages from main process if needed
});
