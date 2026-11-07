@echo off
cd /d "%~dp0"
start "" "http://localhost:8793/?version=108"
py -3 -m http.server 8793 2>nul || python -m http.server 8793
