@echo off
cd /d "%~dp0"
echo Encerrando o Bot de forma segura...
curl -X POST http://localhost:3000/api/shutdown
echo Bot encerrado.
timeout /t 3