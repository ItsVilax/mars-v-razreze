@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title Mars in Section — local atlas

where py >nul 2>nul
if %errorlevel%==0 (
  py -3 serve.py %*
  goto :done
)

where python >nul 2>nul
if %errorlevel%==0 (
  python serve.py %*
  goto :done
)

echo.
echo Python 3 not found.
echo Install Python 3 from https://www.python.org/downloads/ and tick
echo "Add Python to PATH", then run start.bat again.
echo.
pause

:done
endlocal
