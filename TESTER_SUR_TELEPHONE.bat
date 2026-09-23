@echo off
chcp 65001 >nul
title Portail RH - essai sur telephone
rem Instance d'essai visible du Wi-Fi de la maison. Voir outils\serveur_telephone.py.

set "PY=%LOCALAPPDATA%\Portail-RH\venv\Scripts\python.exe"
if not exist "%PY%" (
  echo L'environnement Python est absent : lancez d'abord DEMARRER.bat une fois.
  pause
  exit /b 1
)

echo.
echo   Quelles donnees afficher sur le telephone ?
echo.
echo   1 - Donnees reelles : vrais noms et vrai organigramme
echo       (copie de la base, effacee a l'arret, votre propre compte)
echo   2 - Donnees de demonstration : personnel fictif
echo.
choice /c 12 /n /m "  Votre choix (1 ou 2) : "
if errorlevel 2 (set "MODE=--demo") else (set "MODE=--reel")

cd /d "%~dp0backend"
"%PY%" ..\outils\serveur_telephone.py %MODE% %*
pause
