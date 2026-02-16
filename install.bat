@echo off
setlocal
title EPUB Pandoc Architect - Installer

echo Checking dependencies...

:: 1. Check for Node.js
node -v >nul 2>&1
if %errorlevel% neq 0 (
    echo [!] Node.js is not installed.
    echo Opening download page...
    start https://nodejs.org/en/download/prebuilt-installer
    echo Please install Node.js and run this installer again.
    pause
    exit
) else (
    echo [OK] Node.js found.
)

:: 2. Check for Pandoc
pandoc -v >nul 2>&1
if %errorlevel% neq 0 (
    echo [!] Pandoc is not installed.
    echo Opening download page...
    start https://github.com/jgm/pandoc/releases/latest
    echo Download the .msi installer for Windows.
    echo Please install Pandoc and run this installer again.
    pause
    exit
) else (
    echo [OK] Pandoc found.
)

:: 3. Install NPM dependencies
echo Installing project dependencies...
call npm install

:: 4. Create Desktop Shortcut via PowerShell
echo Creating desktop shortcut...
:: Create the runner script with a built-in delay
echo @echo off > "%~dp0run-app.bat"
echo cd /d "%%~dp0" >> "%~dp0run-app.bat"

:: Start the Node server in a new window so it doesn't block the browser launch
echo start "EPUB Architect Server" npm start >> "%~dp0run-app.bat"

:: Wait 3 seconds for the server to boot
echo timeout /t 3 /nobreak > nul >> "%~dp0run-app.bat"

:: Open the browser
echo start "" "http://localhost:3000" >> "%~dp0run-app.bat"

:: Create the desktop shortcut (points to the new run-app.bat)
powershell -Command "$s=(New-Object -COM WScript.Shell).CreateShortcut('%USERPROFILE%\Desktop\EPUB Architect.lnk');$s.TargetPath='%~dp0run-app.bat';$s.WorkingDirectory='%~dp0';$s.IconLocation='shell32.dll,243';$s.Save()"

echo.
echo [OK] Shortcut created on Desktop.
pause