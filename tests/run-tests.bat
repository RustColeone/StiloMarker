@echo off
REM ============================================================================
REM  StlioMarker / mdnotes -- one-click self-test runner (Windows)
REM
REM  Runs the Node.js unit-test suite (tests\) and the Python backend self-test.
REM  Double-click this file, or run `tests\run-tests.bat` from a terminal.
REM ============================================================================

setlocal
REM Move to the repository root (this script lives in tests\).
cd /d "%~dp0\.."

echo.
echo === [1/2] Node.js unit tests ===========================================
call node --test tests
if errorlevel 1 goto :failed

echo.
echo === [2/2] Python backend self-test =====================================
call python server\mdnotes_server.py --selftest
if errorlevel 1 (
  REM Fall back to `python3` if `python` is not the right launcher.
  call python3 server\mdnotes_server.py --selftest
  if errorlevel 1 goto :failed
)

echo.
echo === All tests passed. ==================================================
endlocal
exit /b 0

:failed
echo.
echo *** TESTS FAILED ***
endlocal
exit /b 1
