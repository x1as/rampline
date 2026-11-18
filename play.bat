@echo off
rem Собирает игру и открывает её в браузере по умолчанию.
cd /d "%~dp0"
where node >nul 2>nul && node src\build.js
start "" "%~dp0dist\index.html"
