const { app, BrowserWindow, ipcMain, dialog, shell, session } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');
const https = require('https');

// Permette l'autoplay audio negli iframe embed (mini-player YouTube/SoundCloud/Spotify)
// senza questa riga Chromium blocca l'audio nei frame nascosti/fuori schermo.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// ====================================================================
//  CHIAVE API DI DEFAULT (incorporata nell'app)
//  Incolla qui sotto, TRA GLI APICI, la TUA chiave API di YouTube.
//  Cosi' l'app funziona per chiunque senza che ognuno debba metterne
//  una propria. Lasciala '' (vuota) se vuoi che ogni utente usi la sua.
//  Esempio:  const DEFAULT_API_KEY = 'AIzaSyA....................';
const DEFAULT_API_KEY = '__YOUTUBE_API_KEY__';
// ====================================================================

// ====================================================================
//  CHIAVI SPOTIFY DI DEFAULT (incorporate nell'app)
//  Stesso principio della chiave YouTube sopra: registra UNA volta un'app
//  gratuita su developer.spotify.com/dashboard e incolla qui Client ID e
//  Client Secret. Così funziona per chiunque usi SonicDownloader senza che
//  ogni utente debba registrarsi. Lasciale vuote se preferisci che ognuno
//  usi le proprie chiavi (impostabili da Impostazioni nel programma).
const DEFAULT_SPOTIFY_CLIENT_ID = '__SPOTIFY_CLIENT_ID__';
const DEFAULT_SPOTIFY_CLIENT_SECRET = '__SPOTIFY_CLIENT_SECRET__';
// ====================================================================

// ====================================================================
//  CHIAVE LAST.FM DI DEFAULT (incorporata nell'app)
//  Usata per trovare i brani/artisti più rilevanti per un genere (tag),
//  molto più precisa del metodo "conta chi carica di più su YouTube".
//  Registrati gratis su last.fm/api/account/create e incolla qui la
//  API Key. Lasciala vuota se preferisci che ognuno usi la propria.
const DEFAULT_LASTFM_API_KEY = '__LASTFM_API_KEY__';
// ====================================================================

// ====================================================================
//  CLIENT ID JAMENDO DI DEFAULT (incorporato nell'app)
//  Jamendo offre musica REALMENTE scaricabile gratis (licenze Creative
//  Commons) — usata come fonte di download extra oltre a YouTube/SoundCloud.
//  Registrati gratis su devportal.jamendo.com e incolla qui il Client ID.
const DEFAULT_JAMENDO_CLIENT_ID = '__JAMENDO_CLIENT_ID__';
// ====================================================================

// ====================================================================
//  TOKEN DISCOGS DI DEFAULT (incorporato nell'app)
//  Usato per trovare i metadati precisi delle release (ottimo per techno/
//  hardcore/hardstyle, generi molto documentati su Discogs). Registrati
//  gratis su discogs.com/settings/developers e genera un "Personal Access
//  Token", poi incollalo qui.
const DEFAULT_DISCOGS_TOKEN = '__DISCOGS_TOKEN__';
// ====================================================================

// ====================================================================
//  CHIAVE GEMINI DI DEFAULT (incorporata nell'app)
//  Usata come controllo finale intelligente: dopo aver raccolto i brani
//  candidati con le regole "fisse" (nome nell'artista, parole intere, ecc.),
//  Gemini fa un ultimo giudizio di pertinenza reale — più intelligente di
//  qualunque regola scritta a mano. Piano gratuito Google (1500 richieste al
//  giorno), nessuna carta di credito richiesta.
//  Registrati su aistudio.google.com → "Get API key" → incolla qui.
const DEFAULT_GEMINI_API_KEY = '__GEMINI_API_KEY__';
// ====================================================================

// ====================================================================
//  PLAYER CLIENTS — lista ordinata di fallback se YouTube blocca
//  Se il primo fallisce, prova il secondo, poi il terzo ecc.
const YT_PLAYER_CLIENTS = [
  'default,tv',
  'android,tv',
  'web,tv',
  'default'
];

// Controlla se yt-dlp è aggiornato all'ultima versione disponibile su GitHub
// Lo fa in background senza bloccare l'avvio — aggiorna silenziosamente
async function autoUpdateYtDlp() {
  const tp = getToolsPath();
  const ytdlpPath = path.join(tp, 'yt-dlp.exe');
  if (!fs.existsSync(ytdlpPath)) return; // se manca, scaricaYtDlp lo gestisce

  try {
    // Versione installata
    const verInstallata = await new Promise((resolve) => {
      const p = spawn(ytdlpPath, ['--version'], { windowsHide: true });
      let out = '';
      p.stdout.on('data', d => out += d.toString());
      p.on('close', () => resolve(out.trim()));
      setTimeout(() => resolve(''), 5000);
    });

    // Versione disponibile su GitHub
    const { status, json } = await httpsGetJson('https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest');
    if (status !== 200 || !json || !json.tag_name) return;

    const verOnline = json.tag_name.replace(/^v/, '');
    if (!verInstallata || verInstallata === verOnline) return;

    // C'è una versione più nuova — aggiorna silenziosamente
    if (mainWindow) mainWindow.webContents.send('download-log',
      `🔄 yt-dlp aggiornamento: ${verInstallata} → ${verOnline}...\n`);

    const asset = (json.assets || []).find(a => a.name === 'yt-dlp.exe');
    if (!asset) return;

    const tmpPath = ytdlpPath + '.tmp';
    await downloadFile(asset.browser_download_url, tmpPath, () => {});
    fs.renameSync(tmpPath, ytdlpPath);

    if (mainWindow) mainWindow.webContents.send('download-log',
      `✔ yt-dlp aggiornato a ${verOnline}\n`);
  } catch (e) {
    // Aggiornamento fallito — non bloccare l'app
  }
}

// Aggiorna spotdl.exe se su GitHub c'è una versione più recente di quella
// installata — stesso principio di autoUpdateYtDlp.
async function autoUpdateSpotdl() {
  const tp = getToolsPath();
  const spotdlPath = path.join(tp, 'spotdl.exe');
  if (!fs.existsSync(spotdlPath)) return; // se manca, scaricaSpotdl lo gestisce

  try {
    const verInstallata = await new Promise((resolve) => {
      const p = spawn(spotdlPath, ['--version'], { windowsHide: true });
      let out = '';
      p.stdout.on('data', d => out += d.toString());
      p.on('close', () => resolve(out.trim()));
      setTimeout(() => resolve(''), 5000);
    });

    const { status, json } = await httpsGetJson('https://api.github.com/repos/spotDL/spotify-downloader/releases/latest');
    if (status !== 200 || !json || !json.tag_name) return;

    const verOnline = json.tag_name.replace(/^v/, '');
    if (!verInstallata || verInstallata.includes(verOnline)) return; // già aggiornato

    if (mainWindow) mainWindow.webContents.send('download-log',
      `🔄 spotdl aggiornamento: ${verInstallata} → ${verOnline}...\n`);

    const asset = (json.assets || []).find(a => /^spotdl-.*-win32\.exe$/i.test(a.name));
    if (!asset) return;

    const tmpPath = spotdlPath + '.tmp';
    await downloadFile(asset.browser_download_url, tmpPath, () => {});
    fs.renameSync(tmpPath, spotdlPath);

    if (mainWindow) mainWindow.webContents.send('download-log',
      `✔ spotdl aggiornato a ${verOnline}\n`);
  } catch (e) {
    // Aggiornamento fallito — non bloccare l'app
  }
}

// Aggiorna deno.exe se su GitHub c'è una versione più recente di quella
// installata — stesso principio di autoUpdateYtDlp.
async function autoUpdateDeno() {
  const tp = getToolsPath();
  const denoPath = path.join(tp, 'deno.exe');
  if (!fs.existsSync(denoPath)) return; // se manca, scaricaDeno lo gestisce

  try {
    const verInstallata = await new Promise((resolve) => {
      const p = spawn(denoPath, ['--version'], { windowsHide: true });
      let out = '';
      p.stdout.on('data', d => out += d.toString());
      p.on('close', () => resolve(out.trim()));
      setTimeout(() => resolve(''), 5000);
    });
    // "deno.exe --version" stampa più righe (deno/v8/typescript): prendiamo solo
    // il numero della prima riga, es. "deno 2.1.4" -> "2.1.4"
    const verMatch = verInstallata.match(/deno\s+([\d.]+)/i);
    const verInstallataPulita = verMatch ? verMatch[1] : '';

    const { status, json } = await httpsGetJson('https://api.github.com/repos/denoland/deno/releases/latest');
    if (status !== 200 || !json || !json.tag_name) return;

    const verOnline = json.tag_name.replace(/^v/, '');
    if (!verInstallataPulita || verInstallataPulita === verOnline) return;

    if (mainWindow) mainWindow.webContents.send('download-log',
      `🔄 deno aggiornamento: ${verInstallataPulita} → ${verOnline}...\n`);

    const asset = (json.assets || []).find(a => /deno-x86_64-pc-windows-msvc\.zip$/i.test(a.name));
    if (!asset) return;

    const zipPath = denoPath + '_update.zip';
    const extractDir = path.join(tp, '_deno_update_extract');
    await downloadFile(asset.browser_download_url, zipPath, () => {});
    await extractZipWindows(zipPath, extractDir);
    const trovato = trovaFileRicorsivo(extractDir, 'deno.exe');
    if (trovato) fs.copyFileSync(trovato, denoPath);
    try { fs.rmSync(zipPath, { force: true }); fs.rmSync(extractDir, { recursive: true, force: true }); } catch(e) {}

    if (mainWindow) mainWindow.webContents.send('download-log',
      `✔ deno aggiornato a ${verOnline}\n`);
  } catch (e) {
    // Aggiornamento fallito — non bloccare l'app
  }
}

// ====================================================================
//  AGGIORNAMENTO AUTOMATICO DI SONICDOWNLOADER STESSO (solo Windows)
//  Controlla su GitHub se c'è una versione più recente di quella installata.
//  Se sì, scarica l'installer .exe dalla Release e lo avvia, chiudendo il
//  programma corrente — l'installer sovrascrive i file e riparte da solo.
//  Repository: github.com/ServiziDc/Sonic-dowloader
// ====================================================================
async function autoUpdateSonicDownloader() {
  if (process.platform !== 'win32') return; // solo Windows, come richiesto

  try {
    const verInstallata = app.getVersion(); // legge da package.json in automatico

    const { status, json } = await httpsGetJson('https://api.github.com/repos/ServiziDc/Sonic-dowloader/releases/latest');
    if (status !== 200 || !json || !json.tag_name) return; // nessuna release ancora pubblicata, o repo non raggiungibile

    const verOnline = json.tag_name.replace(/^v/, '');
    if (!verOnline || verOnline === verInstallata) return; // già aggiornato

    const asset = (json.assets || []).find(a => /\.exe$/i.test(a.name));
    if (!asset) return; // nessun installer .exe trovato in questa release

    if (mainWindow) mainWindow.webContents.send('download-log',
      `🔄 SonicDownloader: nuova versione disponibile ${verInstallata} → ${verOnline}. Scarico l'aggiornamento...\n`);

    const tmpDir = app.getPath('temp');
    const installerPath = path.join(tmpDir, `SonicDownloader-Setup-${verOnline}.exe`);
    await downloadFile(asset.browser_download_url, installerPath, (rec, tot) => {
      if (mainWindow && tot) {
        const pct = Math.round(rec / tot * 100);
        mainWindow.webContents.send('download-log', `⬇ Aggiornamento: ${pct}%\n`);
      }
    });

    if (mainWindow) mainWindow.webContents.send('download-log',
      `✔ Aggiornamento scaricato. Il programma si riavvia per installarlo...\n`);

    // Avvia l'installer in modo indipendente (staccato dal processo attuale)
    // e chiude subito dopo SonicDownloader, così l'installer può sovrascrivere
    // i file senza conflitti.
    spawn(installerPath, ['/S'], { detached: true, stdio: 'ignore' }).unref();
    setTimeout(() => app.quit(), 1500);
  } catch (e) {
    // Aggiornamento fallito — non bloccare l'app
  }
}

function getPlayerClientArgs(attempt) {
  const client = YT_PLAYER_CLIENTS[attempt % YT_PLAYER_CLIENTS.length];
  return ['--extractor-args', `youtube:player_client=${client}`];
}

// Esegue un download con retry automatico su diversi player_client
// se YouTube restituisce errori di bot/403/age-restriction
async function spawnWithRetry(buildArgs, onData, onErr, maxAttempts) {
  const tp = getToolsPath();
  maxAttempts = maxAttempts || YT_PLAYER_CLIENTS.length;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (stopRequested) return -1;
    const clientArgs = getPlayerClientArgs(attempt);
    const args = buildArgs(clientArgs);

    const code = await new Promise((resolve) => {
      currentProc = spawn(path.join(tp, 'yt-dlp.exe'), args, { windowsHide: true });
      let stderr = '';
      currentProc.stdout.on('data', onData);
      currentProc.stderr.on('data', (d) => {
        stderr += d.toString();
        if (onErr) onErr(d);
      });
      currentProc.on('close', (c) => { currentProc = null; resolve(c); });
    });

    if (stopRequested) return -1;
    if (code === 0) return 0;

    // Se errore bot/403/sign-in → prova player_client diverso
    const isYtBlock = /Sign in|bot|HTTP Error 403|age.restrict|Private video/i.test(stderr);
    if (isYtBlock && attempt < maxAttempts - 1) {
      const next = YT_PLAYER_CLIENTS[(attempt + 1) % YT_PLAYER_CLIENTS.length];
      if (mainWindow) mainWindow.webContents.send('download-log',
        `⚠ YouTube ha bloccato la richiesta — riprovo con player: ${next}...\n`);
      await new Promise(r => setTimeout(r, 2000));
      continue;
    }
    return code;
  }
  return 1;
}

let mainWindow;
let currentProc = null;
let stopRequested = false;

// Chiave da usare: prima quella scritta dall'utente nell'app, se manca
// quella incorporata qui sopra.
function resolveApiKey() {
  return (loadConfig().youtubeApiKey || '').trim() || DEFAULT_API_KEY;
}

// Chiavi Spotify da usare: prima quelle scritte dall'utente in Impostazioni,
// se mancano quelle incorporate qui sopra (DEFAULT_SPOTIFY_CLIENT_ID/SECRET).
function resolveSpotifyKeys() {
  const c = loadConfig();
  return {
    clientId: (c.spotifyClientId || '').trim() || DEFAULT_SPOTIFY_CLIENT_ID,
    clientSecret: (c.spotifyClientSecret || '').trim() || DEFAULT_SPOTIFY_CLIENT_SECRET
  };
}

function resolveLastfmKey() {
  return (loadConfig().lastfmApiKey || '').trim() || DEFAULT_LASTFM_API_KEY;
}

function resolveJamendoClientId() {
  return (loadConfig().jamendoClientId || '').trim() || DEFAULT_JAMENDO_CLIENT_ID;
}

function resolveDiscogsToken() {
  return (loadConfig().discogsToken || '').trim() || DEFAULT_DISCOGS_TOKEN;
}

function resolveGeminiKey() {
  return (loadConfig().geminiApiKey || '').trim() || DEFAULT_GEMINI_API_KEY;
}

// ---------- Configurazione persistente (chiave API YouTube) ----------
function getConfigPath() { return path.join(app.getPath('userData'), 'config.json'); }
function loadConfig() {
  try { return JSON.parse(fs.readFileSync(getConfigPath(), 'utf8')); } catch (e) { return {}; }
}
function saveConfig(cfg) {
  try { fs.writeFileSync(getConfigPath(), JSON.stringify(cfg)); return true; } catch (e) { return false; }
}
ipcMain.handle('get-api-key', () => loadConfig().youtubeApiKey || '');
ipcMain.handle('set-api-key', (_, key) => {
  const c = loadConfig();
  c.youtubeApiKey = (key || '').trim();
  return saveConfig(c);
});

ipcMain.handle('get-spotify-keys', () => {
  const c = loadConfig();
  return { clientId: c.spotifyClientId || '' }; // il secret non torna mai al frontend
});
ipcMain.handle('set-spotify-keys', (_, { clientId, clientSecret }) => {
  const c = loadConfig();
  c.spotifyClientId = (clientId || '').trim();
  c.spotifyClientSecret = (clientSecret || '').trim();
  return saveConfig(c);
});

ipcMain.handle('get-lastfm-key', () => loadConfig().lastfmApiKey || '');
ipcMain.handle('set-lastfm-key', (_, key) => {
  const c = loadConfig();
  c.lastfmApiKey = (key || '').trim();
  return saveConfig(c);
});

ipcMain.handle('get-jamendo-id', () => loadConfig().jamendoClientId || '');
ipcMain.handle('set-jamendo-id', (_, id) => {
  const c = loadConfig();
  c.jamendoClientId = (id || '').trim();
  return saveConfig(c);
});

ipcMain.handle('get-genset-fonti', () => loadConfig().gensetFonti || null);
ipcMain.handle('set-genset-fonti', (_, fonti) => {
  const c = loadConfig();
  c.gensetFonti = fonti || [];
  return saveConfig(c);
});

ipcMain.handle('get-discogs-token', () => loadConfig().discogsToken || '');
ipcMain.handle('set-discogs-token', (_, token) => {
  const c = loadConfig();
  c.discogsToken = (token || '').trim();
  return saveConfig(c);
});

ipcMain.handle('get-gemini-key', () => loadConfig().geminiApiKey || '');
ipcMain.handle('set-gemini-key', (_, key) => {
  const c = loadConfig();
  c.geminiApiKey = (key || '').trim();
  return saveConfig(c);
});

// ---------- Login YouTube via cookie (per video con verifica eta') ----------
ipcMain.handle('get-cookie-cfg', () => {
  const c = loadConfig();
  return { browser: c.cookiesBrowser || '', file: c.cookiesFile || '' };
});
ipcMain.handle('set-cookie-cfg', (_, cfg) => {
  const c = loadConfig();
  c.cookiesBrowser = (cfg && cfg.browser || '').trim();
  c.cookiesFile = (cfg && cfg.file || '').trim();
  return saveConfig(c);
});
ipcMain.handle('choose-cookie-file', async () => {
  const r = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'Cookies', extensions: ['txt'] }, { name: 'Tutti i file', extensions: ['*'] }]
  });
  return r.canceled ? null : r.filePaths[0];
});

// Trova spotdl con qualsiasi nome (spotdl.exe oppure spotdl-4.5.0-win32.exe ecc.)
function findSpotdl(tp) {
  try {
    const direct = path.join(tp, 'spotdl.exe');
    if (fs.existsSync(direct)) return direct;
    const files = fs.readdirSync(tp);
    const match = files.find(f => /^spotdl.*\.exe$/i.test(f));
    return match ? path.join(tp, match) : null;
  } catch (e) { return null; }
}

// Restituisce gli argomenti yt-dlp per il login (file cookies.txt o browser)
function getCookieArgs() {
  const c = loadConfig();
  // Priorità: file cookies.txt (stabile) > browser (spesso dà Permission denied)
  if (c.cookiesFile && fs.existsSync(c.cookiesFile)) return ['--cookies', c.cookiesFile];
  // Browser solo se nessun file configurato (e a rischio errore se il browser è aperto)
  if (c.cookiesBrowser) return ['--cookies-from-browser', c.cookiesBrowser];
  return [];
}

// Esporta i cookie della sessione di login (persist:yt-login) in un file
// Netscape cookies.txt e lo registra nella config. Usato dal login E dal
// browser YouTube Music interno (così quando scarichi da lì, sei già loggato).
async function exportYtCookies(cookieSavePath) {
  const loginSession = session.fromPartition('persist:yt-login', { cache: false });
  const all = await loginSession.cookies.get({});
  const combined = all.filter(c => /(^|\.)youtube\.com$|(^|\.)google\.com$/.test(c.domain));
  if (!combined.length) return { ok: false, count: 0 };
  const lines = ['# Netscape HTTP Cookie File', '# Saved by SonicDownloader', ''];
  combined.forEach(c => {
    const includeSub = c.domain.startsWith('.') ? 'TRUE' : 'FALSE';
    const secure = c.secure ? 'TRUE' : 'FALSE';
    const expires = c.session ? '0' : (c.expirationDate ? Math.floor(c.expirationDate) : '0');
    lines.push(`${c.domain}\t${includeSub}\t${c.path || '/'}\t${secure}\t${expires}\t${c.name}\t${c.value}`);
  });
  try {
    fs.writeFileSync(cookieSavePath, lines.join('\n') + '\n', 'utf8');
    const cfg = loadConfig();
    cfg.cookiesFile = cookieSavePath;
    cfg.cookiesBrowser = '';
    saveConfig(cfg);
    return { ok: true, count: combined.length };
  } catch (e) {
    return { ok: false, count: 0, reason: e.message };
  }
}

// Aggiorna il file cookie dalla sessione attuale (chiamato dal browser interno)
ipcMain.handle('sync-cookies', async () => {
  const p = path.join(app.getPath('userData'), 'yt_cookies.txt');
  return exportYtCookies(p);
});

// Estrae l'ID della playlist dal link (?list=XXXX)
function extractPlaylistId(url) {
  const m = String(url).match(/[?&]list=([^&]+)/);
  return m ? m[1] : null;
}

// ID utilizzabile dalla YouTube Data API (toglie il prefisso "VL" di YouTube Music)
function apiPlaylistId(raw) {
  if (!raw) return raw;
  return raw.startsWith('VL') ? raw.slice(2) : raw;
}

// Rileva se il link è un singolo video (watch?v=... senza lista)
function isSingleVideo(url) {
  const s = String(url);
  const hasVideo = /[?&]v=([^&]+)/.test(s) || /youtu\.be\/([^?&]+)/.test(s);
  // start_radio=1 genera una radio automatica — trattalo come singolo
  const isRadio = /[?&]start_radio=1/.test(s);
  const hasList = /[?&]list=/.test(s) && !isRadio;
  return hasVideo && (!hasList || isRadio);
}

// Rileva la piattaforma dal link
function detectPlatform(url) {
  const s = String(url).toLowerCase();
  if (s.includes('soundcloud.com')) return 'soundcloud';
  if (s.includes('spotify.com') || s.startsWith('spotify:')) return 'spotify';
  return 'youtube';
}


// Scarica UN singolo video
function downloadSingle(tp, url, destFolder, format) {
  return new Promise((resolve) => {
    let downloadStarted = false;
    let attempt = 0;
    let stderrBuf = '';

    // Snapshot dei file presenti PRIMA del download
    let filesBefore = new Set();
    try {
      fs.readdirSync(destFolder).forEach(f => filesBefore.add(f));
    } catch(e) {}

    function tryDownload() {
      if (stopRequested) return resolve(-1);
      stderrBuf = '';
      const clientArgs = getPlayerClientArgs(attempt);
      const args = [
        '-x', '--audio-format', format,
        '--ffmpeg-location', path.join(tp, 'ffmpeg.exe'),
        '--js-runtimes', `deno:${path.join(tp, 'deno.exe')}`,
        ...getCookieArgs(),
        ...clientArgs,
        '--no-playlist',
        '--output', path.join(destFolder, '%(title)s.%(ext)s'),
        '--retries', '5', '--fragment-retries', '5',
        '--print', 'before_dl:DLSTART|||%(id)s|||%(title)s',
        '--newline',
        '--no-warnings',
        url
      ];
      currentProc = spawn(path.join(tp, 'yt-dlp.exe'), args, { windowsHide: true });
      currentProc.stdout.on('data', async (d) => {
        const lines = d.toString().split('\n');
        for (const line of lines) {
          const t = line.trim();
          if (t.startsWith('DLSTART|||')) {
            downloadStarted = true;
            const parts = t.split('|||');
            const videoId = parts[1] ? parts[1].trim() : '';
            const title = parts[2] ? parts[2].trim() : '';
            mainWindow.webContents.send('now-playing', { videoId, title, index: '', thumb: null });
            const thumb = await fetchThumbnail(videoId);
            if (thumb) mainWindow.webContents.send('now-playing', { videoId, title, index: '', thumb });
          } else if (t) {
            mainWindow.webContents.send('download-log', line + '\n');
          }
        }
      });
      currentProc.stderr.on('data', d => {
        const msg = d.toString();
        stderrBuf += msg;
        if (msg.includes('Could not copy') || msg.includes('PermissionError') || msg.includes('PYI-')) return;
        mainWindow.webContents.send('download-log', msg);
      });
      currentProc.on('close', code => {
        currentProc = null;
        if (stopRequested) return resolve(-1);

        // Controlla se è apparso un file nuovo nella cartella
        let filesAfter = [];
        try { filesAfter = fs.readdirSync(destFolder); } catch(e) {}
        const audioExts = ['.wav','.mp3','.flac','.aac','.opus','.m4a','.ogg','.webm'];
        const newFile = filesAfter.find(f => !filesBefore.has(f) && audioExts.some(e => f.toLowerCase().endsWith(e)));

        if (newFile) {
          mainWindow.webContents.send('download-log', `✔ Salvato: ${newFile}\n`);
          return resolve(0);
        }

        // Se YouTube ha bloccato la richiesta (403/bot/sign-in) → riprova con un player diverso
        const isBlocked = /Sign in|bot|HTTP Error 403|age.restrict|Precondition/i.test(stderrBuf);
        if (!downloadStarted && isBlocked && attempt < YT_PLAYER_CLIENTS.length - 1) {
          attempt++;
          const next = YT_PLAYER_CLIENTS[attempt];
          mainWindow.webContents.send('download-log',
            `⚠ YouTube ha bloccato la richiesta — riprovo con player: ${next}...\n`);
          setTimeout(tryDownload, 2000);
          return;
        }

        if (!downloadStarted) return resolve(2); // non partito (link errato, no cookie)
        return resolve(code !== 0 ? code : 1);   // partito ma fallito
      });
    }

    tryDownload();
  });
}

// ============================================================
// SOUNDCLOUD — yt-dlp lo supporta nativamente (tracce e set/playlist)
// ============================================================
function downloadSoundCloud(tp, url, destFolder, format, archiveFile) {
  return new Promise((resolve) => {
    if (stopRequested) return resolve(-1);
    const args = [
      '-x', '--audio-format', format,
      '--ffmpeg-location', path.join(tp, 'ffmpeg.exe'),
      '--output', path.join(destFolder, '%(title)s.%(ext)s'),
      '--download-archive', archiveFile,
      '--yes-playlist',
      '--ignore-errors', '--no-abort-on-error',
      '--retries', '5', '--fragment-retries', '5',
      '--print', 'before_dl:%(id)s|||%(title)s|||%(playlist_index)s',
      '--newline', '--no-warnings',
      url
    ];
    currentProc = spawn(path.join(tp, 'yt-dlp.exe'), args, { windowsHide: true });
    let total = 0;
    currentProc.stdout.on('data', async (d) => {
      const lines = d.toString().split('\n');
      for (const line of lines) {
        if (line.includes('|||')) {
          const parts = line.trim().split('|||');
          const videoId = parts[0].trim();
          const title = parts[1] ? parts[1].trim() : '';
          const idx = parts[2] ? parts[2].trim() : '';
          mainWindow.webContents.send('now-playing', { videoId, title, index: idx || '', thumb: null });
        } else {
          const mt = line.match(/Downloading item (\d+) of (\d+)/);
          if (mt) { total = parseInt(mt[2]); mainWindow.webContents.send('download-block', { start: parseInt(mt[1]), end: parseInt(mt[1]), total }); }
          mainWindow.webContents.send('download-log', line + '\n');
        }
      }
    });
    currentProc.stderr.on('data', d => mainWindow.webContents.send('download-log', d.toString()));
    currentProc.on('close', c => { currentProc = null; resolve(stopRequested ? -1 : c); });
  });
}

// ============================================================
// SPOTIFY — via spotdl.exe (cerca i brani su YouTube e li scarica)
// ============================================================
function downloadSpotify(tp, url, destFolder, format) {
  return new Promise((resolve) => {
    if (stopRequested) return resolve(-1);
    const spotdl = findSpotdl(tp);
    if (!spotdl) {
      mainWindow.webContents.send('download-log', '❌ spotdl non trovato nella cartella tools\\.\n');
      mainWindow.webContents.send('download-log', '   Mettici spotdl.exe (o spotdl-X.X.X-win32.exe) insieme a yt-dlp.exe.\n');
      return resolve(2);
    }
    // spotdl supporta: mp3, flac, ogg, opus, m4a, wav (aac -> m4a)
    const spFormat = (format === 'aac') ? 'm4a' : format;
    const args = [
      'download', url,
      '--output', destFolder,
      '--format', spFormat,
      '--ffmpeg', path.join(tp, 'ffmpeg.exe'),
      '--threads', '4'
    ];
    currentProc = spawn(spotdl, args, { windowsHide: true });
    let total = 0, done = 0;
    const handle = (s) => {
      const lines = s.split('\n');
      for (const line of lines) {
        if (!line.trim()) continue;
        const mFound = line.match(/Found (\d+) songs/i);
        if (mFound) { total = parseInt(mFound[1]); mainWindow.webContents.send('download-block', { start: 0, end: 0, total }); }
        const mDl = line.match(/Downloaded "([^"]+)"/);
        if (mDl) {
          done++;
          mainWindow.webContents.send('now-playing', { videoId: '', title: mDl[1], index: String(done), thumb: null });
          if (total) mainWindow.webContents.send('download-block', { start: done, end: done, total });
        }
        mainWindow.webContents.send('download-log', line + '\n');
      }
    };
    currentProc.stdout.on('data', d => handle(d.toString()));
    currentProc.stderr.on('data', d => handle(d.toString()));
    currentProc.on('close', c => { currentProc = null; resolve(stopRequested ? -1 : c); });
  });
}

// ============================================================
// LOGIN YOUTUBE — apre browser embedded, salva cookie automaticamente
// ============================================================
let loginWindow = null;

async function loginYouTube(cookieSavePath) {
  return new Promise((resolve) => {
    if (loginWindow) { loginWindow.focus(); return resolve({ ok: false, reason: 'already_open' }); }

    // Usa una sessione dedicata e persistente per il login
    const loginSession = session.fromPartition('persist:yt-login', { cache: false });

    loginWindow = new BrowserWindow({
      width: 520,
      height: 680,
      title: 'Accedi a YouTube',
      icon: path.join(__dirname, 'icon.ico'),
      autoHideMenuBar: true,
      webPreferences: {
        session: loginSession,
        nodeIntegration: false,
        contextIsolation: true,
      }
    });

    // Apriamo direttamente YouTube: l'utente clicca "Accedi", fa il login Google
    // e viene riportato su youtube.com gia' loggato (cosi' TUTTI i cookie youtube
    // vengono impostati correttamente).
    loginWindow.loadURL('https://www.youtube.com/');

    let captured = false;
    // Controlla ogni 2s se l'utente e' loggato (cookie di sessione presente)
    const checkInterval = setInterval(async () => {
      if (captured) return;
      try {
        const ytCookies = await loginSession.cookies.get({ domain: '.youtube.com' });
        const gCookies  = await loginSession.cookies.get({ domain: '.google.com' });
        const loggedIn =
          ytCookies.some(c => c.name === '__Secure-3PSID' || c.name === 'SID' || c.name === 'SAPISID') ||
          gCookies.some(c => c.name === '__Secure-3PSID' || c.name === 'SAPISID');
        if (!loggedIn) return;

        captured = true;
        clearInterval(checkInterval);

        // Assicuriamoci che i cookie di youtube.com siano impostati:
        // carichiamo youtube.com e aspettiamo un attimo prima di catturare.
        try { await loginWindow.loadURL('https://www.youtube.com/'); } catch(e) {}
        await new Promise(r => setTimeout(r, 2500));

        // Prendiamo TUTTI i cookie della sessione e teniamo quelli di youtube/google
        const allCookies = await loginSession.cookies.get({});
        const combined = allCookies.filter(c => /(^|\.)youtube\.com$|(^|\.)google\.com$/.test(c.domain));

        const lines = ['# Netscape HTTP Cookie File', '# Saved by SonicDownloader', ''];
        combined.forEach(c => {
          const includeSub = c.domain.startsWith('.') ? 'TRUE' : 'FALSE';
          const secure = c.secure ? 'TRUE' : 'FALSE';
          const expires = c.session ? '0' : (c.expirationDate ? Math.floor(c.expirationDate) : '0');
          lines.push(`${c.domain}\t${includeSub}\t${c.path || '/'}\t${secure}\t${expires}\t${c.name}\t${c.value}`);
        });
        const cookieText = lines.join('\n') + '\n';
        try {
          fs.writeFileSync(cookieSavePath, cookieText, 'utf8');
          const cfg = loadConfig();
          cfg.cookiesFile = cookieSavePath;
          cfg.cookiesBrowser = '';
          saveConfig(cfg);
          mainWindow.webContents.send('login-done', { ok: true, path: cookieSavePath, count: combined.length });
        } catch(e) {
          mainWindow.webContents.send('login-done', { ok: false, reason: e.message });
        }
        if (loginWindow) loginWindow.close();
      } catch(e) {}
    }, 2000);

    loginWindow.on('closed', () => {
      clearInterval(checkInterval);
      loginWindow = null;
      resolve({ ok: true });
    });
  });
}

ipcMain.handle('youtube-login', async () => {
  const cookiePath = path.join(app.getPath('userData'), 'yt_cookies.txt');
  return loginYouTube(cookiePath);
});

ipcMain.handle('youtube-logout', async () => {
  try {
    const loginSession = session.fromPartition('persist:yt-login', { cache: false });
    await loginSession.clearStorageData();
    const cfg = loadConfig();
    cfg.cookiesFile = '';
    cfg.cookiesBrowser = '';
    saveConfig(cfg);
    const cookiePath = path.join(app.getPath('userData'), 'yt_cookies.txt');
    if (fs.existsSync(cookiePath)) fs.unlinkSync(cookiePath);
    return { ok: true };
  } catch(e) {
    return { ok: false, reason: e.message };
  }
});

ipcMain.handle('youtube-check-login', async () => {
  try {
    const loginSession = session.fromPartition('persist:yt-login', { cache: false });
    const cookies = await loginSession.cookies.get({ domain: '.youtube.com' });
    const loggedIn = cookies.some(c => c.name === '__Secure-3PSID' || c.name === 'SID');
    return { loggedIn };
  } catch(e) {
    return { loggedIn: false };
  }
});

// Chiamata GET che ritorna JSON
function httpsGetJson(url) {
  return new Promise((resolve) => {
    https.get(url, { headers: { 'User-Agent': 'SonicDownloader' } }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, json: JSON.parse(data) }); }
        catch (e) { resolve({ status: res.statusCode, json: null }); }
      });
    }).on('error', () => resolve({ status: 0, json: null }));
  });
}

// Ottiene la LISTA COMPLETA di video ID dalla API ufficiale di YouTube
// (nessun limite a 100/200: pagina pulita a blocchi di 50)
async function getPlaylistViaApi(apiKey, playlistId) {
  const ids = [];
  let pageToken = '';
  for (let guard = 0; guard < 2000; guard++) { // fino a 100.000 brani
    // Controlla stop ad ogni pagina
    if (stopRequested) return { ok: false, error: 'interrotto', ids };
    const url = 'https://www.googleapis.com/youtube/v3/playlistItems'
      + '?part=contentDetails&maxResults=50'
      + '&playlistId=' + encodeURIComponent(playlistId)
      + '&key=' + encodeURIComponent(apiKey)
      + (pageToken ? '&pageToken=' + pageToken : '');
    const { status, json } = await httpsGetJson(url);
    if (status !== 200 || !json) {
      const reason = (json && json.error && json.error.message) ? json.error.message : ('HTTP ' + status);
      return { ok: false, error: reason, ids };
    }
    (json.items || []).forEach(it => {
      const vid = it.contentDetails && it.contentDetails.videoId;
      if (vid) ids.push(vid);
    });
    mainWindow.webContents.send('download-log', `📋 Lista ufficiale: ${ids.length} brani...\n`);
    pageToken = json.nextPageToken || '';
    if (!pageToken) break;
  }
  return { ok: true, ids };
}

// Scarica i brani UNO A UNO dai link diretti (bypassa il bug della playlist)
async function downloadByIds(tp, ids, destFolder, format, archiveFile, numeraFile) {
  const total = ids.length;
  for (let i = 0; i < total; i++) {
    if (stopRequested) return -1;
    const n = i + 1;
    const num = String(n).padStart(3, '0');
    const videoId0 = ids[i];
    const videoUrl = `https://www.youtube.com/watch?v=${videoId0}`;

    mainWindow.webContents.send('download-block', { start: n, end: n, total });

    let dlmgrTitle = '';
    let dlmgrDone = false;

    // L'ID lo abbiamo già dalla lista stessa: recuperiamo la miniatura subito,
    // senza aspettare l'output di yt-dlp. Se il brano è già in archivio (skip
    // veloce), yt-dlp non stampa mai la riga "before_dl" — così l'immagine
    // comparirebbe sempre vuota anche per un download riuscito.
    const dlmgrThumb = await fetchThumbnail(videoId0);
    dlmgrSend('dlmgr-item-start', { index: String(n), title: videoUrl, thumb: dlmgrThumb });

    await new Promise((resolve) => {
      const args = [
        '-x', '--audio-format', format,
        '--ffmpeg-location', path.join(tp, 'ffmpeg.exe'),
        '--js-runtimes', `deno:${path.join(tp, 'deno.exe')}`,
        ...getCookieArgs(),
        '--extractor-args', 'youtube:player_client=default,tv',
        '--output', outputTemplate(destFolder, numeraFile, num),
        '--download-archive', archiveFile,
        '--no-playlist',
        '--ignore-errors', '--no-abort-on-error',
        '--retries', '5', '--fragment-retries', '5',
        '--print', 'before_dl:%(id)s|||%(title)s',
        '--print', 'after_move:donefile:%(filepath)s',
        '--newline',
        '--no-warnings',
        videoUrl
      ];
      currentProc = spawn(path.join(tp, 'yt-dlp.exe'), args, { windowsHide: true });
      let stdoutLineBuf = '';
      currentProc.stdout.on('data', (d) => {
        stdoutLineBuf += d.toString();
        const parts0 = stdoutLineBuf.split('\n');
        stdoutLineBuf = parts0.pop();
        for (const line of parts0) {
          if (line.startsWith('donefile:')) {
            const finalPath = line.slice('donefile:'.length).trim();
            if (!dlmgrDone) {
              dlmgrDone = true;
              let sizeBytes = 0;
              try { sizeBytes = fs.statSync(finalPath).size; } catch(e) {}
              dlmgrSend('dlmgr-item-done', { index: String(n), title: dlmgrTitle || videoUrl, thumb: dlmgrThumb, sizeBytes, format, source: 'YouTube' });
            }
          } else if (line.includes('|||')) {
            const parts = line.trim().split('|||');
            const videoId = parts[0].trim();
            const title = parts[1] ? parts[1].trim() : '';
            dlmgrTitle = title || dlmgrTitle;
            mainWindow.webContents.send('now-playing', { videoId, title, index: String(n), thumb: dlmgrThumb });
            // Titolo vero trovato: aggiorna la scheda (la miniatura era già
            // stata mandata subito, la teniamo così com'è).
            dlmgrSend('dlmgr-item-start', { index: String(n), title: dlmgrTitle, thumb: dlmgrThumb });
          } else {
            mainWindow.webContents.send('download-log', line + '\n');
          }
        }
      });
      currentProc.stderr.on('data', d => mainWindow.webContents.send('download-log', d.toString()));
      currentProc.on('close', c => {
        currentProc = null;
        // Rete di sicurezza: se after_move non è arrivato ma il processo è
        // finito (es. brano già in archivio, skippato velocemente), segna
        // comunque il brano come fatto/errore — la miniatura era già stata
        // mandata subito all'inizio, quindi resta visibile in ogni caso.
        if (!dlmgrDone) {
          dlmgrSend('dlmgr-item-done', c === 0
            ? { index: String(n), title: dlmgrTitle || videoUrl, thumb: dlmgrThumb, format, source: 'YouTube' }
            : { index: String(n), title: dlmgrTitle || videoUrl, thumb: dlmgrThumb, format, error: 'download fallito' });
        }
        resolve(c);
      });
    });
    if (stopRequested) return -1;
  }
  return 0;
}


// ============================================================
// RICERCA DA LISTA TESTO — trova il video vero per ogni titolo
// ============================================================

// Cerca UN titolo tramite la YouTube Data API (veloce, preciso)
async function searchYoutubeApi(apiKey, query) {
  const url = 'https://www.googleapis.com/youtube/v3/search'
    + '?part=snippet&type=video&maxResults=1'
    + '&q=' + encodeURIComponent(query)
    + '&key=' + encodeURIComponent(apiKey);
  const { status, json } = await httpsGetJson(url);
  if (status !== 200 || !json || json.error) {
    const reason = (json && json.error && json.error.message) ? json.error.message : ('HTTP ' + status);
    return { ok: false, error: reason };
  }
  const item = json.items && json.items[0];
  if (!item) return { ok: false, error: 'nessun risultato' };
  return {
    ok: true,
    id: item.id.videoId,
    title: item.snippet.title,
    thumb: item.snippet.thumbnails && (item.snippet.thumbnails.default || {}).url
  };
}

// Fallback: cerca tramite yt-dlp (niente quota API, ma più lento)
// Verifica che il titolo trovato corrisponda davvero a quello cercato, e non solo
// alla canzone "base" ignorando remix/live/refix/edit indicati tra parentesi.
// Es: cerchi "Faded (AniMe Refix)" -> NON deve accettare "Faded" originale.
function estraiQualificatori(testo) {
  const t = (testo || '').toLowerCase();
  const qualificatori = [];
  // Tutto quello tra parentesi tonde o quadre: (Remix), [Live], (AniMe Refix)...
  const matchParentesi = t.match(/[\(\[]([^\)\]]+)[\)\]]/g) || [];
  matchParentesi.forEach(m => qualificatori.push(m.replace(/[\(\)\[\]]/g, '').trim()));
  // Parole chiave di versione anche senza parentesi (es. "Faded Live at...")
  const keywordVersione = ['remix','refix','bootleg','mashup','live','vip','edit','flip','rework','cover','acoustic','extended','radio edit','instrumental'];
  keywordVersione.forEach(k => { if (t.includes(k)) qualificatori.push(k); });
  return [...new Set(qualificatori)];
}

function titoliCorrispondono(query, titoloTrovato) {
  const qualQuery = estraiQualificatori(query);
  if (qualQuery.length === 0) return true; // nessuna versione specifica richiesta, va bene qualunque risultato
  const titoloL = (titoloTrovato || '').toLowerCase();
  // Basta che il titolo trovato contenga ALMENO uno dei qualificatori della richiesta
  // (tollerante verso piccole differenze di scrittura tra chi carica i video)
  return qualQuery.some(q => titoloL.includes(q));
}

function searchYoutubeYtdlp(tp, query, tentativo) {
  tentativo = tentativo || 1;
  return new Promise((resolve) => {
    const proc = spawn(path.join(tp, 'yt-dlp.exe'), [
      `ytsearch5:${query}`,
      '--flat-playlist',
      '--print', '%(id)s|||%(title)s',
      '--js-runtimes', `deno:${path.join(tp, 'deno.exe')}`,
      '--extractor-args', 'youtube:player_client=default,tv',
      ...getCookieArgs(),
      '--no-warnings'
    ], { windowsHide: true });
    let out = '';
    proc.stdout.on('data', d => out += d.toString());
    proc.on('close', async () => {
      const righe = out.trim().split('\n').filter(l => l.includes('|||'));
      if (righe.length === 0) {
        if (tentativo < 2) {
          await new Promise(r => setTimeout(r, 1200));
          return resolve(await searchYoutubeYtdlp(tp, query, tentativo + 1));
        }
        return resolve({ ok: false, error: 'nessun risultato' });
      }
      // Cerca tra i primi risultati quello che rispetta i qualificatori (remix/live/refix/...)
      // richiesti nella query, invece di prendere ciecamente il primo.
      let scelto = null;
      for (const riga of righe) {
        const [id, title] = riga.split('|||');
        if (titoliCorrispondono(query, title)) { scelto = { id: id.trim(), title: (title||'').trim() }; break; }
      }
      if (!scelto) {
        // Nessuno dei risultati rispetta la versione richiesta (es. "Refix"/"Live"):
        // meglio dire "non trovato" che scaricare la canzone sbagliata spacciandola per quella giusta.
        return resolve({ ok: false, error: 'versione esatta non trovata (solo risultati diversi da quella richiesta)' });
      }
      resolve({ ok: true, id: scelto.id, title: scelto.title, thumb: null });
    });
    setTimeout(() => { try { proc.kill(); } catch (e) {} resolve({ ok: false, error: 'timeout' }); }, 25000);
  });
}

// Ricerca su SoundCloud (fallback n.2)
// Controlla velocemente (senza scaricare nulla) se una traccia SoundCloud è
// protetta da DRM/a pagamento, prima di accettarla in un risultato di ricerca.
// ── Deezer: scoperta metadati precisi (artista/titolo/data uscita reale) ──
// API pubblica gratuita, nessuna chiave richiesta.
function httpsGetJsonSimple(url) {
  return new Promise((resolve) => {
    https.get(url, { headers: { 'User-Agent': 'SonicDownloader' } }, (res) => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch(e) { resolve(null); }
      });
    }).on('error', () => resolve(null));
  });
}

async function deezerTrovaGenereId(nomeGenere) {
  const data = await httpsGetJsonSimple('https://api.deezer.com/genre');
  if (!data || !data.data) return null;
  const nomeNorm = normalizzaTitoloPerConfronto(nomeGenere);
  let match = data.data.find(g => normalizzaTitoloPerConfronto(g.name) === nomeNorm);
  if (!match) match = data.data.find(g => normalizzaTitoloPerConfronto(g.name).includes(nomeNorm) || nomeNorm.includes(normalizzaTitoloPerConfronto(g.name)));
  return match ? match.id : null;
}

async function deezerTracceGenere(nomeGenere, limit) {
  const genereId = await deezerTrovaGenereId(nomeGenere);
  if (!genereId) return [];
  const data = await httpsGetJsonSimple(`https://api.deezer.com/chart/${genereId}/tracks?limit=${limit || 30}`);
  if (!data || !data.data) return [];
  return data.data.map(t => ({ artist: t.artist?.name || '', title: t.title || '', fonte: 'Deezer' })).filter(t => t.artist && t.title);
}

async function deezerTracceArtista(nomeArtista, limit) {
  const q = encodeURIComponent(`artist:"${nomeArtista}"`);
  const data = await httpsGetJsonSimple(`https://api.deezer.com/search/track?q=${q}&limit=${limit || 20}`);
  if (!data || !data.data) return [];
  return data.data.map(t => ({ artist: t.artist?.name || '', title: t.title || '', fonte: 'Deezer' })).filter(t => titoloPlausibile(t.artist, t.title));
}

// ── Apple Music: scoperta metadati precisi (iTunes Search API, gratis, nessuna chiave) ──
async function appleMusicTracceArtista(nomeArtista, annoDa, annoA, limit) {
  const q = encodeURIComponent(nomeArtista);
  const data = await httpsGetJsonSimple(`https://itunes.apple.com/search?term=${q}&media=music&entity=song&limit=${limit || 20}`);
  if (!data || !data.results) return [];
  return data.results
    .map(t => {
      const anno = t.releaseDate ? parseInt(t.releaseDate.slice(0, 4)) : null;
      return { artist: t.artistName || '', title: t.trackName || '', anno, fonte: 'Apple Music' };
    })
    .filter(t => titoloPlausibile(t.artist, t.title) && (!t.anno || !annoDa || !annoA || (t.anno >= annoDa && t.anno <= annoA)));
}

async function appleMusicTracceGenere(genere, annoDa, annoA, limit) {
  const q = encodeURIComponent(genere);
  const data = await httpsGetJsonSimple(`https://itunes.apple.com/search?term=${q}&media=music&entity=song&limit=${limit || 30}`);
  if (!data || !data.results) return [];
  return data.results
    .map(t => {
      const anno = t.releaseDate ? parseInt(t.releaseDate.slice(0, 4)) : null;
      return { artist: t.artistName || '', title: t.trackName || '', anno, fonte: 'Apple Music' };
    })
    .filter(t => titoloPlausibile(t.artist, t.title) && (!t.anno || !annoDa || !annoA || (t.anno >= annoDa && t.anno <= annoA)));
}

// ── MusicBrainz: scoperta metadati precisi (database aperto, gratis, nessuna chiave) ──
// Richiede uno User-Agent identificativo per policy del progetto (non serve registrazione).
function musicbrainzGetJson(url) {
  return new Promise((resolve) => {
    https.get(url, { headers: { 'User-Agent': 'SonicDownloader/1.0 (desktop app)' } }, (res) => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch(e) { resolve(null); } });
    }).on('error', () => resolve(null));
  });
}

async function musicbrainzTracceArtista(nomeArtista, limit) {
  const q = encodeURIComponent(`artist:"${nomeArtista}"`);
  const data = await musicbrainzGetJson(`https://musicbrainz.org/ws/2/recording/?query=${q}&fmt=json&limit=${limit || 15}`);
  if (!data || !data.recordings) return [];
  return data.recordings.map(r => ({
    artist: r['artist-credit']?.[0]?.name || '',
    title: r.title || '',
    fonte: 'MusicBrainz'
  })).filter(t => titoloPlausibile(t.artist, t.title));
}

// ── Audius: piattaforma decentralizzata, brani REALMENTE scaricabili gratis ──
// API pubblica ufficiale, nessuna registrazione richiesta (solo un "app_name" libero).
async function audiusTracceRicerca(query, limit) {
  const data = await httpsGetJsonSimple(`https://discoveryprovider.audius.co/v1/tracks/search?query=${encodeURIComponent(query)}&app_name=SonicDownloader&limit=${limit || 15}`);
  const tracce = data?.data;
  if (!tracce || !Array.isArray(tracce)) return [];
  return tracce.map(t => ({
    artist: t.user?.name || t.user?.handle || '',
    title: t.title || '',
    trackId: t.id,
    duration: t.duration || 0,
    fonte: 'Audius'
  })).filter(t => titoloPlausibile(t.artist, t.title) && t.trackId);
}
function audiusUrlStream(trackId) {
  return `https://discoveryprovider.audius.co/v1/tracks/${trackId}/stream?app_name=SonicDownloader`;
}

// ── Internet Archive: brani REALMENTE scaricabili gratis (pubblico dominio/CC) ──
// API pubblica, nessuna chiave richiesta.
async function internetArchiveTracceRicerca(query, limit) {
  const q = encodeURIComponent(`${query} AND mediatype:audio`);
  const data = await httpsGetJsonSimple(`https://archive.org/advancedsearch.php?q=${q}&fl[]=identifier&fl[]=title&fl[]=creator&rows=${limit || 10}&output=json`);
  const docs = data?.response?.docs;
  if (!docs || !Array.isArray(docs)) return [];
  const risultati = [];
  for (const doc of docs) {
    // Per ogni item, recupera l'elenco dei file per trovare quello audio scaricabile
    const meta = await httpsGetJsonSimple(`https://archive.org/metadata/${doc.identifier}`);
    const file = meta?.files?.find(f => /\.(mp3|ogg|flac)$/i.test(f.name || ''));
    if (!file) continue;
    const artistaTrovato = doc.creator || 'Internet Archive';
    const titoloTrovato = doc.title || doc.identifier;
    if (!titoloPlausibile(artistaTrovato, titoloTrovato)) continue;
    risultati.push({
      artist: artistaTrovato,
      title: titoloTrovato,
      audioUrl: `https://archive.org/download/${doc.identifier}/${encodeURIComponent(file.name)}`,
      fonte: 'Internet Archive'
    });
    if (risultati.length >= (limit || 10)) break;
  }
  return risultati;
}

// ── Discogs: scoperta metadati precisi (richiede un token personale gratuito) ──
async function discogsTracceArtista(token, nomeArtista, limit) {
  const url = `https://api.discogs.com/database/search?q=${encodeURIComponent(nomeArtista)}&type=release&per_page=${limit || 15}&token=${token}`;
  const data = await httpsGetJsonSimple(url);
  if (!data || !data.results) return [];
  const risultati = [];
  for (const r of data.results) {
    const raw = (r.title || '').trim();
    const parti = raw.split(' - ').map(p => p.trim()).filter(Boolean);
    // Accettiamo SOLO il formato pulito "Artista - Titolo" (esattamente 2 parti):
    // Discogs cerca tra le release (album/EP/vinili), e quando il titolo ha più
    // segmenti è quasi sempre un titolo complesso (info di formato/etichetta/tag
    // di genere concatenati) che genererebbe un titolo spezzettato senza senso.
    if (parti.length !== 2) continue;
    const [artistaTrovato, titoloTrovato] = parti;
    if (/^various/i.test(artistaTrovato)) continue; // compilation "Various Artists", non un singolo DJ
    if (!titoloPlausibile(artistaTrovato, titoloTrovato)) continue;
    risultati.push({ artist: artistaTrovato, title: titoloTrovato, fonte: 'Discogs' });
    if (risultati.length >= (limit || 15)) break;
  }
  return risultati;
}

// ── Spotify: scoperta metadati precisi (richiede Client ID/Secret gratuiti dell'utente) ──
async function spotifyOttieniToken(clientId, clientSecret) {
  return new Promise((resolve) => {
    const bodyStr = 'grant_type=client_credentials';
    const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const req = https.request('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(bodyStr)
      }
    }, (res) => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          resolve(parsed.access_token || null);
        } catch(e) { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.write(bodyStr);
    req.end();
  });
}

function spotifyGetJson(url, token) {
  return new Promise((resolve) => {
    https.get(url, { headers: { 'Authorization': `Bearer ${token}` } }, (res) => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch(e) { resolve(null); }
      });
    }).on('error', () => resolve(null));
  });
}

async function spotifyTracceArtista(token, nomeArtista, annoDa, annoA, limit) {
  const q = encodeURIComponent(`artist:"${nomeArtista}"`);
  const data = await spotifyGetJson(`https://api.spotify.com/v1/search?q=${q}&type=track&limit=${limit || 20}`, token);
  if (!data || !data.tracks || !data.tracks.items) return [];
  return data.tracks.items
    .map(t => {
      const annoUscita = t.album?.release_date ? parseInt(t.album.release_date.slice(0, 4)) : null;
      return { artist: t.artists?.[0]?.name || '', title: t.name || '', anno: annoUscita, fonte: 'Spotify' };
    })
    .filter(t => titoloPlausibile(t.artist, t.title) && (!t.anno || !annoDa || !annoA || (t.anno >= annoDa && t.anno <= annoA)));
}

async function spotifyTracceGenere(token, nomeGenere, annoDa, annoA, limit) {
  const yearFilter = (annoDa && annoA) ? ` year:${annoDa}-${annoA}` : '';
  const q = encodeURIComponent(`genre:"${nomeGenere}"${yearFilter}`);
  const data = await spotifyGetJson(`https://api.spotify.com/v1/search?q=${q}&type=track&limit=${limit || 30}`, token);
  if (!data || !data.tracks || !data.tracks.items) return [];
  return data.tracks.items
    .map(t => {
      const annoUscita = t.album?.release_date ? parseInt(t.album.release_date.slice(0, 4)) : null;
      return { artist: t.artists?.[0]?.name || '', title: t.name || '', anno: annoUscita, fonte: 'Spotify' };
    })
    .filter(t => titoloPlausibile(t.artist, t.title));
}

// ── Last.fm: scoperta precisa dei brani/artisti più rilevanti per un tag/genere ──
// Molto più affidabile del metodo "conta chi carica di più su YouTube": usa dati
// veri di ascolto della community, ottimo per generi elettronici di nicchia
// (techno, hard techno, hardcore, hardstyle) dove le classifiche generiche
// spesso non arrivano.
async function lastfmTracceTag(apiKey, tag, limit) {
  const url = `https://ws.audioscrobbler.com/2.0/?method=tag.gettoptracks&tag=${encodeURIComponent(tag)}&api_key=${apiKey}&format=json&limit=${limit || 30}`;
  const data = await httpsGetJsonSimple(url);
  const tracce = data?.tracks?.track;
  if (!tracce || !Array.isArray(tracce)) return [];
  return tracce.map(t => ({ artist: t.artist?.name || '', title: t.name || '', fonte: 'Last.fm' })).filter(t => titoloPlausibile(t.artist, t.title));
}

async function lastfmTracceArtista(apiKey, artista, limit) {
  const url = `https://ws.audioscrobbler.com/2.0/?method=artist.gettoptracks&artist=${encodeURIComponent(artista)}&api_key=${apiKey}&format=json&limit=${limit || 15}`;
  const data = await httpsGetJsonSimple(url);
  const tracce = data?.toptracks?.track;
  if (!tracce || !Array.isArray(tracce)) return [];
  return tracce.map(t => ({ artist: t.artist?.name || artista, title: t.name || '', fonte: 'Last.fm' })).filter(t => titoloPlausibile(t.artist || artista, t.title));
}

// ── Jamendo: musica REALMENTE scaricabile gratis (licenze Creative Commons) ──
// A differenza di Deezer/Spotify/Last.fm (solo metadati), qui i brani si
// scaricano DIRETTAMENTE dai loro server, senza passare da YouTube/SoundCloud.
async function jamendoCercaTracce(clientId, tagOArtista, isArtista, annoDa, annoA, limit) {
  let url = `https://api.jamendo.com/v3.0/tracks/?client_id=${clientId}&format=json&limit=${limit || 20}&include=musicinfo&audioformat=mp32`;
  if (isArtista) {
    url += `&namesearch=${encodeURIComponent(tagOArtista)}`;
  } else {
    url += `&tags=${encodeURIComponent(tagOArtista)}`;
  }
  if (annoDa && annoA) url += `&datebetween=${annoDa}-01-01_${annoA}-12-31`;
  const data = await httpsGetJsonSimple(url);
  if (!data || !data.results) return [];
  return data.results.map(t => ({
    artist: t.artist_name || '',
    title: t.name || '',
    audioUrl: t.audiodownload || t.audio || '',
    duration: t.duration || 0,
    fonte: 'Jamendo'
  })).filter(t => titoloPlausibile(t.artist, t.title) && t.audioUrl);
}

function verificaSoundcloudScaricabile(tp, url) {
  return new Promise((resolve) => {
    const proc = spawn(path.join(tp, 'yt-dlp.exe'), [
      '--simulate', '--no-warnings', url
    ], { windowsHide: true });
    let err = '';
    proc.stderr.on('data', d => err += d.toString());
    proc.on('close', (code) => {
      const protetta = /DRM protected|Go\+|go-plus|requires? .*subscription/i.test(err);
      resolve(!protetta && code === 0);
    });
    setTimeout(() => { try { proc.kill(); } catch(e){} resolve(true); }, 10000); // in dubbio, non blocchiamo la ricerca
  });
}

function searchSoundcloudYtdlp(tp, query) {
  return new Promise(async (resolve) => {
    const proc = spawn(path.join(tp, 'yt-dlp.exe'), [
      `scsearch5:${query}`,
      '--flat-playlist',
      '--print', '%(webpage_url)s|||%(title)s',
      '--no-warnings'
    ], { windowsHide: true });
    let out = '';
    proc.stdout.on('data', d => out += d.toString());
    proc.on('close', async () => {
      const righe = out.trim().split('\n').filter(l => l.includes('|||'));
      if (righe.length === 0) return resolve({ ok: false, error: 'nessun risultato' });
      for (const riga of righe) {
        const [url, title] = riga.split('|||');
        if (!titoliCorrispondono(query, title)) continue;
        // Prima di accettarla, verifica che sia davvero scaricabile (non a pagamento/DRM)
        const scaricabile = await verificaSoundcloudScaricabile(tp, url.trim());
        if (!scaricabile) continue; // passa al risultato successivo tra i 5
        return resolve({ ok: true, url: url.trim(), title: (title||'').trim() });
      }
      resolve({ ok: false, error: 'nessuna versione gratuita/scaricabile trovata' });
    });
    setTimeout(() => { try { proc.kill(); } catch (e) {} resolve({ ok: false, error: 'timeout' }); }, 30000);
  });
}

// Ricerca su Spotify (fallback n.3, tramite spotdl)
function searchSpotifyUrl(tp, query) {
  return new Promise((resolve) => {
    const spotdl = findSpotdl(tp);
    if (!spotdl) return resolve({ ok: false, error: 'spotdl non trovato' });
    const proc = spawn(spotdl, ['url', query], { windowsHide: true });
    let out = '';
    proc.stdout.on('data', d => out += d.toString());
    proc.on('close', () => {
      const righe = out.trim().split('\n').map(r => r.trim()).filter(r => r.startsWith('http'));
      if (righe.length === 0) return resolve({ ok: false, error: 'nessun risultato' });
      resolve({ ok: true, url: righe[0], title: query });
    });
    setTimeout(() => { try { proc.kill(); } catch (e) {} resolve({ ok: false, error: 'timeout' }); }, 20000);
  });
}

// Cerca una lista di titoli, uno alla volta: YouTube → SoundCloud → Spotify (cascata automatica)
// Cerca lo stesso titolo esatto su SoundCloud, per il player inline della lista
// (SoundCloud quasi non blocca mai l'embed a differenza di YouTube)
ipcMain.handle('soundcloud-search-play', async (_, { query }) => {
  const tp = getToolsPath();
  const res = await searchSoundcloudYtdlp(tp, query);
  return res;
});

ipcMain.handle('youtube-search-play', async (_, { query }) => {
  const tp = getToolsPath();
  const res = await searchYoutubeYtdlp(tp, query);
  return res;
});

// ============================================================
// LINK MULTIPLI — scarica una lista di URL misti (YouTube singoli o
// playlist, SoundCloud, Spotify) incollati tutti insieme, uno per riga.
// ============================================================
function detectUrlPlatformBackend(url) {
  const l = (url || '').toLowerCase();
  if (l.includes('soundcloud.com')) return 'soundcloud';
  if (l.includes('spotify.com') || l.startsWith('spotify:')) return 'spotify';
  return 'youtube';
}

ipcMain.handle('start-multi-url-download', async (_, { urls, destFolder, format, archiveFile, numeraFile }) => {
  stopRequested = false;
  running_download_active = true;
  const tp = getToolsPath();
  if (!fs.existsSync(destFolder)) fs.mkdirSync(destFolder, { recursive: true });
  openDownloadManager(urls.length, destFolder);

  mainWindow.webContents.send('download-log', `\n▶ Download link multipli · ${urls.length} link · ${format.toUpperCase()}\n`);
  mainWindow.webContents.send('download-log', `📁 ${destFolder}\n`);

  for (let i = 0; i < urls.length; i++) {
    if (stopRequested) break;
    const url = urls[i].trim();
    if (!url) continue;
    const n = i + 1;
    const platform = detectUrlPlatformBackend(url);

    // Pausa tra un link e l'altro: YouTube blocca con 403 chi fa troppe richieste
    // ravvicinate dallo stesso IP. Una piccola attesa riduce drasticamente il rischio.
    if (i > 0) {
      mainWindow.webContents.send('download-log', `⏳ Pausa anti-blocco (4s)...\n`);
      await new Promise(r => setTimeout(r, 4000));
      if (stopRequested) break;
    }

    mainWindow.webContents.send('download-block', { start: n, end: n, total: urls.length });
    mainWindow.webContents.send('download-log', `\n🔗 Link ${n}/${urls.length} (${platform}): ${url}\n`);
    dlmgrSend('dlmgr-item-start', { index: String(n), title: url, thumb: null });

    let code;
    if (platform === 'soundcloud') {
      code = await downloadSoundCloud(tp, url, destFolder, format, archiveFile);
      dlmgrSend('dlmgr-item-done', code === 0
        ? { index: String(n), title: url, format, source: 'SoundCloud' }
        : { index: String(n), title: url, format, error: 'download fallito' });
    } else if (platform === 'spotify') {
      code = await downloadSpotify(tp, url, destFolder, format);
      dlmgrSend('dlmgr-item-done', code === 0
        ? { index: String(n), title: url, format, source: 'Spotify' }
        : { index: String(n), title: url, format, error: 'download fallito' });
    } else {
      // YouTube: video singolo o playlist, con lo stesso retry robusto già usato altrove
      if (isSingleVideo(url)) {
        code = await downloadSingle(tp, url, destFolder, format);
        dlmgrSend('dlmgr-item-done', code === 0
          ? { index: String(n), title: url, format, source: 'YouTube' }
          : { index: String(n), title: url, format, error: 'download fallito' });
      } else {
        // playlist YouTube: usa il flusso a blocchi già esistente
        const totale = await new Promise((resolve) => {
          const p = spawn(path.join(tp, 'yt-dlp.exe'), [
            '--flat-playlist', '--playlist-items', '1', '--print', '%(playlist_count)s',
            '--js-runtimes', `deno:${path.join(tp, 'deno.exe')}`, '--no-warnings', url
          ], { windowsHide: true });
          let out = '';
          p.stdout.on('data', d => out += d.toString());
          p.on('close', () => { const num = parseInt(out.trim().split('\n')[0]); resolve(isNaN(num) ? 0 : num); });
          setTimeout(() => { try { p.kill(); } catch(e){} resolve(0); }, 30000);
        });
        code = await downloadAll(tp, url, destFolder, format, archiveFile, totale, numeraFile);
        dlmgrSend('dlmgr-item-done', code === 0
          ? { index: String(n), title: url + ' (playlist)', format, source: 'YouTube' }
          : { index: String(n), title: url, format, error: 'download fallito' });
      }
    }
  }

  if (stopRequested) {
    mainWindow.webContents.send('download-done', { code: -1, destFolder });
  } else {
    mainWindow.webContents.send('download-done', { code: 0, destFolder });
  }
  running_download_active = false;
  dlmgrSend('dlmgr-all-done');
  return true;
});

// ============================================================
// GENERA SET — costruisce automaticamente una scaletta cercando su
// YouTube/SoundCloud in base ad artisti/generi e range di anni scelti
// dall'utente, fino a raggiungere il numero di tracce o la durata target.
// ============================================================
function normalizzaTitoloPerConfronto(t) {
  return (t || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // "é"→"e", "ñ"→"n" ecc. invece di sparire del tutto
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

// Verifica che il nome dell'artista cercato compaia davvero nel titolo trovato —
// usata dalle fonti a download diretto (Jamendo/Audius/Internet Archive) che
// non passano dal controllo già esistente per YouTube/SoundCloud.
//
// IMPORTANTE: confronto per PAROLE INTERE, non per sottostringa grezza —
// altrimenti "Sefa" risulterebbe trovato dentro "Sefaro" (artista diverso!)
// solo perché quella sequenza di lettere è contenuta nell'altra parola.
function paroleTrovate(query, testo) {
  const queryNorm = normalizzaTitoloPerConfronto(query);
  const testoNorm = normalizzaTitoloPerConfronto(testo);
  if (!queryNorm) return true;
  const paroleQuery = queryNorm.split(' ').filter(Boolean);
  const paroleTesto = testoNorm.split(' ').filter(Boolean);
  if (paroleQuery.length === 0) return true;
  for (let i = 0; i <= paroleTesto.length - paroleQuery.length; i++) {
    let corrisponde = true;
    for (let j = 0; j < paroleQuery.length; j++) {
      if (paroleTesto[i + j] !== paroleQuery[j]) { corrisponde = false; break; }
    }
    if (corrisponde) return true;
  }
  return false;
}

function nomeArtistaNelTitolo(nomeArtista, titolo) {
  if (!nomeArtista) return true;
  return paroleTrovate(nomeArtista, titolo);
}

// Validatore GENERICO di plausibilità, applicato a ogni singola fonte di
// scoperta (Deezer/Apple Music/MusicBrainz/Discogs/Spotify/Last.fm/Jamendo/
// Audius/Internet Archive) PRIMA che il risultato entri nella scaletta —
// protezione comune contro metadati spezzettati, vuoti, o palesemente non
// una singola canzone (compilation, release multiple, ecc.).
function titoloPlausibile(artista, titolo) {
  if (!artista || !titolo) return false;
  const a = String(artista).trim();
  const t = String(titolo).trim();
  if (a.length < 1 || a.length > 60) return false;
  if (t.length < 1 || t.length > 120) return false;
  // Troppi trattini nel titolo = quasi sempre metadati concatenati male
  // (es. "Genere/Sottogenere - Titolo - Etichetta - Altro")
  if ((t.match(/ - /g) || []).length > 2) return false;
  // Il nome dell'artista non dovrebbe mai contenere un trattino: se lo ha,
  // probabilmente lo split artista/titolo è andato storto a monte.
  if (a.includes(' - ')) return false;
  // Scarta compilation/raccolte "Various Artists", non un DJ specifico
  if (/^various(\s+artists?)?$/i.test(a)) return false;
  // Scarta versioni live/DJ set/mix — vogliamo solo il brano ufficiale in studio
  if (/\b(live|dj set|live set|full set|continuous mix|non ?stop mix|megamix|mixtape|festival set|radio show|podcast)\b/i.test(t)) return false;
  return true;
}

// ── Gemini AI: controllo finale intelligente di pertinenza ──
// Dopo che le regole "fisse" hanno già scremato i candidati, chiediamo a
// Gemini un giudizio semantico reale — capisce il contesto molto meglio di
// qualunque regola scritta a mano (es. sa che "Sefaro" non è "Sefa", o che
// un brano di puro rock non è pertinente a una ricerca "hardcore" elettronico).
function geminiHttpPost(apiKey, bodyObj) {
  return new Promise((resolve) => {
    const bodyStr = JSON.stringify(bodyObj);
    const req = https.request(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr) }
      },
      (res) => {
        let body = '';
        res.on('data', d => body += d);
        res.on('end', () => { try { resolve(JSON.parse(body)); } catch(e) { resolve(null); } });
      }
    );
    req.on('error', () => resolve(null));
    req.write(bodyStr);
    req.end();
  });
}

async function geminiVerificaTracce(apiKey, artisti, generi, tracce) {
  if (!apiKey || tracce.length === 0) return tracce; // nessuna chiave: passa tutto invariato

  const criteri = [];
  if (artisti.length > 0) criteri.push(`Artisti/DJ richiesti: ${artisti.join(', ')}`);
  if (generi.length > 0) criteri.push(`Generi richiesti: ${generi.join(', ')}`);

  const listaBrani = tracce.map((t, i) => `${i}: ${t.title}`).join('\n');
  const prompt = `Sei un assistente che verifica la pertinenza di brani musicali elettronici (hardcore, hardstyle, hard techno, techno, ecc.) rispetto a una ricerca.

${criteri.join('\n')}

Ecco l'elenco dei brani trovati (formato "indice: Artista - Titolo"):
${listaBrani}

Per ogni brano, dimmi se è VERAMENTE pertinente alla ricerca (stesso artista scritto, non un nome simile ma diverso; se la ricerca è per genere, il brano deve appartenere davvero a quel genere elettronico, non a generi omonimi come rock/metalcore).

Rispondi SOLO con un array JSON di indici (numeri) dei brani da MANTENERE, senza altro testo. Esempio: [0,2,5]`;

  const risposta = await geminiHttpPost(apiKey, {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0, maxOutputTokens: 2000 }
  });

  const testoRisposta = risposta?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!testoRisposta) return tracce; // errore API: non blocchiamo l'utente, passiamo tutto

  try {
    const match = testoRisposta.match(/\[[\d,\s]*\]/);
    if (!match) return tracce;
    const indiciDaTenere = new Set(JSON.parse(match[0]));
    return tracce.filter((_, i) => indiciDaTenere.has(i));
  } catch(e) {
    return tracce; // risposta non valida: non blocchiamo, passiamo tutto invariato
  }
}

// ── Gemini AI: SCOPERTA diretta dei brani (non solo controllo finale) ──
// Invece di costruire query generiche "artista anno" e sperare che YouTube
// restituisca risultati pertinenti, chiediamo direttamente a Gemini di
// elencare brani reali di quegli artisti/generi specifici. Ogni titolo
// proposto viene comunque VERIFICATO dopo (deve esistere davvero su YouTube/
// SoundCloud, con l'artista corretto e la data giusta) — se Gemini si
// sbagliasse o inventasse qualcosa, la verifica successiva lo scarterebbe
// da sola, senza bisogno di fidarsi ciecamente della risposta dell'IA.
async function geminiScopriTracce(apiKey, artisti, generi, annoDa, annoA, quantitaPerArtista) {
  if (!apiKey) return [];
  if (artisti.length === 0 && generi.length === 0) return [];

  const criteri = [];
  if (artisti.length > 0) criteri.push(`Artisti/DJ: ${artisti.join(', ')}`);
  if (generi.length > 0) criteri.push(`Generi: ${generi.join(', ')}`);

  const prompt = `Sei un esperto di musica elettronica hardcore/hardstyle/hard techno/techno.

${criteri.join('\n')}
Anni di uscita: dal ${annoDa} al ${annoA}

Elenca brani REALI (non inventati) pubblicati da questi artisti in questo periodo, che conosci per certo essere esistenti. Se non sei sicuro che un brano esista davvero, NON includerlo — meglio una lista più corta ma affidabile.

${artisti.length > 0 ? `Per OGNI artista elencato, proponi fino a ${quantitaPerArtista || 8} brani suoi (o remix/collaborazioni dove il suo nome compare chiaramente).` : `Proponi fino a ${(quantitaPerArtista || 8) * 3} brani rappresentativi del genere richiesto, di artisti diversi e rilevanti.`}

Rispondi SOLO con un array JSON di oggetti nel formato [{"artist":"Nome Artista","title":"Titolo Brano"}], senza altro testo prima o dopo.`;

  const risposta = await geminiHttpPost(apiKey, {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.3, maxOutputTokens: 4000 }
  });

  const testoRisposta = risposta?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!testoRisposta) return [];

  try {
    const match = testoRisposta.match(/\[[\s\S]*\]/);
    if (!match) return [];
    const lista = JSON.parse(match[0]);
    if (!Array.isArray(lista)) return [];
    return lista
      .map(t => ({ artist: (t.artist || '').trim(), title: (t.title || '').trim(), fonte: 'Gemini AI' }))
      .filter(t => titoloPlausibile(t.artist, t.title));
  } catch(e) {
    return [];
  }
}

function mescola(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Alcuni nomi di genere sono ambigui: "Hardcore" indica sia il genere elettronico
// gabber/uptempo (Angerfist, Dr. Peacock, Sefa...) sia il genere hardcore punk/
// metalcore (Hatebreed, Terror, Bring Me The Horizon...). Aggiungiamo una parola
// chiarificatrice per restare nell'ambito elettronico quando serve.
function chiarificaGenere(genere) {
  const mappa = {
    'hardcore': 'hardcore gabber',
    'hard': 'hard dance',
    'house': 'house edm',
    'trance': 'trance edm',
    'core': 'hardcore gabber',
    'techno': 'techno edm',
    'hardstyle': 'hardstyle edm',
    'hard techno': 'hard techno rave',
    'hardtechno': 'hard techno rave'
  };
  const chiave = (genere || '').trim().toLowerCase();
  return mappa[chiave] || genere;
}

function costruisciQuery(artisti, generi, annoDa, annoA) {
  const query = [];
  const anni = [];
  for (let y = annoDa; y <= annoA; y++) anni.push(y);
  const generiChiariti = generi.map(chiarificaGenere);

  if (artisti.length > 0) {
    // IMPORTANTE: se sono stati specificati artisti precisi, la ricerca resta
    // SEMPRE E SOLO su quei nomi. Il genere (se presente) viene usato solo come
    // parola aggiuntiva per restringere tra i brani di quell'artista — MAI come
    // ricerca separata "genere generico", altrimenti escono anche brani di
    // tutt'altri artisti dello stesso genere che l'utente non ha mai chiesto.
    artisti.forEach(artista => {
      anni.forEach(anno => {
        query.push({ q: `${artista} ${anno}`, tipo: 'artista', nome: artista });
        generiChiariti.forEach(genere => {
          query.push({ q: `${artista} ${genere} ${anno}`, tipo: 'artista', nome: artista });
        });
      });
      query.push({ q: artista, tipo: 'artista', nome: artista }); // anche senza anno, come rete di sicurezza
    });
  } else {
    // Nessun artista specifico: qui sì cerchiamo per genere in senso ampio,
    // dato che l'utente vuole scoprire brani/DJ nuovi di quel genere.
    generiChiariti.forEach(genere => {
      anni.forEach(anno => {
        // NIENTE query con "mix": cerchiamo canzoni singole, non DJ set/mix interi.
        query.push({ q: `${genere} ${anno}`, tipo: 'genere', genere });
        query.push({ q: `${genere} track ${anno}`, tipo: 'genere', genere });
        query.push({ q: `new ${genere} ${anno}`, tipo: 'genere', genere });
        query.push({ q: `${genere} release ${anno}`, tipo: 'genere', genere });
      });
    });
  }

  return mescola(query);
}

// Cerca un singolo risultato con durata (per il generatore di set) — usa lo stesso
// filtro "5 risultati, valuta corrispondenza" ma qui prendiamo il primo valido di
// durata plausibile per una traccia singola (non un mix/dj set intero).
// Scopre automaticamente artisti/canali ricorrenti in un genere, cercando le
// tracce più recenti di quel genere e guardando chi le ha caricate. Serve per
// "trovare da solo i migliori DJ" quando l'utente inserisce solo un genere.
function scopriArtistiDalGenere(tp, genere, annoRiferimento, fonte) {
  return new Promise((resolve) => {
    const cmd = fonte === 'soundcloud' ? `scsearch15:${genere} ${annoRiferimento}` : `ytsearch15:${genere} ${annoRiferimento}`;
    const args = [
      cmd, '--flat-playlist',
      '--print', '%(uploader)s',
      '--no-warnings'
    ];
    if (fonte === 'youtube') {
      args.push('--js-runtimes', `deno:${path.join(tp, 'deno.exe')}`, '--extractor-args', 'youtube:player_client=default,tv', ...getCookieArgs());
    }
    const proc = spawn(path.join(tp, 'yt-dlp.exe'), args, { windowsHide: true });
    let out = '';
    proc.stdout.on('data', d => out += d.toString());
    proc.on('close', () => {
      const nomiDaEscludere = /^(various artists?|ncs|topic|nocopyrightsounds|monstercat|trap nation|proximity)$/i;
      const conteggio = {};
      out.trim().split('\n').forEach(riga => {
        let nome = (riga || '').trim().replace(/\s*-\s*Topic$/i, '').trim();
        if (!nome || nomiDaEscludere.test(nome)) return;
        conteggio[nome] = (conteggio[nome] || 0) + 1;
      });
      // Ordina per frequenza (chi torna più spesso è più rilevante nel genere) e prende i primi 6
      const artisti = Object.keys(conteggio).sort((a, b) => conteggio[b] - conteggio[a]).slice(0, 6);
      resolve(artisti);
    });
    setTimeout(() => { try { proc.kill(); } catch(e){} resolve([]); }, 15000);
  });
}

function cercaTracciaConDurata(tp, query, fonte, maxDurSec, annoDa, annoA, nomeArtistaAtteso) {
  const durataMassima = maxDurSec || 720; // default 12 min se non specificato dall'utente
  return new Promise((resolve) => {
    const cmd = fonte === 'soundcloud' ? `scsearch5:${query}` : `ytsearch5:${query}`;
    const args = [
      cmd, '--flat-playlist',
      '--print', '%(id)s|||%(title)s|||%(duration)s|||%(webpage_url)s|||%(upload_date)s|||%(uploader)s',
      '--no-warnings'
    ];
    if (fonte === 'youtube') {
      args.push('--js-runtimes', `deno:${path.join(tp, 'deno.exe')}`, '--extractor-args', 'youtube:player_client=default,tv', ...getCookieArgs());
    }
    const proc = spawn(path.join(tp, 'yt-dlp.exe'), args, { windowsHide: true });
    let out = '';
    proc.stdout.on('data', d => out += d.toString());
    proc.on('close', async () => {
      const righe = out.trim().split('\n').filter(l => l.includes('|||'));
      // Parole che indicano un DJ set/mix/compilation intero, da scartare sempre
      // anche se la durata rientrasse per caso nei limiti (rete di sicurezza extra
      // oltre al filtro sulle query di ricerca).
      const paroleDaScartare = /\b(dj set|live set|full set|continuous mix|non ?stop mix|megamix|mixtape|mix compilation|festival set|radio show|podcast|episode|ep\.?\s*\d+|live)\b/i;
      const nomeArtistaAttesoTrim = (nomeArtistaAtteso || '').trim();

      for (const riga of righe) {
        const [id, title, durStr, url, uploadDate, uploader] = riga.split('|||');
        const dur = parseInt(durStr);
        const titoloPulito = (title || '').trim();
        if (paroleDaScartare.test(titoloPulito)) continue;

        // PRECISIONE: se stiamo cercando un artista specifico, il suo nome deve
        // comparire davvero nel titolo del brano O nel nome di chi l'ha caricato
        // (per PAROLE INTERE, non sottostringa grezza — altrimenti "Sefa" verrebbe
        // trovato dentro "Sefaro", un artista completamente diverso).
        if (nomeArtistaAtteso) {
          const trovatoNelTitolo = paroleTrovate(nomeArtistaAtteso, titoloPulito);
          const trovatoNelCaricatore = paroleTrovate(nomeArtistaAtteso, uploader || '');
          if (!trovatoNelTitolo && !trovatoNelCaricatore) continue;
        }

        // Verifica la data di pubblicazione REALE (non solo quella scritta nella query
        // di ricerca, che YouTube/SoundCloud non garantiscono affatto di rispettare).
        if (annoDa && annoA) {
          const dataStr = (uploadDate || '').trim();
          if (dataStr && dataStr.length >= 4) {
            const annoVideo = parseInt(dataStr.slice(0, 4));
            if (!isNaN(annoVideo) && (annoVideo < annoDa || annoVideo > annoA)) continue;
          }
          // Se la data non è disponibile (capita più spesso su SoundCloud in modalità
          // flat-playlist) non scartiamo alla cieca, per non perdere troppi risultati validi.
        }

        // Scarta troppo corte (intro/spezzoni, <70s) o oltre il massimo scelto
        // (default 12 min se l'utente non ha impostato un limite specifico)
        if (!isNaN(dur) && dur >= 70 && dur <= durataMassima) {
          // Per SoundCloud verifica anche che non sia a pagamento/DRM prima di accettarla
          if (fonte === 'soundcloud') {
            const scaricabile = await verificaSoundcloudScaricabile(tp, (url||'').trim());
            if (!scaricabile) continue; // prova il prossimo risultato tra i 5
          }
          resolve({ id: (id||'').trim(), title: titoloPulito, duration: dur, url: (url||'').trim(), source: fonte });
          return;
        }
      }
      resolve(null);
    });
    setTimeout(() => { try { proc.kill(); } catch(e){} resolve(null); }, 15000);
  });
}

ipcMain.handle('generate-set', async (_, { artisti, generi, annoDa, annoA, targetType, targetValue, destFolder, fonti, maxDurataBranoSec }) => {
  const tp = getToolsPath();
  let listaArtisti = (artisti || '').split(',').map(s => s.trim()).filter(Boolean);
  const listaGeneri = (generi || '').split(',').map(s => s.trim()).filter(Boolean);
  const usaYoutube = !fonti || fonti.includes('youtube');
  const usaSoundcloud = !fonti || fonti.includes('soundcloud');

  if (listaArtisti.length === 0 && listaGeneri.length === 0) {
    return { ok: false, error: 'Inserisci almeno un artista o un genere.' };
  }

  // Candidati PRECISI (artista+titolo reali) trovati da Deezer/Spotify/Last.fm,
  // molto più affidabili delle query generiche "artista anno" costruite a mano.
  const candidatiPrecisi = []; // { q, tipo:'preciso', nome: artista }

  // Gemini AI come PRIMA fonte di scoperta: le chiediamo direttamente di
  // proporre brani reali per gli artisti/generi richiesti (invece di sperare
  // che una query generica trovi qualcosa di pertinente). Ogni titolo
  // proposto viene comunque verificato davvero più avanti (deve esistere su
  // YouTube/SoundCloud con l'artista giusto e la data giusta) — se Gemini
  // sbagliasse, viene scartato automaticamente in quel passaggio.
  const geminiKeyScoperta = resolveGeminiKey();
  if (geminiKeyScoperta) {
    mainWindow.webContents.send('download-log', `🤖 Gemini AI: propongo brani reali per ${listaArtisti.length > 0 ? listaArtisti.join(', ') : listaGeneri.join(', ')}...\n`);
    const proposti = await geminiScopriTracce(geminiKeyScoperta, listaArtisti, listaGeneri, annoDa, annoA, 12);
    proposti.forEach(t => {
      // Se abbiamo artisti specifici, verifichiamo che il brano proposto da
      // Gemini appartenga davvero a UNO di quelli richiesti (per parole
      // intere, stessa regola usata ovunque nel programma).
      const artistaCorrispondente = listaArtisti.find(a => paroleTrovate(a, t.artist) || paroleTrovate(a, t.title));
      const nomeDaVerificare = artistaCorrispondente || t.artist;
      candidatiPrecisi.push({ q: `${t.artist} - ${t.title}`, tipo: 'preciso', nome: nomeDaVerificare });
    });
    mainWindow.webContents.send('download-log', `✔ Gemini AI: ${proposti.length} brani proposti (da verificare).\n`);
  }

  // Se c'è un genere MA NON sono stati specificati artisti precisi, scopriamo
  // automaticamente i DJ/artisti più ricorrenti in quel genere. Se invece
  // l'utente HA GIÀ scritto artisti suoi, questo passaggio va saltato del
  // tutto — altrimenti aggiungerebbe artisti mai richiesti (es. "Neophyte")
  // alla ricerca, anche se l'utente voleva solo i suoi 5 DJ specifici.
  if (listaGeneri.length > 0 && listaArtisti.length === 0) {
    const lastfmKey = resolveLastfmKey();
    if (lastfmKey) {
      // Last.fm: dati reali della community, molto più precisi per generi di
      // nicchia come techno/hard techno/hardcore/hardstyle rispetto a contare
      // chi carica di più su YouTube.
      mainWindow.webContents.send('download-log', `🔍 Genera Set: cerco i brani più rilevanti su Last.fm per "${listaGeneri.join(', ')}"...\n`);
      for (const genere of listaGeneri) {
        const tracce = await lastfmTracceTag(lastfmKey, chiarificaGenere(genere), 40);
        tracce.forEach(t => {
          candidatiPrecisi.push({ q: `${t.artist} - ${t.title}`, tipo: 'preciso', nome: t.artist });
          if (!listaArtisti.includes(t.artist)) listaArtisti.push(t.artist);
        });
      }
      mainWindow.webContents.send('download-log', `✔ Last.fm: ${candidatiPrecisi.length} brani trovati per il genere.\n`);
    } else {
      mainWindow.webContents.send('download-log', `🔍 Genera Set: scopro i DJ più rilevanti per "${listaGeneri.join(', ')}"...\n`);
      const fonteScoperta = usaYoutube ? 'youtube' : 'soundcloud';
      for (const genere of listaGeneri) {
        const scoperti = await scopriArtistiDalGenere(tp, genere, annoA, fonteScoperta);
        scoperti.forEach(nome => { if (!listaArtisti.includes(nome)) listaArtisti.push(nome); });
      }
      if (listaArtisti.length > 0) {
        mainWindow.webContents.send('download-log', `✔ DJ trovati nel genere: ${listaArtisti.join(', ')}\n`);
      }
    }
  }

  // Titoli già presenti nella cartella di destinazione, per evitare doppioni
  const titoliGiaScaricati = new Set();
  try {
    if (destFolder && fs.existsSync(destFolder)) {
      fs.readdirSync(destFolder).forEach(f => {
        const senzaNumero = f.replace(/^\d{1,3}\s*-\s*/, '').replace(/\.(wav|mp3|flac|aac|opus|m4a)$/i, '');
        titoliGiaScaricati.add(normalizzaTitoloPerConfronto(senzaNumero));
      });
    }
  } catch(e) {}

  // ── Deezer/Spotify: candidati PRECISI (artista+titolo reali) ──
  // Invece delle query generiche "artista anno", quando l'utente attiva queste
  // fonti otteniamo l'elenco vero dei brani (uguale a quello ufficiale), che
  // trasformiamo in query dirette "Artista - Titolo" molto più precise da
  // cercare poi su YouTube/SoundCloud per il download vero e proprio.

  // Limite di sicurezza: con molti artisti e tante fonti attive, evitiamo di fare
  // centinaia di chiamate di rete inutili una volta che abbiamo già abbastanza
  // candidati per il set richiesto (3x il target, così restano margine per gli
  // scarti nella verifica finale su YouTube/SoundCloud).
  const MAX_CANDIDATI = targetType === 'count' ? Math.max(targetValue * 6, 50) : 100;

  if (fonti && fonti.includes('deezer')) {
    mainWindow.webContents.send('download-log', `🎧 Deezer: cerco brani precisi...\n`);
    for (const artista of listaArtisti) {
      if (candidatiPrecisi.length >= MAX_CANDIDATI) break;
      const tracce = await deezerTracceArtista(artista, 20);
      // IMPORTANTE: verifichiamo contro l'artista DAVVERO cercato (nome=artista),
      // non contro quello restituito dall'API — altrimenti un risultato completamente
      // fuori tema passerebbe comunque il controllo perché si autoconvalida da solo.
      tracce.forEach(t => candidatiPrecisi.push({ q: `${t.artist} - ${t.title}`, tipo: 'preciso', nome: artista }));
    }
    if (listaArtisti.length === 0) {
      // Ricerca per genere in senso ampio SOLO se non ci sono artisti specifici richiesti
      for (const genere of listaGeneri) {
        if (candidatiPrecisi.length >= MAX_CANDIDATI) break;
        const tracce = await deezerTracceGenere(chiarificaGenere(genere), 30);
        tracce.forEach(t => candidatiPrecisi.push({ q: `${t.artist} - ${t.title}`, tipo: 'preciso', nome: t.artist }));
      }
    }
    mainWindow.webContents.send('download-log', `✔ Deezer: ${candidatiPrecisi.length} brani precisi trovati.\n`);
  }

  if (fonti && fonti.includes('applemusic') && candidatiPrecisi.length < MAX_CANDIDATI) {
    const primaDiApple = candidatiPrecisi.length;
    mainWindow.webContents.send('download-log', `🍎 Apple Music: cerco brani precisi...\n`);
    for (const artista of listaArtisti) {
      if (candidatiPrecisi.length >= MAX_CANDIDATI) break;
      const tracce = await appleMusicTracceArtista(artista, annoDa, annoA, 20);
      tracce.forEach(t => candidatiPrecisi.push({ q: `${t.artist} - ${t.title}`, tipo: 'preciso', nome: artista }));
    }
    if (listaArtisti.length === 0) {
      for (const genere of listaGeneri) {
        if (candidatiPrecisi.length >= MAX_CANDIDATI) break;
        const tracce = await appleMusicTracceGenere(chiarificaGenere(genere), annoDa, annoA, 30);
        tracce.forEach(t => candidatiPrecisi.push({ q: `${t.artist} - ${t.title}`, tipo: 'preciso', nome: t.artist }));
      }
    }
    mainWindow.webContents.send('download-log', `✔ Apple Music: ${candidatiPrecisi.length - primaDiApple} brani precisi trovati.\n`);
  }

  if (fonti && fonti.includes('musicbrainz') && listaArtisti.length > 0 && candidatiPrecisi.length < MAX_CANDIDATI) {
    const primaDiMb = candidatiPrecisi.length;
    mainWindow.webContents.send('download-log', `📀 MusicBrainz: cerco brani precisi...\n`);
    for (const artista of listaArtisti) {
      if (candidatiPrecisi.length >= MAX_CANDIDATI) break;
      const tracce = await musicbrainzTracceArtista(artista, 20);
      tracce.forEach(t => candidatiPrecisi.push({ q: `${t.artist} - ${t.title}`, tipo: 'preciso', nome: artista }));
      await new Promise(r => setTimeout(r, 1100)); // rispetta il limite di 1 richiesta/secondo di MusicBrainz
    }
    mainWindow.webContents.send('download-log', `✔ MusicBrainz: ${candidatiPrecisi.length - primaDiMb} brani precisi trovati.\n`);
  }

  if (fonti && fonti.includes('discogs') && listaArtisti.length > 0 && candidatiPrecisi.length < MAX_CANDIDATI) {
    const discogsToken = resolveDiscogsToken();
    if (discogsToken) {
      const primaDiDiscogs = candidatiPrecisi.length;
      mainWindow.webContents.send('download-log', `💿 Discogs: cerco brani precisi...\n`);
      for (const artista of listaArtisti) {
        if (candidatiPrecisi.length >= MAX_CANDIDATI) break;
        const tracce = await discogsTracceArtista(discogsToken, artista, 20);
        tracce.forEach(t => candidatiPrecisi.push({ q: `${t.artist} - ${t.title}`, tipo: 'preciso', nome: artista }));
      }
      mainWindow.webContents.send('download-log', `✔ Discogs: ${candidatiPrecisi.length - primaDiDiscogs} brani precisi trovati.\n`);
    }
  }

  if (fonti && fonti.includes('spotify') && candidatiPrecisi.length < MAX_CANDIDATI) {
    const { clientId: spClientId, clientSecret: spClientSecret } = resolveSpotifyKeys();
    if (!spClientId || !spClientSecret) {
      mainWindow.webContents.send('download-log', `⚠ Spotify selezionato ma chiavi non configurate — vai su Impostazioni per aggiungerle. Salto questa fonte.\n`);
    } else {
      mainWindow.webContents.send('download-log', `🟢 Spotify: cerco brani precisi...\n`);
      const token = await spotifyOttieniToken(spClientId, spClientSecret);
      if (!token) {
        mainWindow.webContents.send('download-log', `❌ Spotify: chiavi non valide o errore di autenticazione.\n`);
      } else {
        const primaDiSpotify = candidatiPrecisi.length;
        for (const artista of listaArtisti) {
          if (candidatiPrecisi.length >= MAX_CANDIDATI) break;
          const tracce = await spotifyTracceArtista(token, artista, annoDa, annoA, 20);
          tracce.forEach(t => candidatiPrecisi.push({ q: `${t.artist} - ${t.title}`, tipo: 'preciso', nome: artista }));
        }
        if (listaArtisti.length === 0) {
          for (const genere of listaGeneri) {
            if (candidatiPrecisi.length >= MAX_CANDIDATI) break;
            const tracce = await spotifyTracceGenere(token, chiarificaGenere(genere), annoDa, annoA, 30);
            tracce.forEach(t => candidatiPrecisi.push({ q: `${t.artist} - ${t.title}`, tipo: 'preciso', nome: t.artist }));
          }
        }
        mainWindow.webContents.send('download-log', `✔ Spotify: ${candidatiPrecisi.length - primaDiSpotify} brani precisi trovati.\n`);
      }
    }
  }

  // Jamendo: aggiunge direttamente i brani trovati (già scaricabili gratis,
  // niente bisogno di cercarli su YouTube/SoundCloud dopo).
  const risultati = [];
  const vistiTitoli = new Set();
  let durataTotale = 0;

  if (fonti && fonti.includes('jamendo')) {
    const jamendoId = resolveJamendoClientId();
    if (!jamendoId) {
      mainWindow.webContents.send('download-log', `⚠ Jamendo selezionato ma Client ID non configurato — vai su Impostazioni. Salto questa fonte.\n`);
    } else {
      mainWindow.webContents.send('download-log', `🎵 Jamendo: cerco brani scaricabili gratis...\n`);
      const richieste = listaArtisti.length > 0 ? listaArtisti : listaGeneri;
      const isArtistaRichiesta = listaArtisti.length > 0;
      for (const voce of richieste) {
        if (targetType === 'count' && risultati.length >= targetValue) break;
        if (targetType === 'duration' && durataTotale >= targetValue * 60) break;
        const tracce = await jamendoCercaTracce(jamendoId, voce, isArtistaRichiesta, annoDa, annoA, 20);
        for (const t of tracce) {
          if (targetType === 'count' && risultati.length >= targetValue) break;
          if (targetType === 'duration' && durataTotale >= targetValue * 60) break;
          // Se stiamo cercando un artista specifico, il suo nome deve comparire
          // davvero nel titolo/artista trovato — altrimenti scartiamo.
          if (isArtistaRichiesta && !nomeArtistaNelTitolo(voce, `${t.artist} ${t.title}`)) continue;
          const chiave = normalizzaTitoloPerConfronto(t.title);
          if (vistiTitoli.has(chiave) || titoliGiaScaricati.has(chiave)) continue;
          vistiTitoli.add(chiave);
          const trovato = { id: null, title: `${t.artist} - ${t.title}`, duration: t.duration, url: t.audioUrl, source: 'jamendo' };
          risultati.push(trovato);
          durataTotale += t.duration;
          mainWindow.webContents.send('generate-set-progress', { count: risultati.length, durataTotale, title: trovato.title });
        }
      }
      mainWindow.webContents.send('download-log', `✔ Jamendo: ${risultati.length} brani gratis trovati.\n`);
    }
  }

  if (fonti && fonti.includes('audius')) {
    mainWindow.webContents.send('download-log', `🎧 Audius: cerco brani scaricabili gratis...\n`);
    const richiesteAudius = listaArtisti.length > 0 ? listaArtisti : listaGeneri;
    const isArtistaAudius = listaArtisti.length > 0;
    const primaDiAudius = risultati.length;
    for (const voce of richiesteAudius) {
      if (targetType === 'count' && risultati.length >= targetValue) break;
      if (targetType === 'duration' && durataTotale >= targetValue * 60) break;
      const tracce = await audiusTracceRicerca(voce, 15);
      for (const t of tracce) {
        if (targetType === 'count' && risultati.length >= targetValue) break;
        if (targetType === 'duration' && durataTotale >= targetValue * 60) break;
        if (isArtistaAudius && !nomeArtistaNelTitolo(voce, `${t.artist} ${t.title}`)) continue;
        const chiave = normalizzaTitoloPerConfronto(t.title);
        if (vistiTitoli.has(chiave) || titoliGiaScaricati.has(chiave)) continue;
        vistiTitoli.add(chiave);
        const trovato = { id: null, title: `${t.artist} - ${t.title}`, duration: t.duration, url: audiusUrlStream(t.trackId), source: 'audius' };
        risultati.push(trovato);
        durataTotale += t.duration;
        mainWindow.webContents.send('generate-set-progress', { count: risultati.length, durataTotale, title: trovato.title });
      }
    }
    mainWindow.webContents.send('download-log', `✔ Audius: ${risultati.length - primaDiAudius} brani gratis trovati.\n`);
  }

  if (fonti && fonti.includes('internetarchive')) {
    mainWindow.webContents.send('download-log', `📼 Internet Archive: cerco brani scaricabili gratis...\n`);
    const richiesteIa = listaArtisti.length > 0 ? listaArtisti : listaGeneri;
    const isArtistaIa = listaArtisti.length > 0;
    const primaDiIa = risultati.length;
    for (const voce of richiesteIa) {
      if (targetType === 'count' && risultati.length >= targetValue) break;
      if (targetType === 'duration' && durataTotale >= targetValue * 60) break;
      const tracce = await internetArchiveTracceRicerca(voce, 4);
      for (const t of tracce) {
        if (targetType === 'count' && risultati.length >= targetValue) break;
        if (targetType === 'duration' && durataTotale >= targetValue * 60) break;
        if (isArtistaIa && !nomeArtistaNelTitolo(voce, `${t.artist} ${t.title}`)) continue;
        const chiave = normalizzaTitoloPerConfronto(t.title);
        if (vistiTitoli.has(chiave) || titoliGiaScaricati.has(chiave)) continue;
        vistiTitoli.add(chiave);
        // Internet Archive non dà quasi mai la durata in anticipo: usiamo una stima
        // generica (3 min) solo per il calcolo del target di durata del set.
        const durataStimata = 180;
        const trovato = { id: null, title: `${t.artist} - ${t.title}`, duration: durataStimata, url: t.audioUrl, source: 'internetarchive' };
        risultati.push(trovato);
        durataTotale += durataStimata;
        mainWindow.webContents.send('generate-set-progress', { count: risultati.length, durataTotale, title: trovato.title });
      }
    }
    mainWindow.webContents.send('download-log', `✔ Internet Archive: ${risultati.length - primaDiIa} brani gratis trovati.\n`);
  }

  // I candidati precisi (Deezer/Spotify/Last.fm) vanno provati per primi, essendo
  // molto più affidabili delle query generiche "artista anno" costruite a mano.
  const query = [...mescola(candidatiPrecisi), ...costruisciQuery(listaArtisti, listaGeneri, annoDa, annoA)];
  const MAX_TENTATIVI = 150; // limite di sicurezza sul numero di ricerche

  for (let i = 0; i < query.length && i < MAX_TENTATIVI; i++) {
    // Condizione di stop: raggiunto il target
    if (targetType === 'count' && risultati.length >= targetValue) break;
    if (targetType === 'duration' && durataTotale >= targetValue * 60) break;

    mainWindow.webContents.send('download-log', `🔍 Genera Set: cerco "${query[i].q}"...\n`);

    let trovato = null;
    if (usaYoutube) trovato = await cercaTracciaConDurata(tp, query[i].q, 'youtube', maxDurataBranoSec, annoDa, annoA, query[i].nome);
    if (!trovato && usaSoundcloud) trovato = await cercaTracciaConDurata(tp, query[i].q, 'soundcloud', maxDurataBranoSec, annoDa, annoA, query[i].nome);
    if (!trovato) continue;

    const chiave = normalizzaTitoloPerConfronto(trovato.title);
    if (vistiTitoli.has(chiave) || titoliGiaScaricati.has(chiave)) continue;
    vistiTitoli.add(chiave);

    risultati.push(trovato);
    durataTotale += trovato.duration;
    mainWindow.webContents.send('generate-set-progress', {
      count: risultati.length, durataTotale, title: trovato.title
    });
  }

  // Controllo finale con l'IA (Gemini): un ultimo giudizio semantico sulla
  // scaletta raccolta, se la chiave è configurata. Non blocca mai in caso di
  // errore — se Gemini non risponde, la scaletta resta quella già filtrata
  // dalle regole fisse.
  const geminiKey = resolveGeminiKey();
  let risultatiFinali = risultati;
  if (geminiKey && risultati.length > 0) {
    mainWindow.webContents.send('download-log', `🤖 Gemini AI: controllo finale di pertinenza su ${risultati.length} brani...\n`);
    risultatiFinali = await geminiVerificaTracce(geminiKey, listaArtisti, listaGeneri, risultati);
    const scartati = risultati.length - risultatiFinali.length;
    if (scartati > 0) {
      mainWindow.webContents.send('download-log', `✔ Gemini AI: scartati ${scartati} brani non pertinenti.\n`);
    } else {
      mainWindow.webContents.send('download-log', `✔ Gemini AI: tutti i brani confermati pertinenti.\n`);
    }
  }

  const durataFinale = risultatiFinali.reduce((somma, t) => somma + (t.duration || 0), 0);
  return { ok: true, tracks: risultatiFinali, durataTotaleSec: durataFinale };
});

ipcMain.handle('search-titles', async (_, { titles }) => {
  const tp = getToolsPath();
  const apiKey = resolveApiKey();
  const risultati = [];

  for (let i = 0; i < titles.length; i++) {
    if (stopRequested) break;
    const query = titles[i];
    let entry = null;

    // 1. YouTube (API poi yt-dlp)
    let res = apiKey ? await searchYoutubeApi(apiKey, query) : { ok: false, error: 'no key' };
    if (!res.ok && apiKey) {
      await new Promise(r => setTimeout(r, 500));
      res = await searchYoutubeApi(apiKey, query);
    }
    if (!res.ok) res = await searchYoutubeYtdlp(tp, query);
    if (res.ok) {
      entry = { query, ok: true, source: 'youtube', id: res.id, url: null, title: res.title, thumb: res.thumb, error: null };
    }

    // 2. SoundCloud, solo se YouTube ha fallito
    if (!entry) {
      mainWindow.webContents.send('search-progress-status', { index: i, label: 'Provo su SoundCloud...' });
      const sc = await searchSoundcloudYtdlp(tp, query);
      if (sc.ok) entry = { query, ok: true, source: 'soundcloud', id: null, url: sc.url, title: sc.title, thumb: null, error: null };
    }

    // 3. Spotify, solo se anche SoundCloud ha fallito
    if (!entry) {
      mainWindow.webContents.send('search-progress-status', { index: i, label: 'Provo su Spotify...' });
      const sp = await searchSpotifyUrl(tp, query);
      if (sp.ok) entry = { query, ok: true, source: 'spotify', id: null, url: sp.url, title: sp.title, thumb: null, error: null };
    }

    if (!entry) entry = { query, ok: false, source: null, id: null, url: null, title: null, thumb: null, error: 'non trovato su nessuna piattaforma' };

    risultati.push(entry);
    mainWindow.webContents.send('search-progress', { index: i, total: titles.length, entry });
  }
  return risultati;
});

// Scarica un singolo brano dispatchando in base alla piattaforma trovata
function downloadItemByPlatform(tp, item, index, total, destFolder, format, archiveFile, numeraFile) {
  const n = index + 1;
  const num = String(n).padStart(3, '0');
  mainWindow.webContents.send('download-block', { start: n, end: n, total });

  if (item.source === 'youtube') {
    const videoUrl = `https://www.youtube.com/watch?v=${item.id}`;
    return new Promise((resolve) => {
      let dlmgrThumb = null, dlmgrTitle = item.title || '';
      let dlmgrDone = false;
      let attempt = 0;
      let stderrBuf = '';

      function tryDownload() {
        if (stopRequested) return resolve(-1);
        stderrBuf = '';
        const clientArgs = getPlayerClientArgs(attempt);
        const args = [
          '-x', '--audio-format', format,
          '--ffmpeg-location', path.join(tp, 'ffmpeg.exe'),
          '--js-runtimes', `deno:${path.join(tp, 'deno.exe')}`,
          ...getCookieArgs(),
          ...clientArgs,
          '--output', outputTemplate(destFolder, numeraFile, num),
          '--download-archive', archiveFile,
          '--no-playlist', '--ignore-errors', '--no-abort-on-error',
          '--retries', '5', '--fragment-retries', '5',
          '--print', 'before_dl:%(id)s|||%(title)s',
          '--print', 'after_move:donefile:%(filepath)s',
          '--newline', '--no-warnings',
          videoUrl
        ];
        currentProc = spawn(path.join(tp, 'yt-dlp.exe'), args, { windowsHide: true });
        let stdoutLineBuf = '';
        currentProc.stdout.on('data', async (d) => {
          stdoutLineBuf += d.toString();
          const parts0 = stdoutLineBuf.split('\n');
          stdoutLineBuf = parts0.pop();
          for (const line of parts0) {
            if (line.startsWith('donefile:')) {
              const finalPath = line.slice('donefile:'.length).trim();
              if (!dlmgrDone) {
                dlmgrDone = true;
                let sizeBytes = 0;
                try { sizeBytes = fs.statSync(finalPath).size; } catch(e) {}
                dlmgrSend('dlmgr-item-done', { index: String(n), title: dlmgrTitle, thumb: dlmgrThumb, sizeBytes, format, source: 'YouTube' });
              }
            } else if (line.includes('|||')) {
              const parts = line.trim().split('|||');
              const videoId = parts[0].trim();
              const title = parts[1] ? parts[1].trim() : '';
              dlmgrTitle = title || dlmgrTitle;
              mainWindow.webContents.send('now-playing', { videoId, title, index: String(n), thumb: null });
              dlmgrSend('dlmgr-item-start', { index: String(n), title: dlmgrTitle, thumb: null });
              const thumb = await fetchThumbnail(videoId);
              if (thumb) {
                mainWindow.webContents.send('now-playing', { videoId, title, index: String(n), thumb });
                dlmgrThumb = thumb;
                dlmgrSend('dlmgr-item-start', { index: String(n), title: dlmgrTitle, thumb });
              }
            } else {
              mainWindow.webContents.send('download-log', line + '\n');
            }
          }
        });
        currentProc.stderr.on('data', d => {
          const msg = d.toString();
          stderrBuf += msg;
          mainWindow.webContents.send('download-log', msg);
        });
        currentProc.on('close', c => {
          currentProc = null;
          if (stopRequested) return resolve(-1);

          // Se YouTube ha bloccato la richiesta (403/bot) e non ha ancora scaricato → riprova con un player diverso
          const isBlocked = /Sign in|bot|HTTP Error 403|age.restrict|Precondition/i.test(stderrBuf);
          if (!dlmgrDone && isBlocked && attempt < YT_PLAYER_CLIENTS.length - 1) {
            attempt++;
            const next = YT_PLAYER_CLIENTS[attempt];
            mainWindow.webContents.send('download-log',
              `⚠ YouTube ha bloccato — riprovo con player: ${next}...\n`);
            setTimeout(tryDownload, 1500);
            return;
          }

          // Rete di sicurezza: se after_move non è arrivato ma il processo è finito con successo, segna comunque come fatto
          if (!dlmgrDone && c === 0) {
            dlmgrSend('dlmgr-item-done', { index: String(n), title: dlmgrTitle, thumb: dlmgrThumb, format, source: 'YouTube' });
          } else if (!dlmgrDone && c !== 0) {
            dlmgrSend('dlmgr-item-done', { index: String(n), title: dlmgrTitle, format, error: 'download fallito' });
          }
          resolve(c);
        });
      }

      tryDownload();
    });
  }

  if (item.source === 'jamendo' || item.source === 'audius' || item.source === 'internetarchive') {
    const nomeFonte = item.source === 'jamendo' ? 'Jamendo' : (item.source === 'audius' ? 'Audius' : 'Internet Archive');
    mainWindow.webContents.send('download-log', `\n🎵 ${nomeFonte} (gratis/CC): ${item.title}\n`);
    dlmgrSend('dlmgr-item-start', { index: String(n), title: item.title, thumb: null });
    mainWindow.webContents.send('now-playing', { videoId: '', title: item.title, index: String(n), thumb: null });
    return new Promise(async (resolve) => {
      try {
        if (!fs.existsSync(destFolder)) fs.mkdirSync(destFolder, { recursive: true });
        const nomeFile = (numeraFile ? num + ' - ' : '') + item.title.replace(/[\\/:*?"<>|]/g, '_') + '.mp3';
        const destPath = path.join(destFolder, nomeFile);
        await downloadFile(item.url, destPath);

        // Queste fonti danno file MP3: se l'utente vuole un altro formato, convertiamo con ffmpeg
        let percorsoFinale = destPath;
        if (format !== 'mp3') {
          const destConvertito = destPath.replace(/\.mp3$/, '.' + format);
          await new Promise((res) => {
            const ff = spawn(path.join(tp, 'ffmpeg.exe'), ['-y', '-i', destPath, destConvertito], { windowsHide: true });
            ff.on('close', () => { try { fs.unlinkSync(destPath); } catch(e){} res(); });
          });
          percorsoFinale = destConvertito;
        }

        let sizeBytes = 0;
        try { sizeBytes = fs.statSync(percorsoFinale).size; } catch(e) {}
        dlmgrSend('dlmgr-item-done', { index: String(n), title: item.title, sizeBytes, format, source: nomeFonte });
        resolve(0);
      } catch(e) {
        dlmgrSend('dlmgr-item-done', { index: String(n), title: item.title, format, error: 'download fallito' });
        resolve(1);
      }
    });
  }

  if (item.source === 'soundcloud') {
    mainWindow.webContents.send('download-log', `\n🟠 SoundCloud: ${item.title}\n`);
    dlmgrSend('dlmgr-item-start', { index: String(n), title: item.title, thumb: null });
    return new Promise((resolve) => {
      let dlmgrDone = false;
      const args = [
        '-x', '--audio-format', format,
        '--ffmpeg-location', path.join(tp, 'ffmpeg.exe'),
        '--output', outputTemplate(destFolder, numeraFile, num),
        '--download-archive', archiveFile,
        '--no-playlist', '--ignore-errors', '--no-abort-on-error',
        '--retries', '5', '--fragment-retries', '5',
        '--print', 'after_move:donefile:%(filepath)s',
        '--newline', '--no-warnings',
        item.url
      ];
      currentProc = spawn(path.join(tp, 'yt-dlp.exe'), args, { windowsHide: true });
      mainWindow.webContents.send('now-playing', { videoId: '', title: item.title, index: String(n), thumb: null });
      let stdoutLineBuf = '';
      let stderrBufSc = '';
      currentProc.stdout.on('data', d => {
        stdoutLineBuf += d.toString();
        const parts0 = stdoutLineBuf.split('\n');
        stdoutLineBuf = parts0.pop();
        for (const line of parts0) {
          if (line.startsWith('donefile:')) {
            const finalPath = line.slice('donefile:'.length).trim();
            if (!dlmgrDone) {
              dlmgrDone = true;
              let sizeBytes = 0;
              try { sizeBytes = fs.statSync(finalPath).size; } catch(e) {}
              dlmgrSend('dlmgr-item-done', { index: String(n), title: item.title, sizeBytes, format, source: 'SoundCloud' });
            }
          } else {
            mainWindow.webContents.send('download-log', line + '\n');
          }
        }
      });
      currentProc.stderr.on('data', d => {
        const testo = d.toString();
        stderrBufSc += testo;
        mainWindow.webContents.send('download-log', testo);
      });
      currentProc.on('close', c => {
        currentProc = null;
        if (!dlmgrDone) {
          const isDrm = /DRM protected/i.test(stderrBufSc);
          dlmgrSend('dlmgr-item-done', c === 0
            ? { index: String(n), title: item.title, format, source: 'SoundCloud' }
            : { index: String(n), title: item.title, format, error: isDrm ? 'protetta da DRM, non scaricabile' : 'download fallito' });
        }
        resolve(c);
      });
    });
  }

  // spotify
  mainWindow.webContents.send('download-log', `\n🟢 Spotify: ${item.title}\n`);
  dlmgrSend('dlmgr-item-start', { index: String(n), title: item.title, thumb: null });
  return new Promise((resolve) => {
    const spotdl = findSpotdl(tp);
    if (!spotdl) { mainWindow.webContents.send('download-log', '❌ spotdl non trovato.\n'); return resolve(2); }
    const spFormat = (format === 'aac') ? 'm4a' : format;
    const spotdlFilename = (numeraFile ? num + ' - ' : '') + '{artists} - {title}.{output-ext}';
    const args = ['download', item.url, '--output', path.join(destFolder, spotdlFilename), '--format', spFormat, '--ffmpeg', path.join(tp, 'ffmpeg.exe'), '--threads', '4'];
    currentProc = spawn(spotdl, args, { windowsHide: true });
    mainWindow.webContents.send('now-playing', { videoId: '', title: item.title, index: String(n), thumb: null });
    currentProc.stdout.on('data', d => mainWindow.webContents.send('download-log', d.toString()));
    currentProc.stderr.on('data', d => mainWindow.webContents.send('download-log', d.toString()));
    currentProc.on('close', c => {
      currentProc = null;
      dlmgrSend('dlmgr-item-done', {
        index: String(n), title: item.title, format, source: 'Spotify',
        error: c !== 0 ? 'download fallito' : null
      });
      resolve(c);
    });
  });
}

// Scarica i brani trovati dalla ricerca testuale, dispatchando per piattaforma
ipcMain.handle('start-search-download', async (_, { items, destFolder, format, archiveFile, numeraFile }) => {
  stopRequested = false;
  running_download_active = true;
  const tp = getToolsPath();
  if (!fs.existsSync(destFolder)) fs.mkdirSync(destFolder, { recursive: true });
  openDownloadManager(items.length, destFolder);

  mainWindow.webContents.send('download-log', `\n▶ Download da lista testo · ${items.length} brani · ${format.toUpperCase()}\n`);
  mainWindow.webContents.send('download-log', `📁 ${destFolder}\n`);

  for (let i = 0; i < items.length; i++) {
    if (stopRequested) {
      mainWindow.webContents.send('download-done', { code: -1, destFolder });
      running_download_active = false;
      dlmgrSend('dlmgr-all-done');
      return true;
    }
    await downloadItemByPlatform(tp, items[i], i, items.length, destFolder, format, archiveFile, numeraFile);
  }

  mainWindow.webContents.send('download-done', { code: 0, destFolder });
  running_download_active = false;
  dlmgrSend('dlmgr-all-done');
  return true;
});

// Scarica una lista di titoli cercando su SoundCloud (yt-dlp gestisce ricerca+download insieme)
async function downloadQueriesSoundcloud(tp, titles, destFolder, format, archiveFile, numeraFile) {
  const total = titles.length;
  for (let i = 0; i < total; i++) {
    if (stopRequested) return -1;
    const n = i + 1;
    const num = String(n).padStart(3, '0');
    mainWindow.webContents.send('download-block', { start: n, end: n, total });
    mainWindow.webContents.send('download-log', `\n🟠 Cerco su SoundCloud: ${titles[i]}\n`);

    await new Promise((resolve) => {
      const args = [
        '-x', '--audio-format', format,
        '--ffmpeg-location', path.join(tp, 'ffmpeg.exe'),
        '--output', outputTemplate(destFolder, numeraFile, num),
        '--download-archive', archiveFile,
        '--no-playlist',
        '--ignore-errors', '--no-abort-on-error',
        '--default-search', 'scsearch1',
        '--retries', '5', '--fragment-retries', '5',
        '--print', 'before_dl:%(id)s|||%(title)s',
        '--newline', '--no-warnings',
        titles[i]
      ];
      currentProc = spawn(path.join(tp, 'yt-dlp.exe'), args, { windowsHide: true });
      currentProc.stdout.on('data', (d) => {
        const lines = d.toString().split('\n');
        for (const line of lines) {
          if (line.includes('|||')) {
            const parts = line.trim().split('|||');
            mainWindow.webContents.send('now-playing', { videoId: '', title: parts[1] ? parts[1].trim() : titles[i], index: String(n), thumb: null });
          } else {
            mainWindow.webContents.send('download-log', line + '\n');
          }
        }
      });
      currentProc.stderr.on('data', d => mainWindow.webContents.send('download-log', d.toString()));
      currentProc.on('close', c => { currentProc = null; resolve(c); });
    });
    if (stopRequested) return -1;
  }
  return 0;
}

// Scarica una lista di titoli cercando su Spotify (spotdl accetta il testo come query diretta)
async function downloadQueriesSpotify(tp, titles, destFolder, format) {
  const spotdl = findSpotdl(tp);
  if (!spotdl) {
    mainWindow.webContents.send('download-log', '❌ spotdl non trovato. Verrà scaricato automaticamente al prossimo avvio.\n');
    return 2;
  }
  const spFormat = (format === 'aac') ? 'm4a' : format;
  const total = titles.length;

  for (let i = 0; i < total; i++) {
    if (stopRequested) return -1;
    const n = i + 1;
    mainWindow.webContents.send('download-block', { start: n, end: n, total });
    mainWindow.webContents.send('download-log', `\n🟢 Cerco su Spotify: ${titles[i]}\n`);

    await new Promise((resolve) => {
      const args = [
        'download', titles[i],
        '--output', destFolder,
        '--format', spFormat,
        '--ffmpeg', path.join(tp, 'ffmpeg.exe'),
        '--threads', '4'
      ];
      currentProc = spawn(spotdl, args, { windowsHide: true });
      const handle = (s) => {
        const lines = s.split('\n');
        for (const line of lines) {
          if (!line.trim()) continue;
          const mDl = line.match(/Downloaded "([^"]+)"/);
          if (mDl) mainWindow.webContents.send('now-playing', { videoId: '', title: mDl[1], index: String(n), thumb: null });
          mainWindow.webContents.send('download-log', line + '\n');
        }
      };
      currentProc.stdout.on('data', d => handle(d.toString()));
      currentProc.stderr.on('data', d => handle(d.toString()));
      currentProc.on('close', c => { currentProc = null; resolve(c); });
    });
    if (stopRequested) return -1;
  }
  return 0;
}

// Handler unico per il download da lista testo su SoundCloud o Spotify
ipcMain.handle('start-list-download-other', async (_, { titles, source, destFolder, format, archiveFile, numeraFile }) => {
  stopRequested = false;
  const tp = getToolsPath();
  if (!fs.existsSync(destFolder)) fs.mkdirSync(destFolder, { recursive: true });

  const nomeSorgente = source === 'spotify' ? 'Spotify' : 'SoundCloud';
  mainWindow.webContents.send('download-log', `\n▶ Lista testo su ${nomeSorgente} · ${titles.length} brani · ${format.toUpperCase()}\n📁 ${destFolder}\n`);

  const code = source === 'spotify'
    ? await downloadQueriesSpotify(tp, titles, destFolder, format)
    : await downloadQueriesSoundcloud(tp, titles, destFolder, format, archiveFile, numeraFile);

  mainWindow.webContents.send('download-done', { code: (stopRequested || code === -1) ? -1 : (code === 2 ? 2 : 0), destFolder });
  return true;
});

// Costruisce il nome file di output: garantisce che l'artista resti sempre nel nome,
// numerato o no. yt-dlp prova artist/creator/uploader/channel in ordine (il primo
// disponibile), utile perché SoundCloud/Spotify spesso mettono il nome dell'autore
// in campi diversi da "title".
function outputTemplate(destFolder, numeraFile, num) {
  const nomeConArtista = '%(artist,creator,uploader,channel)s - %(title)s.%(ext)s';
  const filename = numeraFile ? (num + ' - ' + nomeConArtista) : nomeConArtista;
  return path.join(destFolder, filename);
}

function getToolsPath() {
  // Cerca tools prima accanto all'exe, poi in resources
  const candidates = [
    path.join(path.dirname(app.getPath('exe')), 'tools'),
    path.join(process.resourcesPath || '', 'tools'),
    path.join(__dirname, 'tools')
  ];
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, 'yt-dlp.exe'))) return c;
  }
  return path.join(__dirname, 'tools');
}

// ============================================================
// DOWNLOAD AUTOMATICO DEI TOOL MANCANTI (yt-dlp, ffmpeg, deno)
// Cosi' l'app funziona anche se la cartella tools/ non è stata
// copiata a mano: al primo avvio se li scarica da sola.
// ============================================================

const TOOLS_SOURCES = {
  ytdlp:  'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe',
  deno:   'https://github.com/denoland/deno/releases/latest/download/deno-x86_64-pc-windows-msvc.zip',
  ffmpeg: 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip'
};

// Scarica un file seguendo i redirect (github reindirizza sempre)
function downloadFile(url, destPath, onProgress) {
  return new Promise((resolve, reject) => {
    const doGet = (u, redirects) => {
      if (redirects > 6) return reject(new Error('troppi redirect'));
      const req = https.get(u, { headers: { 'User-Agent': 'SonicDownloader' }, timeout: 30000 }, (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          res.resume();
          return doGet(res.headers.location, redirects + 1);
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error('HTTP ' + res.statusCode));
        }
        const total = parseInt(res.headers['content-length'] || '0', 10);
        let received = 0;
        const file = fs.createWriteStream(destPath);
        // Se il download parte ma si ferma a metà (nessun dato per 30s), non
        // restiamo bloccati per sempre — falliamo con un errore chiaro.
        res.setTimeout(30000, () => {
          res.destroy();
          file.close();
          reject(new Error('connessione bloccata durante il download (timeout)'));
        });
        res.on('data', (chunk) => {
          received += chunk.length;
          if (onProgress) onProgress(received, total);
        });
        res.pipe(file);
        file.on('finish', () => file.close(() => resolve()));
        file.on('error', reject);
      }).on('error', reject);
      // Timeout sulla CONNESSIONE stessa (prima ancora che arrivi una risposta):
      // senza questo, un firewall/antivirus che blocca in silenzio la
      // richiesta la lascia bloccata per sempre senza errore né progresso.
      req.setTimeout(30000, () => {
        req.destroy();
        reject(new Error('connessione non risponde (timeout) — controlla internet/antivirus/firewall'));
      });
    };
    doGet(url, 0);
  });
}

// Estrae uno zip su Windows usando PowerShell (nessuna dipendenza esterna)
function extractZipWindows(zipPath, destDir) {
  return new Promise((resolve, reject) => {
    const proc = spawn('powershell', [
      '-NoProfile', '-Command',
      `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${destDir}' -Force`
    ], { windowsHide: true });
    let err = '';
    proc.stderr.on('data', d => err += d.toString());
    proc.on('close', code => code === 0 ? resolve() : reject(new Error(err || ('exit ' + code))));
    proc.on('error', reject);
  });
}

// Cerca ricorsivamente un file dentro una cartella estratta
function trovaFileRicorsivo(dir, nomeFile) {
  if (!fs.existsSync(dir)) return null;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const trovato = trovaFileRicorsivo(p, nomeFile);
      if (trovato) return trovato;
    } else if (entry.name.toLowerCase() === nomeFile.toLowerCase()) {
      return p;
    }
  }
  return null;
}

function sendToolsProgress(tool, pct, label) {
  if (mainWindow) mainWindow.webContents.send('tools-download-progress', { tool, pct, label });
}

async function scaricaYtDlp(tp) {
  const dest = path.join(tp, 'yt-dlp.exe');
  sendToolsProgress('ytdlp', 0, 'Scarico yt-dlp...');
  await downloadFile(TOOLS_SOURCES.ytdlp, dest, (rec, tot) => {
    sendToolsProgress('ytdlp', tot ? Math.round(rec / tot * 100) : 0, 'Scarico yt-dlp...');
  });
  sendToolsProgress('ytdlp', 100, 'yt-dlp pronto');
}

async function scaricaDeno(tp) {
  const zipPath = path.join(tp, '_deno_tmp.zip');
  const extractDir = path.join(tp, '_deno_extract');
  sendToolsProgress('deno', 0, 'Scarico deno...');
  await downloadFile(TOOLS_SOURCES.deno, zipPath, (rec, tot) => {
    sendToolsProgress('deno', tot ? Math.round(rec / tot * 90) : 0, 'Scarico deno...');
  });
  sendToolsProgress('deno', 92, 'Estraggo deno...');
  await extractZipWindows(zipPath, extractDir);
  const trovato = trovaFileRicorsivo(extractDir, 'deno.exe');
  if (!trovato) throw new Error('deno.exe non trovato nello zip');
  fs.copyFileSync(trovato, path.join(tp, 'deno.exe'));
  try { fs.rmSync(zipPath, { force: true }); fs.rmSync(extractDir, { recursive: true, force: true }); } catch (e) {}
  sendToolsProgress('deno', 100, 'deno pronto');
}

async function scaricaFfmpeg(tp) {
  const zipPath = path.join(tp, '_ffmpeg_tmp.zip');
  const extractDir = path.join(tp, '_ffmpeg_extract');
  sendToolsProgress('ffmpeg', 0, 'Scarico ffmpeg...');
  await downloadFile(TOOLS_SOURCES.ffmpeg, zipPath, (rec, tot) => {
    sendToolsProgress('ffmpeg', tot ? Math.round(rec / tot * 90) : 0, 'Scarico ffmpeg...');
  });
  sendToolsProgress('ffmpeg', 92, 'Estraggo ffmpeg...');
  await extractZipWindows(zipPath, extractDir);
  const trovato = trovaFileRicorsivo(extractDir, 'ffmpeg.exe');
  if (!trovato) throw new Error('ffmpeg.exe non trovato nello zip');
  fs.copyFileSync(trovato, path.join(tp, 'ffmpeg.exe'));
  try { fs.rmSync(zipPath, { force: true }); fs.rmSync(extractDir, { recursive: true, force: true }); } catch (e) {}
  sendToolsProgress('ffmpeg', 100, 'ffmpeg pronto');
}

async function scaricaSpotdl(tp) {
  sendToolsProgress('spotdl', 0, 'Cerco l\'ultima versione di spotdl...');
  const { status, json } = await httpsGetJson('https://api.github.com/repos/spotDL/spotify-downloader/releases/latest');
  if (status !== 200 || !json || !json.assets) throw new Error('impossibile leggere le release di spotdl');

  const asset = json.assets.find(a => /^spotdl-.*-win32\.exe$/i.test(a.name));
  if (!asset) throw new Error('asset Windows di spotdl non trovato');

  const dest = path.join(tp, 'spotdl.exe');
  sendToolsProgress('spotdl', 5, 'Scarico spotdl...');
  await downloadFile(asset.browser_download_url, dest, (rec, tot) => {
    sendToolsProgress('spotdl', tot ? Math.round(rec / tot * 100) : 5, 'Scarico spotdl...');
  });
  sendToolsProgress('spotdl', 100, 'spotdl pronto');
}

// Controlla cosa manca e scarica solo quello, uno alla volta
ipcMain.handle('download-missing-tools', async () => {
  const tp = getToolsPath();
  if (!fs.existsSync(tp)) fs.mkdirSync(tp, { recursive: true });

  const risultato = { ytdlp: true, ffmpeg: true, deno: true, spotdl: true, errori: [] };

  if (!fs.existsSync(path.join(tp, 'yt-dlp.exe'))) {
    try { await scaricaYtDlp(tp); } catch (e) { risultato.ytdlp = false; risultato.errori.push('yt-dlp: ' + e.message); }
  }
  if (!fs.existsSync(path.join(tp, 'ffmpeg.exe'))) {
    try { await scaricaFfmpeg(tp); } catch (e) { risultato.ffmpeg = false; risultato.errori.push('ffmpeg: ' + e.message); }
  }
  if (!fs.existsSync(path.join(tp, 'deno.exe'))) {
    try { await scaricaDeno(tp); } catch (e) { risultato.deno = false; risultato.errori.push('deno: ' + e.message); }
  }
  if (!findSpotdl(tp)) {
    try { await scaricaSpotdl(tp); } catch (e) { risultato.spotdl = false; risultato.errori.push('spotdl: ' + e.message); }
  }
  return risultato;
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100, height: 780, minWidth: 820, minHeight: 640,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false,
      webviewTag: true
    },
    title: 'SonicDownloader',
    icon: path.join(__dirname, 'icon.ico'),
    backgroundColor: '#0d0d1a',
    show: false, autoHideMenuBar: true
  });
  mainWindow.loadFile('index.html');
  mainWindow.once('ready-to-show', () => mainWindow.show());
}

// ── Finestra separata "Download in corso" (stile 4K YouTube to MP3) ──
let dlmgrWindow = null;

function openDownloadManager(total, destFolder) {
  if (dlmgrWindow && !dlmgrWindow.isDestroyed()) {
    dlmgrWindow.show();
    dlmgrWindow.focus();
  } else {
    dlmgrWindow = new BrowserWindow({
      width: 480, height: 620, minWidth: 380, minHeight: 400,
      webPreferences: {
        preload: path.join(__dirname, 'preload-dlmgr.js'),
        contextIsolation: true, nodeIntegration: false
      },
      title: 'SonicDownloader — Download in corso',
      icon: path.join(__dirname, 'icon.ico'),
      backgroundColor: '#f4f5f7',
      autoHideMenuBar: true,
      parent: mainWindow
    });
    dlmgrWindow.loadFile('download-manager.html');
    dlmgrWindow.on('closed', () => { dlmgrWindow = null; });
  }
  dlmgrSend('dlmgr-init', { total, destFolder });
}

function dlmgrSend(channel, data) {
  if (dlmgrWindow && !dlmgrWindow.isDestroyed()) {
    dlmgrWindow.webContents.send(channel, data);
  }
}

// Rete di sicurezza: se per qualche motivo il tracking dettagliato per-brano
// non è mai scattato durante un download (es. certi scenari di playlist con
// avviso di autenticazione, dove il riconoscimento riga-per-riga può fallire
// silenziosamente pur riuscendo comunque il download), questo evento forza
// la finestra "Download in corso" a mostrare il completamento reale invece
// di restare bloccata a "0 di X".
function dlmgrSegnaCompletatoComunque(total) {
  dlmgrSend('dlmgr-bulk-complete', { total });
}

ipcMain.on('dlmgr-stop-or-close', () => {
  if (running_download_active) {
    stopRequested = true;
    killProc();
  } else if (dlmgrWindow && !dlmgrWindow.isDestroyed()) {
    dlmgrWindow.close();
  }
});

let running_download_active = false;

app.whenReady().then(() => {
  createWindow();
  // Controllo generale aggiornamenti in background all'avvio, uno alla volta
  // per non sovraccaricare la connessione. ffmpeg escluso: i build che usiamo
  // non hanno un numero di versione confrontabile in modo affidabile.
  setTimeout(() => autoUpdateYtDlp(), 5000);
  setTimeout(() => autoUpdateSpotdl(), 9000);
  setTimeout(() => autoUpdateDeno(), 13000);
  setTimeout(() => autoUpdateSonicDownloader(), 3000);
});
app.on('window-all-closed', () => {
  if (currentProc) { try { process.kill(-currentProc.pid); } catch(e) { currentProc.kill(); } }
  app.quit();
});

// ── Impostazioni persistenti (cartella predefinita ecc.) ──
function getSettingsPath() {
  return path.join(app.getPath('userData'), 'sonic-settings.json');
}
function loadSettings() {
  try {
    return JSON.parse(fs.readFileSync(getSettingsPath(), 'utf8'));
  } catch(e) {
    return {};
  }
}
function saveSettings(obj) {
  try {
    const current = loadSettings();
    fs.writeFileSync(getSettingsPath(), JSON.stringify({ ...current, ...obj }, null, 2));
  } catch(e) {}
}

ipcMain.handle('get-default-folder', async () => {
  const s = loadSettings();
  return s.defaultFolder || null;
});
ipcMain.handle('set-default-folder', async (_, folder) => {
  saveSettings({ defaultFolder: folder });
  return true;
});

ipcMain.handle('choose-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
  return result.canceled ? null : result.filePaths[0];
});

// Ricostruisce l'archivio scansionando i file già scaricati
// Lista completa {id, index} della playlist: usa l'API se c'e' la chiave
// (nessun limite a 200), altrimenti ricade su yt-dlp.
async function getPlaylistEntries(tp, url) {
  const apiKey = resolveApiKey();
  const plId = extractPlaylistId(url);
  if (apiKey && plId) {
    const res = await getPlaylistViaApi(apiKey, apiPlaylistId(plId));
    if (res.ok) return res.ids.map((id, i) => ({ id, index: i + 1 }));
    mainWindow.webContents.send('download-log', `↩ API non disponibile (${res.error}), uso yt-dlp...\n`);
  }
  const out = await getFullPlaylistIds(tp, url);
  const entries = [];
  out.trim().split('\n').filter(Boolean).forEach(line => {
    const parts = line.split('|||');
    if (parts.length >= 2) entries.push({ id: parts[0].trim(), index: parseInt(parts[1].trim()) });
  });
  return entries;
}

ipcMain.handle('rebuild-archive', async (_, { destFolder, archiveFile, url }) => {
  const tp = getToolsPath();
  mainWindow.webContents.send('download-log', '🔍 Recupero lista completa dalla playlist...\n');

  const entries = await getPlaylistEntries(tp, url);

  let existingFiles = [];
  try { existingFiles = fs.readdirSync(destFolder); } catch(e) {}

  const downloadedIndexes = new Set();
  existingFiles.forEach(f => {
    const m = f.match(/^(\d+)\s*-/);
    if (m) downloadedIndexes.add(parseInt(m[1]));
  });

  const archiveLines = [];
  entries.forEach(e => {
    if (downloadedIndexes.has(e.index)) archiveLines.push(`youtube ${e.id}`);
  });

  try {
    fs.writeFileSync(archiveFile, archiveLines.join('\n') + '\n');
    return { ok: true, count: archiveLines.length, total: entries.length };
  } catch(e) {
    return { ok: false, count: 0, total: 0 };
  }
});

ipcMain.handle('delete-archive', async (_, archiveFile) => {
  try {
    if (fs.existsSync(archiveFile)) {
      fs.unlinkSync(archiveFile);
      return true;
    }
    return false;
  } catch(e) { return false; }
});

ipcMain.handle('open-folder', async (_, folderPath) => {
  if (fs.existsSync(folderPath)) shell.openPath(folderPath);
});

ipcMain.handle('check-tools', async () => {
  const tp = getToolsPath();
  return {
    ytdlp:  fs.existsSync(path.join(tp, 'yt-dlp.exe')),
    ffmpeg: fs.existsSync(path.join(tp, 'ffmpeg.exe')),
    deno:   fs.existsSync(path.join(tp, 'deno.exe')),
    spotdl: !!findSpotdl(tp),
    toolsPath: tp
  };
});

ipcMain.handle('get-playlist-name', async (_, url) => {
  const tp = getToolsPath();
  return new Promise((resolve) => {
    const proc = spawn(path.join(tp, 'yt-dlp.exe'), [
      '--flat-playlist', '--playlist-items', '1',
      '--extractor-args', 'youtubetab:skip=webpage,authcheck',
      '--print', '%(playlist_title)s',
      '--js-runtimes', `deno:${path.join(tp, 'deno.exe')}`,
      url
    ]);
    let out = '';
    proc.stdout.on('data', d => out += d.toString());
    proc.on('close', () => resolve(out.trim().split('\n')[0] || ''));
    setTimeout(() => { try { proc.kill(); } catch(e){} resolve(''); }, 15000);
  });
});

ipcMain.handle('get-playlist-count', async (_, url) => {
  const tp = getToolsPath();
  return new Promise((resolve) => {
    // %(playlist_count)s legge il totale dai metadati YouTube senza scaricare tutta la lista
    const proc = spawn(path.join(tp, 'yt-dlp.exe'), [
      '--flat-playlist',
      '--playlist-items', '1',
      '--extractor-args', 'youtubetab:skip=webpage,authcheck',
      '--print', '%(playlist_count)s',
      '--js-runtimes', `deno:${path.join(tp, 'deno.exe')}`,
      '--no-warnings',
      url
    ], { windowsHide: true });
    let out = '';
    proc.stdout.on('data', d => out += d.toString());
    proc.stderr.on('data', () => {});
    proc.on('close', () => {
      const lines = out.trim().split('\n').filter(l => l.trim() && /^\d+$/.test(l.trim()));
      const num = lines.length > 0 ? parseInt(lines[0]) : 0;
      resolve(isNaN(num) ? 0 : num);
    });
    setTimeout(() => { try { proc.kill(); } catch(e){} resolve(0); }, 30000);
  });
});

// Ottieni lista completa ID con indice — paginando a blocchi da 100
async function getFullPlaylistIds(tp, url) {
  let allOut = '';
  let start = 1;
  while (true) {
    const end = start + 99;
    const out = await new Promise((resolve) => {
      const proc = spawn(path.join(tp, 'yt-dlp.exe'), [
        '--flat-playlist',
        '--playlist-items', `${start}-${end}`,
        '--extractor-args', 'youtubetab:skip=webpage,authcheck',
        '--print', '%(id)s|||%(playlist_index)s',
        '--js-runtimes', `deno:${path.join(tp, 'deno.exe')}`,
        '--no-warnings',
        url
      ], { windowsHide: true });
      let o = '';
      proc.stdout.on('data', d => o += d.toString());
      proc.stderr.on('data', () => {});
      proc.on('close', () => resolve(o));
      setTimeout(() => { try { proc.kill(); } catch(e){} resolve(o); }, 60000);
    });

    const lines = out.trim().split('\n').filter(l => l.includes('|||'));
    if (lines.length === 0) break; // nessun brano in questo blocco = fine playlist
    allOut += out;
    mainWindow.webContents.send('download-log', `📋 Recuperati brani ${start}–${start + lines.length - 1}...\n`);
    if (lines.length < 100) break; // blocco incompleto = ultimo blocco
    start += 100;
  }
  return allOut;
}

function fetchThumbnail(videoId) {
  return new Promise((resolve) => {
    const url = `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`;
    https.get(url, (res) => {
      if (res.statusCode !== 200) return resolve(null);
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve('data:image/jpeg;base64,' + Buffer.concat(chunks).toString('base64')));
    }).on('error', () => resolve(null));
    setTimeout(() => resolve(null), 5000);
  });
}

function killProc() {
  if (!currentProc) return;
  try {
    // Windows: usa taskkill per uccidere tutto l'albero di processi
    spawn('taskkill', ['/pid', currentProc.pid.toString(), '/f', '/t'], { windowsHide: true });
  } catch(e) {
    try { currentProc.kill('SIGKILL'); } catch(e2) {}
  }
  currentProc = null;
}

// Scarica UN blocco della playlist (es. brani 1-100, poi 101-200...).
// Risolve { code, processed }: processed = quanti brani yt-dlp ha effettivamente
// visto in questo blocco (scaricati + saltati). 0 = blocco oltre la fine playlist.
function downloadBlock(tp, url, destFolder, format, archiveFile, startIdx, endIdx, totalTracks, numeraFile) {
  return new Promise((resolve) => {
    if (stopRequested) return resolve({ code: -1, processed: 0 });

    let processed = 0;
    let attempt = 0;
    let stderrBuf = '';

    function tryDownload() {
      if (stopRequested) return resolve({ code: -1, processed });
      const clientArgs = getPlayerClientArgs(attempt);
      const nomeConArtista = '%(artist,creator,uploader,channel)s - %(title)s.%(ext)s';
      const outputPattern = numeraFile
        ? '%(playlist_index)03d - ' + nomeConArtista
        : nomeConArtista;
      const args = [
        '-x', '--audio-format', format,
        '--ffmpeg-location', path.join(tp, 'ffmpeg.exe'),
        '--js-runtimes', `deno:${path.join(tp, 'deno.exe')}`,
        ...getCookieArgs(),
        '--output', path.join(destFolder, outputPattern),
        '--download-archive', archiveFile,
        '--playlist-items', `${startIdx}-${endIdx}`,
        '--extractor-args', 'youtubetab:skip=webpage,authcheck',
        ...clientArgs,
        '--ignore-errors', '--no-abort-on-error',
        '--retries', '5', '--fragment-retries', '5',
        '--sleep-interval', '1', '--max-sleep-interval', '3',
        '--print', 'before_dl:%(id)s|||%(title)s|||%(playlist_index)s',
        '--print', 'after_move:donefile:%(id)s|||%(filepath)s',
        '--newline', '--no-warnings', '--yes-playlist',
        url
      ];
      stderrBuf = '';
      const dlmgrItemsByVideoId = {}; // videoId -> { index, title, thumb, done }
      let stdoutLineBuf = ''; // buffer per righe spezzate tra un chunk e l'altro
      currentProc = spawn(path.join(tp, 'yt-dlp.exe'), args, { windowsHide: true });

      currentProc.stdout.on('data', async (d) => {
        stdoutLineBuf += d.toString();
        const parts0 = stdoutLineBuf.split('\n');
        // L'ultimo pezzo potrebbe essere una riga incompleta: la teniamo per il prossimo chunk
        stdoutLineBuf = parts0.pop();
        const lines = parts0;
        for (const line of lines) {
          if (line.startsWith('donefile:')) {
            // File completato e spostato nella destinazione finale (metodo ufficiale yt-dlp)
            const rest = line.slice('donefile:'.length);
            const sepIdx = rest.indexOf('|||');
            if (sepIdx > -1) {
              const videoId = rest.slice(0, sepIdx).trim();
              const finalPath = rest.slice(sepIdx + 3).trim();
              const info = dlmgrItemsByVideoId[videoId];
              if (info && !info.done) {
                info.done = true;
                let sizeBytes = 0;
                try { sizeBytes = fs.statSync(finalPath).size; } catch(e) {}
                dlmgrSend('dlmgr-item-done', {
                  index: info.index, title: info.title, thumb: info.thumb, sizeBytes, format
                });
              }
            }
          } else if (line.includes('|||')) {
            processed++;
            const parts = line.trim().split('|||');
            if (parts.length >= 2) {
              const videoId = parts[0].trim();
              const title = parts[1].trim();
              const index = parts[2] ? parts[2].trim() : '';
              mainWindow.webContents.send('now-playing', { videoId, title, index, thumb: null });
              dlmgrItemsByVideoId[videoId] = { index, title, thumb: null, done: false };
              dlmgrSend('dlmgr-item-start', { index, title, thumb: null });
              const thumb = await fetchThumbnail(videoId);
              if (thumb) {
                mainWindow.webContents.send('now-playing', { videoId, title, index, thumb });
                if (dlmgrItemsByVideoId[videoId]) dlmgrItemsByVideoId[videoId].thumb = thumb;
                dlmgrSend('dlmgr-item-start', { index, title, thumb });
              }
            }
          } else {
            if (line.includes('has already been recorded')) processed++;
            const mi = line.match(/\[download\] Downloading item (\d+) of (\d+)/);
            if (mi) {
              const cur = (startIdx - 1) + parseInt(mi[1]);
              const tot = totalTracks > 0 ? totalTracks : parseInt(mi[2]);
              mainWindow.webContents.send('download-block', { start: cur, end: cur, total: tot });
            }
            mainWindow.webContents.send('download-log', line + '\n');
          }
        }
      });

      currentProc.stderr.on('data', d => {
        stderrBuf += d.toString();
        mainWindow.webContents.send('download-log', d.toString());
      });

      currentProc.on('close', (code) => {
        currentProc = null;
        if (stopRequested) return resolve({ code: -1, processed });
        const isBlocked = /Sign in|bot|HTTP Error 403|age.restrict|Precondition/i.test(stderrBuf);
        if (code !== 0 && isBlocked && attempt < YT_PLAYER_CLIENTS.length - 1) {
          attempt++;
          const next = YT_PLAYER_CLIENTS[attempt];
          mainWindow.webContents.send('download-log',
            `⚠ YouTube ha bloccato — riprovo con player: ${next}...\n`);
          setTimeout(tryDownload, 2000);
          return;
        }
        // Rete di sicurezza: se qualche item è rimasto "in corso" senza mai ricevere
        // il segnale di completamento (after_move), lo segna comunque come fatto/errore
        // così non resta bloccato per sempre nella finestra "Download in corso".
        Object.keys(dlmgrItemsByVideoId).forEach(vid => {
          const info = dlmgrItemsByVideoId[vid];
          if (!info.done) {
            info.done = true;
            dlmgrSend('dlmgr-item-done', code === 0
              ? { index: info.index, title: info.title, thumb: info.thumb, format }
              : { index: info.index, title: info.title, format, error: 'interrotto' });
          }
        });
        resolve({ code: stopRequested ? -1 : code, processed });
      });
    }

    tryDownload();
  });
}

// Scarica TUTTA la playlist paginando a blocchi di 100 (aggira il limite
// di 100 brani della paginazione automatica di YouTube).
async function downloadAll(tp, url, destFolder, format, archiveFile, totalTracks, numeraFile) {
  let start = 1;
  let lastCode = 0;
  // Limite di sicurezza anti-loop quando il totale non è noto.
  const hardMax = totalTracks > 0 ? totalTracks : 100000;

  while (start <= hardMax) {
    if (stopRequested) return -1;
    const end = start + 99;

    mainWindow.webContents.send('download-log', `\n▶ Scarico brani ${start}–${end}...\n`);

    const res = await downloadBlock(tp, url, destFolder, format, archiveFile, start, end, totalTracks, numeraFile);
    if (stopRequested) return -1;
    lastCode = res.code;

    if (totalTracks > 0) {
      // Totale noto: ci fermiamo quando il blocco ha coperto l'ultimo brano.
      if (end >= totalTracks) break;
    } else {
      // Totale ignoto: ci fermiamo a un blocco vuoto o incompleto (ultima pagina).
      if (res.processed === 0) break;
      if (res.processed < 100) break;
    }
    start += 100;
  }
  return lastCode;
}

ipcMain.handle('start-download', async (_, { url, destFolder, format, archiveFile, totalTracks, isSingle, singleTitle, numeraFile }) => {
  const tp = getToolsPath();
  stopRequested = false;
  running_download_active = true;
  openDownloadManager(isSingle ? 1 : (parseInt(totalTracks) || 1), destFolder);

  // Se è un singolo video, usa destFolder direttamente (già calcolata dal frontend)
  if (isSingle) {
    if (!fs.existsSync(destFolder)) fs.mkdirSync(destFolder, { recursive: true });
    mainWindow.webContents.send('download-log', `\n▶ Download singolo · ${format.toUpperCase()}\n`);
    mainWindow.webContents.send('download-log', `📁 ${destFolder}\n`);
    mainWindow.webContents.send('download-block', { start: 0, end: 0, total: 1 });
    dlmgrSend('dlmgr-item-start', { index: '1', title: singleTitle || url, thumb: null });

    // Conta i file prima del download per verificare se ne arriva uno nuovo
    let filesBefore = [];
    try { filesBefore = fs.readdirSync(destFolder); } catch(e) {}

    const code = await downloadSingle(tp, url, destFolder, format);

    if (stopRequested || code === -1) {
      mainWindow.webContents.send('download-done', { code: -1, destFolder });
    } else if (code === 0) {
      mainWindow.webContents.send('download-block', { start: 1, end: 1, total: 1 });
      dlmgrSend('dlmgr-item-done', { index: '1', title: singleTitle || url, format, source: 'YouTube' });
      mainWindow.webContents.send('download-done', { code: 0, destFolder });
    } else if (code === 2) {
      mainWindow.webContents.send('download-log', `❌ Download non avviato. Possibili cause:\n`);
      mainWindow.webContents.send('download-log', `   • Link non valido o video non disponibile\n`);
      mainWindow.webContents.send('download-log', `   • Cookie mancanti (video con età o login richiesto)\n`);
      mainWindow.webContents.send('download-log', `   • Connessione internet assente\n`);
      dlmgrSend('dlmgr-item-done', { index: '1', title: singleTitle || url, format, error: 'non avviato' });
      mainWindow.webContents.send('download-done', { code: 2, destFolder });
    } else {
      mainWindow.webContents.send('download-log', `❌ Download fallito (codice ${code}). Controlla il log sopra.\n`);
      dlmgrSend('dlmgr-item-done', { index: '1', title: singleTitle || url, format, error: 'download fallito' });
      mainWindow.webContents.send('download-done', { code: 1, destFolder });
    }
    running_download_active = false;
    dlmgrSend('dlmgr-all-done');
    return true;
  }

  if (!fs.existsSync(destFolder)) fs.mkdirSync(destFolder, { recursive: true });

  // ── Rilevamento piattaforma: SoundCloud e Spotify hanno percorsi propri ──
  const platform = detectPlatform(url);
  if (platform === 'spotify') {
    mainWindow.webContents.send('download-log', `\n▶ Spotify (via spotdl) · ${format.toUpperCase()}\n📁 ${destFolder}\n`);
    dlmgrSend('dlmgr-item-start', { index: '1', title: url, thumb: null });
    const sc = await downloadSpotify(tp, url, destFolder, format);
    dlmgrSend('dlmgr-item-done', sc === 0
      ? { index: '1', title: url, format, source: 'Spotify' }
      : { index: '1', title: url, format, error: 'download fallito' });
    mainWindow.webContents.send('download-done', { code: (stopRequested || sc === -1) ? -1 : sc, destFolder });
    running_download_active = false;
    dlmgrSend('dlmgr-all-done');
    return true;
  }
  if (platform === 'soundcloud') {
    mainWindow.webContents.send('download-log', `\n▶ SoundCloud · ${format.toUpperCase()}\n📁 ${destFolder}\n`);
    dlmgrSend('dlmgr-item-start', { index: '1', title: url, thumb: null });
    const sc = await downloadSoundCloud(tp, url, destFolder, format, archiveFile);
    dlmgrSend('dlmgr-item-done', sc === 0
      ? { index: '1', title: url, format, source: 'SoundCloud' }
      : { index: '1', title: url, format, error: 'download fallito' });
    mainWindow.webContents.send('download-done', { code: (stopRequested || sc === -1) ? -1 : sc, destFolder });
    running_download_active = false;
    dlmgrSend('dlmgr-all-done');
    return true;
  }

  const apiKey = resolveApiKey();
  const plId = extractPlaylistId(url);
  let code = 0;

  if (apiKey && plId) {
    // --- METODO API UFFICIALE: lista completa, niente limite a 200 ---
    mainWindow.webContents.send('download-log', `\n▶ Modalità API ufficiale: recupero la lista completa...\n`);
    const res = await getPlaylistViaApi(apiKey, apiPlaylistId(plId));
    if (stopRequested) {
      mainWindow.webContents.send('download-done', { code: -1, destFolder });
      running_download_active = false;
      dlmgrSend('dlmgr-all-done');
      return true;
    }
    if (!res.ok) {
      mainWindow.webContents.send('download-log', `❌ Errore API: ${res.error}\n`);
      mainWindow.webContents.send('download-log', `↩ Passo al metodo normale (yt-dlp)...\n`);
      const tot = parseInt(totalTracks) || 0;
      code = await downloadAll(tp, url, destFolder, format, archiveFile, tot, numeraFile);
      if (code === 0 && tot > 0) dlmgrSegnaCompletatoComunque(tot);
    } else {
      mainWindow.webContents.send('download-log', `✔ Trovati ${res.ids.length} brani via API. Inizio il download...\n`);
      mainWindow.webContents.send('download-block', { start: 0, end: 0, total: res.ids.length });
      code = await downloadByIds(tp, res.ids, destFolder, format, archiveFile, numeraFile);
    }
  } else {
    // --- METODO NORMALE (yt-dlp a blocchi): si ferma dove arriva yt-dlp ---
    const tot = parseInt(totalTracks) || 0;
    mainWindow.webContents.send('download-log', `\n▶ Scarico la playlist a blocchi di 100 brani...\n`);
    if (tot > 0) mainWindow.webContents.send('download-block', { start: 0, end: 0, total: tot });
    code = await downloadAll(tp, url, destFolder, format, archiveFile, tot, numeraFile);
      if (code === 0 && tot > 0) dlmgrSegnaCompletatoComunque(tot);
  }

  if (stopRequested || code === -1) {
    mainWindow.webContents.send('download-done', { code: -1, destFolder });
  } else {
    mainWindow.webContents.send('download-done', { code: 0, destFolder });
  }
  running_download_active = false;
  dlmgrSend('dlmgr-all-done');
  return true;
});

// STOP: uccide davvero il processo
ipcMain.on('stop-download', () => {
  stopRequested = true;
  killProc();
  mainWindow.webContents.send('download-log', '\n⛔ Download interrotto.\n');
  mainWindow.webContents.send('download-done', { code: -1 });
});
