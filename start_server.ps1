param(
    [switch]$NoBrowser
)

$Host.UI.RawUI.WindowTitle = "ScriptureCast Server"

# Kill any existing python process on port 8000
$port = 8000
try {
    $conn = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
    if ($conn) {
        Write-Host "Port $port in use by PID $($conn.OwningProcess). Killing..." -ForegroundColor Yellow
        Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 2
    }
} catch {}

Set-Location -LiteralPath "$PSScriptRoot"

Write-Host "====================================================" -ForegroundColor Cyan
Write-Host "  ScriptureCast Server Starting" -ForegroundColor Cyan
Write-Host "====================================================" -ForegroundColor Cyan
Write-Host "  Dashboard   -> http://localhost:$port" -ForegroundColor Green
Write-Host "  Screen      -> http://localhost:$port/screen" -ForegroundColor Green
Write-Host "  API Docs    -> http://localhost:$port/docs" -ForegroundColor Green
Write-Host "====================================================" -ForegroundColor Cyan
Write-Host "  Close this window to stop the server`n" -ForegroundColor Yellow

# Open browser unless -NoBrowser flag
if (-not $NoBrowser) {
    Start-Process "http://localhost:$port"
}

python run.py

# If server exits, wait for key press
Write-Host "`nServer stopped. Press any key to exit..." -ForegroundColor Yellow
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
