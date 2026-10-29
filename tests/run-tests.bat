@echo off
REM Every test of the repository: tools\run-tests.mjs says what it runs. Add
REM --browser for the browser tests. Double-click this file, or run
REM `tests\run-tests.bat [--browser]` from a terminal.
cd /d "%~dp0\.."
node tools\run-tests.mjs %*
exit /b %errorlevel%
