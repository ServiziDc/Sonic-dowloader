@echo off
title SonicDownloader - Pubblica su GitHub
color 0A
cd /d "%~dp0"

echo ========================================
echo   SonicDownloader - Pubblica su GitHub
echo ========================================
echo.

where git >nul 2>nul
if errorlevel 1 (
    echo [ERRORE] Git non e' installato su questo PC.
    echo Scaricalo da: https://git-scm.com/download/win
    pause
    exit /b 1
)

for /f "tokens=2 delims=:," %%v in ('findstr /c:"\"version\"" package.json') do (
    set VERSIONE_RAW=%%v
)
set VERSIONE=%VERSIONE_RAW: =%
set VERSIONE=%VERSIONE:"=%
echo Versione rilevata: %VERSIONE%
echo.

echo node_modules/> .gitignore
echo dist/>> .gitignore
echo tools/*.exe>> .gitignore
echo *.log>> .gitignore
echo CONFIGURA_SECRETS.bat>> .gitignore

REM Cancellazione FORZATA e VERIFICATA della vecchia cronologia. Su Windows
REM a volte rmdir fallisce in silenzio se un file e' ancora "in uso" da un
REM processo precedente: qui riproviamo fino a 5 volte con una pausa, e ci
REM fermiamo con un errore chiaro se proprio non riesce a sparire.
if exist ".git" (
    echo [1/8] Ripulisco la cronologia locale...
    set TENTATIVI=0
    :RETRY_RMDIR
    rmdir /s /q ".git" >nul 2>nul
    if exist ".git" (
        set /a TENTATIVI+=1
        if !TENTATIVI! GEQ 5 (
            echo [ERRORE] Non riesco a cancellare la cartella .git
            echo Chiudi eventuali programmi che potrebbero tenerla aperta
            echo ^(es. un altro terminale, VS Code, un client Git^) e riprova.
            pause
            exit /b 1
        )
        timeout /t 2 /nobreak >nul
        goto RETRY_RMDIR
    )
)
setlocal enabledelayedexpansion

echo [1/8] Inizializzo la repository locale...
git init -q
git branch -M main

echo [2/8] Aggiungo tutti i file...
git add .
git rm -r --cached tools >nul 2>nul
git rm -r --cached dist >nul 2>nul
git rm -r --cached node_modules >nul 2>nul
git rm --cached CONFIGURA_SECRETS.bat >nul 2>nul

REM CONTROLLO ESPLICITO: verifichiamo davvero cosa sta per essere caricato,
REM invece di fidarci e basta. Se un file .exe grande e' ancora tracciato,
REM ci fermiamo qui con un errore chiaro invece di far fallire il push.
echo [3/8] Verifico che non ci siano file troppo grandi...
set TROVATO_GRANDE=0
for /f "delims=" %%f in ('git diff --cached --name-only') do (
    echo %%f | findstr /i "tools/.*\.exe dist/ node_modules/ CONFIGURA_SECRETS.bat" >nul
    if not errorlevel 1 (
        echo [ATTENZIONE] File sospetto ancora tracciato: %%f
        set TROVATO_GRANDE=1
    )
)
if "!TROVATO_GRANDE!"=="1" (
    echo.
    echo [ERRORE] Ci sono ancora file grandi pronti per il commit - vedi sopra.
    echo Non procedo per evitare che GitHub rifiuti di nuovo il caricamento.
    echo Mandami questo messaggio in chat cosi' controllo cosa sta succedendo.
    pause
    exit /b 1
)
echo [OK] Nessun file grande trovato.

echo [4/8] Creo il commit...
for /f "tokens=1-3 delims=/ " %%a in ('date /t') do set OGGI=%%a-%%b-%%c
for /f "tokens=1-2 delims=: " %%a in ('time /t') do set ORA=%%a-%%b
git commit -m "Aggiornamento %OGGI% %ORA%" -q
if errorlevel 1 (
    echo Nessuna modifica da caricare, o commit gia' presente. Continuo comunque.
)

git remote get-url origin >nul 2>nul
if errorlevel 1 (
    echo [5/8] Collego la repository GitHub...
    git remote add origin https://github.com/ServiziDc/Sonic-dowloader.git
) else (
    echo [5/8] Repository GitHub gia' collegata.
)

echo [6/8] Carico il codice su GitHub, potrebbe aprirsi il browser per accedere...
git push -u origin main --force

if errorlevel 1 (
    echo.
    echo [ERRORE] Il caricamento del codice non e' riuscito. Controlla sopra.
    pause
    exit /b 1
)

echo [7/8] Creo il tag v%VERSIONE% per far compilare l'exe da GitHub...
git tag -f "v%VERSIONE%"
git push -f origin "v%VERSIONE%"

echo [8/8] Fatto!
echo.
echo ========================================
echo   Codice caricato con successo!
echo   GitHub sta compilando l'exe in automatico.
echo   Controlla tra 3-5 minuti su:
echo   https://github.com/ServiziDc/Sonic-dowloader/actions
echo   L'exe finito comparira' su:
echo   https://github.com/ServiziDc/Sonic-dowloader/releases
echo ========================================
echo.
pause
