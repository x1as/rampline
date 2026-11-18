@echo off
rem Проверки физики и карт: проходимость ботом, гладкость рамп, устойчивость к ошибкам.
cd /d "%~dp0src"
node skilltest.js all 6
node bottest.js
node bumptest.js
node noisetest.js
pause
