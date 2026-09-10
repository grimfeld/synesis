@echo off
setlocal
rem Windows entry point for scripts/dev. Finds Git Bash (installs Git for
rem Windows with winget if it is missing) and runs the bash script with the
rem same arguments. Works from cmd, PowerShell, and Explorer double-click.
rem
rem   scripts\dev              set up, then start the dev app
rem   scripts\dev --no-start   set up only
rem   scripts\dev --skip-tests start without running engine tests

set "PF86=%ProgramFiles(x86)%"
call :find_bash
if defined BASH goto :run

where winget >nul 2>&1
if errorlevel 1 (
  echo Git for Windows is required. Install it from https://git-scm.com/download/win and re-run.
  goto :fail
)
echo Git for Windows not found; installing it with winget...
winget install --id Git.Git --exact --silent --accept-package-agreements --accept-source-agreements
call :find_bash
if not defined BASH (
  echo Git for Windows still not found. Install it from https://git-scm.com/download/win and re-run.
  goto :fail
)

:run
"%BASH%" "%~dp0dev" %*
if errorlevel 1 goto :fail
exit /b 0

:find_bash
set "BASH="
for %%D in ("%ProgramFiles%\Git" "%PF86%\Git" "%LocalAppData%\Programs\Git") do (
  if not defined BASH if exist "%%~D\bin\bash.exe" set "BASH=%%~D\bin\bash.exe"
)
exit /b 0

:fail
echo.
echo scripts\dev failed. See the messages above.
rem Keep the window open when launched by double-click from Explorer
rem (not when scripts/dev.mjs runs us from npm: it sets SYNESIS_DEV_NO_PAUSE).
if defined SYNESIS_DEV_NO_PAUSE exit /b 1
rem (Absolute path: a PATH inherited from Git Bash would resolve "find" to the Unix one.)
echo %cmdcmdline% | "%SystemRoot%\System32\find.exe" /i "%~nx0" >nul && pause
exit /b 1
