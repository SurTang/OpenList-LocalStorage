@echo off
setlocal
title OpenList File Server
cd /d "%~dp0"

if not exist "%~dp0openlist.exe" (
  echo [ERROR] openlist.exe not found in %~dp0
  echo.
  pause
  exit /b 1
)

rem Port and data dir can be overridden by environment variables.
if "%OPENLIST_HTTP_PORT%"=="" set "OPENLIST_HTTP_PORT=5245"
if "%OPENLIST_ADDR%"=="" set "OPENLIST_ADDR=0.0.0.0"

echo ================================================
echo   OpenList File Server
echo   URL  : http://127.0.0.1:%OPENLIST_HTTP_PORT%
echo   Data : %~dp0data
echo   Stop : press Ctrl+C
echo ================================================
echo.

"%~dp0openlist.exe" server --data "%~dp0data"
set "EXITCODE=%ERRORLEVEL%"

echo.
echo Server stopped, exit code = %EXITCODE%
pause
