# KahunaAir Dispatch Launcher
# This script starts the app in development mode (which is fully functional and production-ready)

Write-Host "Starting KahunaAir Dispatch..." -ForegroundColor Green
Write-Host ""

# Check if Node.js is installed
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "ERROR: Node.js is not installed or not in PATH" -ForegroundColor Red
    Write-Host "Please install Node.js from https://nodejs.org/" -ForegroundColor Yellow
    Read-Host "Press Enter to exit"
    exit 1
}

# Check if npm is installed
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Host "ERROR: npm is not installed or not in PATH" -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

# Navigate to the app directory
Set-Location $PSScriptRoot
Write-Host "App directory: $PWD" -ForegroundColor Cyan
Write-Host ""

# Install dependencies if needed
if (-not (Test-Path "node_modules")) {
    Write-Host "Installing dependencies..." -ForegroundColor Yellow
    npm install
    Write-Host ""
}

# Start the app
Write-Host "Launching app..." -ForegroundColor Green
Write-Host "Backend server and Vite dev server will start automatically" -ForegroundColor Cyan
Write-Host ""
npm run electron-dev

# If we get here, the app was closed
Write-Host ""
Write-Host "KahunaAir Dispatch closed." -ForegroundColor Gray
Read-Host "Press Enter to exit"
