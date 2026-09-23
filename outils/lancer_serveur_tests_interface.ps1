$ErrorActionPreference = "Stop"
# Interpréteur : PORTAIL_RH_PYTHON s'il est fourni, sinon celui de DEMARRER.bat.
$python = $env:PORTAIL_RH_PYTHON
if (-not $python) { $python = Join-Path $env:LOCALAPPDATA "Portail-RH\venv\Scripts\python.exe" }
if (-not (Test-Path -LiteralPath $python)) {
    throw "Environnement Python absent. Lancez DEMARRER.bat une première fois."
}
& $python (Join-Path $PSScriptRoot "serveur_tests_interface.py")
exit $LASTEXITCODE
