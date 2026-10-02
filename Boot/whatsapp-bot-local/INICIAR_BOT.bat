@echo off
title Bot WhatsApp Local - Servidor
cd /d "%~dp0"
echo Iniciando o Servidor do Bot WhatsApp...
start "" http://localhost:3000
npm start