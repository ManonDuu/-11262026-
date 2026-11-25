@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo 未找到 Node.js，请先安装 Node.js 24 LTS，再重新打开终端。
  exit /b 1
)
where npm.cmd >nul 2>nul
if errorlevel 1 exit /b 1
node scripts/check-node.mjs
if errorlevel 1 exit /b 1
if not exist node_modules (
  call npm.cmd ci --no-audit --no-fund
  if errorlevel 1 exit /b 1
)
if not defined PORT set PORT=5180
echo 拼多多工作台02版：http://127.0.0.1:%PORT%/
call npm.cmd run dev -- --host 127.0.0.1 --port %PORT% --strictPort
exit /b %errorlevel%
