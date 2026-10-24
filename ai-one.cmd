@echo off
chcp 65001 >nul
rem ai-one: double-click to build (first time / after git pull) and open the app.
where node >nul 2>nul
if errorlevel 1 (
  echo 没找到 Node.js。请先安装 Node.js 24 LTS：在 PowerShell 运行  winget install OpenJS.NodeJS.LTS
  echo 装完后关掉这个窗口，再双击 ai-one.cmd。
  pause
  exit /b 1
)
node "%~dp0scripts\start.mjs" %*
if errorlevel 1 pause
