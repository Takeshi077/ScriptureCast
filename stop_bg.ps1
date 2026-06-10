$port = 8000
$logDir = Split-Path -Parent $PSCommandPath
$pidFile = Join-Path $logDir "server.pid"

# Try PID file first
$stopped = $false
if (Test-Path $pidFile) {
    $pid = Get-Content $pidFile -Raw -ErrorAction SilentlyContinue
    if ($pid) {
        $pid = $pid.Trim()
        try {
            $proc = Get-Process -Id $pid -ErrorAction SilentlyContinue
            if ($proc -and $proc.ProcessName -eq 'python') {
                Write-Host "Stopping server (PID $pid)..." -ForegroundColor Yellow
                Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
                Start-Sleep -Seconds 1
                Write-Host "Server stopped." -ForegroundColor Green
                $stopped = $true
            }
        } catch {}
    }
    Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
}

# Fallback: kill by port
if (-not $stopped) {
    try {
        $conn = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
        if ($conn) {
            Write-Host "Stopping server (PID $($conn.OwningProcess))..." -ForegroundColor Yellow
            Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue
            Write-Host "Server stopped." -ForegroundColor Green
            $stopped = $true
        }
    } catch {}
}

if (-not $stopped) {
    Write-Host "No server running on port $port." -ForegroundColor Yellow
}
