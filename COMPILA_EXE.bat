@echo off
chcp 65001 >nul
title SonicDownloader v3.30.0 - Creazione INSTALLER
color 0A
echo.
echo =====================================================
echo   SonicDownloader v3.30.0 - Creazione INSTALLER
echo =====================================================
echo.

:: Controlla Node.js
where node >nul 2>&1
if errorlevel 1 (
    echo [ERRORE] Node.js non trovato!
    echo Scaricalo da https://nodejs.org
    pause & exit /b 1
)
echo [OK] Node.js trovato.
where npm >nul 2>&1
if errorlevel 1 ( echo [ERRORE] npm non trovato! & pause & exit /b 1 )
echo [OK] npm trovato.
echo.

cd /d "%~dp0"

:: Chiudi SonicDownloader se aperto
echo Chiudo SonicDownloader se aperto...
taskkill /f /im SonicDownloader.exe >nul 2>&1
taskkill /f /im "Sonic Downloader.exe" >nul 2>&1
timeout /t 2 /nobreak >nul
echo [OK] Pronto.
echo.

:: Installa dipendenze
echo [1/3] Installazione dipendenze npm...
echo       (Prima volta: scarica Electron ~150MB, attendere)
if not exist "node_modules\electron" (
    call npm install
    if errorlevel 1 ( echo [ERRORE] npm install fallito! & pause & exit /b 1 )
) else (
    echo [OK] Dipendenze gia presenti.
)
echo.

:: Pulizia forzata
echo [2/3] Pulizia build precedente...
if exist "dist" (
    rd /s /q dist >nul 2>&1
    if exist "dist" (
        echo [ATTENZIONE] Non riesco a cancellare dist\ - riprovo tra 3 secondi...
        timeout /t 3 /nobreak >nul
        rd /s /q dist >nul 2>&1
    )
)
echo [OK] Pronto per la compilazione.
echo.

:: Compila
echo [3/3] Compilazione installer... (2-5 minuti)
:: Disabilita il download del pacchetto di firma digitale Mac (winCodeSign):
:: non serve per compilare su Windows e la sua estrazione richiede permessi
:: per i link simbolici che Windows nega di default, causando un errore.
set CSC_IDENTITY_AUTO_DISCOVERY=false
call npm run build
echo.

:: Verifica risultato
if exist "dist\SonicDownloader-Setup-3.30.0.exe" (
    echo =====================================================
    echo   INSTALLER CREATO CON SUCCESSO!
    echo   dist\SonicDownloader-Setup-3.30.0.exe
    echo =====================================================
    echo.
    start "" "dist"
) else (
    echo =====================================================
    echo   ERRORE - controlla i messaggi sopra
    echo   Cause comuni:
    echo    - SonicDownloader ancora aperto - CHIUDILO e riprova
    echo    - Antivirus blocca la creazione dell exe
    echo    - Connessione internet assente
    echo =====================================================
)
echo.
pause
