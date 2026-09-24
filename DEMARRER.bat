@echo off
chcp 65001 >nul
title Portail RH
cd /d "%~dp0backend"

rem L'environnement Python est installe dans le profil Windows, hors du
rem dossier du projet (qui peut etre synchronise par un service de fichiers).
set "ENV=%LOCALAPPDATA%\Portail-RH\venv"
set "PY=%ENV%\Scripts\python.exe"
set PYTHONIOENCODING=utf-8

echo.
echo   ========================================================
echo     PORTAIL RH
echo   ========================================================
echo.

rem --- Serveur deja demarre : relance pour charger la derniere version du code
curl.exe -sf -o nul http://127.0.0.1:8100/api/sante
if %errorlevel%==0 (
  echo   Un serveur tourne deja : redemarrage pour charger la derniere version...
  taskkill /FI "WINDOWTITLE eq Portail RH - SERVEUR*" /T /F >nul 2>&1
  powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 8100 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }"
  timeout /t 2 /nobreak >nul
)

rem --- Environnement Python : cree au premier lancement sur ce poste ------
if exist "%PY%" (
  "%PY%" -c "import fastapi, uvicorn, sqlalchemy, reportlab, openpyxl" 2>nul
  if not errorlevel 1 (
    echo   [1/3] Environnement Python present.
    goto base
  )
  echo   [1/3] Environnement Python incomplet : reparation...
) else (
  echo   [1/3] Premiere installation sur ce poste, patientez deux a trois minutes...
)
set "PYBASE="
for %%V in (3.13 3.12 3.14 3.11) do (
  if not defined PYBASE (
    py -%%V -c "import sys" >nul 2>&1 && set "PYBASE=py -%%V"
  )
)
if not defined PYBASE (
  python -c "import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)" >nul 2>&1 && set "PYBASE=python"
)
if not defined PYBASE (
  echo.
  echo   Python 3.11 ou plus recent est introuvable sur ce poste.
  echo   Installez-le depuis https://www.python.org/downloads/ puis relancez.
  pause
  exit /b 1
)
if not exist "%PY%" %PYBASE% -m venv "%ENV%"
"%PY%" -m pip install --quiet --upgrade pip
"%PY%" -m pip install --quiet -r requirements.txt
if errorlevel 1 (
  echo.
  echo   L'installation des composants a echoue : verifiez la connexion Internet.
  pause
  exit /b 1
)

:base
rem --- Base de donnees ------------------------------------------------------
if exist "data\portail.db" (
  echo   [2/3] Base de donnees presente.
  goto serveur
)
echo   [2/3] Premier lancement : creation de la base de demonstration...
"%PY%" -m app.seed --reset

:serveur
rem --- Serveur : fenetre dediee, qui reste ouverte meme en cas d'erreur ---
echo   [3/3] Demarrage du serveur...
start "Portail RH - SERVEUR (ne pas fermer)" /min cmd /k "chcp 65001 >nul & "%PY%" serveur.py"

rem --- Attente active : le navigateur ne s'ouvre qu'une fois le serveur pret
set /a essais=0
:attente
set /a essais+=1
curl.exe -sf -o nul http://127.0.0.1:8100/api/sante
if %errorlevel%==0 goto pret
if %essais% geq 60 goto echec
<nul set /p "=."
timeout /t 1 /nobreak >nul
goto attente

:pret
echo.
echo   Serveur pret en %essais% seconde(s).

:ouvrir
start "" http://127.0.0.1:8100
echo.
echo   ========================================================
echo     L'application est ouverte dans votre navigateur.
echo.
echo     Adresse : http://127.0.0.1:8100
echo     API     : http://127.0.0.1:8100/api/docs
echo.
echo     IMPORTANT : ne fermez pas la fenetre
echo     "Portail RH - SERVEUR (ne pas fermer)" pendant l'utilisation.
echo     La fermer arrete l'application.
echo   ========================================================
echo.
echo   Vous pouvez fermer cette fenetre-ci.
pause >nul
exit /b 0

:echec
echo.
echo   ========================================================
echo     Le serveur n'a pas repondu apres 60 secondes.
echo.
echo     Ouvrez la fenetre "Portail RH - SERVEUR" dans la barre
echo     des taches : le message d'erreur y est affiche.
echo   ========================================================
pause
exit /b 1
