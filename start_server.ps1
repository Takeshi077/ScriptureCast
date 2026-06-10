param(
    [switch]$NoBrowser
)

$Host.UI.RawUI.WindowTitle = "ScriptureCast Server"

$port = 8000
$logDir = Split-Path -Parent $PSCommandPath

# Kill any existing process on port 8000
try {
    $conn = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
    if ($conn) {
        Write-Host "Port $port in use by PID $($conn.OwningProcess). Killing..." -ForegroundColor Yellow
        Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 2
    }
} catch {}

Set-Location -LiteralPath $logDir

Write-Host "====================================================" -ForegroundColor Cyan
Write-Host "  ScriptureCast Server Starting" -ForegroundColor Cyan
Write-Host "====================================================" -ForegroundColor Cyan
Write-Host "  Dashboard   -> http://localhost:$port" -ForegroundColor Green
Write-Host "  Screen      -> http://localhost:$port/screen" -ForegroundColor Green
Write-Host "  API Docs    -> http://localhost:$port/docs" -ForegroundColor Green
Write-Host "====================================================" -ForegroundColor Cyan
Write-Host "  Close this window to stop the server`n" -ForegroundColor Yellow

if (-not $NoBrowser) {
    Start-Process "http://localhost:$port"
}

python run.py 2>&1 | Tee-Object -FilePath (Join-Path $logDir "server_err.log")

Write-Host "`nServer stopped. Press any key to exit..." -ForegroundColor Yellow
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
