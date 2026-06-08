$port = 8000

try {
    $conn = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
    if ($conn) {
        Write-Host "Stopping server (PID $($conn.OwningProcess))..." -ForegroundColor Yellow
        Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue
        Write-Host "Server stopped." -ForegroundColor Green
    } else {
        Write-Host "No server running on port $port." -ForegroundColor Yellow
    }
} catch {
    Write-Host "No server running on port $port." -ForegroundColor Yellow
}
