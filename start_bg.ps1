param(
    [switch]$NoBrowser
)

$port = 8000

# Kill any existing process on port 8000
try {
    $conn = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
    if ($conn) {
        Write-Host "Port $port in use by PID $($conn.OwningProcess). Killing..." -ForegroundColor Yellow
        Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 2
    }
} catch {}

# Launch server as a completely detached process (survives tool exit)
$psi = New-Object System.Diagnostics.ProcessStartInfo
if (Test-Path "$PSScriptRoot\.venv\Scripts\python.exe") {
    $psi.FileName = "$PSScriptRoot\.venv\Scripts\python.exe"
} else {
    $psi.FileName = "python"
}
$psi.Arguments = "run.py"
$psi.WorkingDirectory = $PSScriptRoot
$psi.UseShellExecute = $true
$psi.CreateNoWindow = $false
$psi.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Minimized
$proc = [System.Diagnostics.Process]::Start($psi)

Write-Host "====================================================" -ForegroundColor Cyan
Write-Host "  ScriptureCast Server Started" -ForegroundColor Cyan
Write-Host "====================================================" -ForegroundColor Cyan
Write-Host "  PID:       $($proc.Id)" -ForegroundColor Green
Write-Host "  Dashboard  -> http://localhost:$port" -ForegroundColor Green
Write-Host "  Screen     -> http://localhost:$port/screen" -ForegroundColor Green
Write-Host "  API Docs   -> http://localhost:$port/docs" -ForegroundColor Green
Write-Host "====================================================" -ForegroundColor Cyan
Write-Host "  Run '.\stop_bg.ps1' to stop the server" -ForegroundColor Yellow

if (-not $NoBrowser) {
    Start-Process "http://localhost:$port"
}
