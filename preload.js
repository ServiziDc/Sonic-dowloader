const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  chooseFolder:   () => ipcRenderer.invoke('choose-folder'),
  getDefaultFolder: () => ipcRenderer.invoke('get-default-folder'),
  setDefaultFolder: (folder) => ipcRenderer.invoke('set-default-folder', folder),
  openFolder:     (p) => ipcRenderer.invoke('open-folder', p),
  checkTools:     () => ipcRenderer.invoke('check-tools'),
  downloadMissingTools: () => ipcRenderer.invoke('download-missing-tools'),
  onToolsProgress: (cb) => ipcRenderer.on('tools-download-progress', (_, data) => cb(data)),
  getPlaylistName:(url) => ipcRenderer.invoke('get-playlist-name', url),
  getPlaylistCount:(url) => ipcRenderer.invoke('get-playlist-count', url),
  startDownload:  (opts) => ipcRenderer.invoke('start-download', opts),
  getApiKey:      () => ipcRenderer.invoke('get-api-key'),
  setApiKey:      (k) => ipcRenderer.invoke('set-api-key', k),
  getSpotifyKeys: () => ipcRenderer.invoke('get-spotify-keys'),
  setSpotifyKeys: (keys) => ipcRenderer.invoke('set-spotify-keys', keys),
  getLastfmKey: () => ipcRenderer.invoke('get-lastfm-key'),
  setLastfmKey: (key) => ipcRenderer.invoke('set-lastfm-key', key),
  getJamendoId: () => ipcRenderer.invoke('get-jamendo-id'),
  setJamendoId: (id) => ipcRenderer.invoke('set-jamendo-id', id),
  getGensetFonti: () => ipcRenderer.invoke('get-genset-fonti'),
  setGensetFonti: (fonti) => ipcRenderer.invoke('set-genset-fonti', fonti),
  getDiscogsToken: () => ipcRenderer.invoke('get-discogs-token'),
  setDiscogsToken: (token) => ipcRenderer.invoke('set-discogs-token', token),
  getGeminiKey: () => ipcRenderer.invoke('get-gemini-key'),
  setGeminiKey: (key) => ipcRenderer.invoke('set-gemini-key', key),
  getCookieCfg:   () => ipcRenderer.invoke('get-cookie-cfg'),
  setCookieCfg:   (cfg) => ipcRenderer.invoke('set-cookie-cfg', cfg),
  chooseCookieFile:() => ipcRenderer.invoke('choose-cookie-file'),
  stopDownload:   () => ipcRenderer.send('stop-download'),
  rebuildArchive: (opts) => ipcRenderer.invoke('rebuild-archive', opts),
  deleteArchive:  (f) => ipcRenderer.invoke('delete-archive', f),
  onLog:          (cb) => ipcRenderer.on('download-log', (_, msg) => cb(msg)),
  onDone:         (cb) => ipcRenderer.on('download-done', (_, data) => cb(data)),
  onBlock:        (cb) => ipcRenderer.on('download-block', (_, data) => cb(data)),
  onNowPlaying:   (cb) => ipcRenderer.on('now-playing', (_, data) => cb(data)),
  soundcloudSearchPlay: (query) => ipcRenderer.invoke('soundcloud-search-play', { query }),
  youtubeSearchPlay: (query) => ipcRenderer.invoke('youtube-search-play', { query }),
  searchTitles:      (titles) => ipcRenderer.invoke('search-titles', { titles }),
  generateSet:       (opts) => ipcRenderer.invoke('generate-set', opts),
  onGenerateSetProgress: (cb) => ipcRenderer.on('generate-set-progress', (_, data) => cb(data)),
  startSearchDownload: (opts) => ipcRenderer.invoke('start-search-download', opts),
  startMultiUrlDownload: (opts) => ipcRenderer.invoke('start-multi-url-download', opts),
  startListDownloadOther: (opts) => ipcRenderer.invoke('start-list-download-other', opts),
  onSearchProgress:  (cb) => ipcRenderer.on('search-progress', (_, data) => cb(data)),
  onSearchProgressStatus: (cb) => ipcRenderer.on('search-progress-status', (_, data) => cb(data)),
  removeAllListeners: () => {
    ipcRenderer.removeAllListeners('download-log');
    ipcRenderer.removeAllListeners('download-done');
    ipcRenderer.removeAllListeners('download-block');
    ipcRenderer.removeAllListeners('now-playing');
    ipcRenderer.removeAllListeners('search-progress');
    ipcRenderer.removeAllListeners('search-progress-status');
  }
});

// YouTube Login
contextBridge.exposeInMainWorld('ytLogin', {
  login:       () => ipcRenderer.invoke('youtube-login'),
  logout:      () => ipcRenderer.invoke('youtube-logout'),
  checkLogin:  () => ipcRenderer.invoke('youtube-check-login'),
  syncCookies: () => ipcRenderer.invoke('sync-cookies'),
  onLoginDone: (cb) => ipcRenderer.on('login-done', (_, data) => cb(data)),
});
