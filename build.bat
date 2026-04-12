@echo off
setlocal

echo.
echo  ======================================
echo   Claude Code Proxy - Release Build
echo  ======================================
echo.

cargo build --release
if %ERRORLEVEL% neq 0 (
    echo.
    echo  BUILD FAILED
    exit /b 1
)

echo.
echo  Build successful!
echo.
echo  Binary: target\release\claude-proxy.exe
echo.

for %%A in (target\release\claude-proxy.exe) do echo  Size: %%~zA bytes

echo.
echo  Usage:
echo    claude-proxy.exe --target https://api.anthropic.com
echo.
echo  Options:
echo    --port 8000              Proxy port
echo    --dashboard-port 3000    Dashboard port
echo    --open-browser           Auto-open dashboard
echo    --auto-configure         Auto-set ANTHROPIC_BASE_URL in settings.json
echo    --data-dir PATH          Storage directory
echo    --stall-threshold 0.5    Stall detection threshold (seconds)
echo    --slow-ttft-threshold 3000  Slow TTFT threshold (ms)
echo    --max-body-size 2097152  Max body to store (bytes)
echo.
