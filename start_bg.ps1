param(
    [switch]$NoBrowser
)

$port = 8000
$logDir = Split-Path -Parent $PSCommandPath
$outLog = Join-Path $logDir "server_out.log"
$errLog = Join-Path $logDir "server_err.log"

# Kill any existing process on port 8000
try {
    $conn = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
    if ($conn) {
        Write-Host "Port $port in use by PID $($conn.OwningProcess). Killing..." -ForegroundColor Yellow
        Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 2
    }
} catch {}

# Launch server as a detached process (survives terminal exit)
$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = "python"
$psi.Arguments = "run.py"
$psi.WorkingDirectory = $logDir
$psi.UseShellExecute = $false
$psi.CreateNoWindow = $true
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true

$proc = [System.Diagnostics.Process]::Start($psi)

# Write PID file for stop_bg.ps1
$proc.Id | Out-File -FilePath (Join-Path $logDir "server.pid") -Encoding ascii

# Read output and error asynchronously
$readerOut = $proc.StandardOutput
$readerErr = $proc.StandardError

# Wait a bit and check if the process is still alive (startup check)
Start-Sleep -Seconds 4

if ($proc.HasExited) {
    $exitCode = $proc.ExitCode
    $errText = $readerErr.ReadToEnd()
    $outText = $readerOut.ReadToEnd()
    Write-Host "====================================================" -ForegroundColor Red
    Write-Host "  Server FAILED to start (exit code $exitCode)" -ForegroundColor Red
    Write-Host "====================================================" -ForegroundColor Red
    if ($errText) { Write-Host "  STDERR: $errText" -ForegroundColor Red }
    if ($outText) { Write-Host "  STDOUT: $outText" -ForegroundColor Red }
    Write-Host "  Check server_err.log and server_out.log for details" -ForegroundColor Yellow
    exit 1
}

# Process is alive — redirect output to log files in background jobs
Start-Job -ScriptBlock {
    param($reader, $path)
    try {
        $sw = [System.IO.StreamWriter]::new($path, $false)
        while (-not $reader.EndOfStream) {
            $line = $reader.ReadLine()
            if ($line) { $sw.WriteLine($line); $sw.Flush() }
        }
        $sw.Close()
    } catch {}
} -ArgumentList $readerOut, $outLog | Out-Null

Start-Job -ScriptBlock {
    param($reader, $path)
    try {
        $sw = [System.IO.StreamWriter]::new($path, $false)
        while (-not $reader.EndOfStream) {
            $line = $reader.ReadLine()
            if ($line) { $sw.WriteLine($line); $sw.Flush() }
        }
        $sw.Close()
    } catch {}
} -ArgumentList $readerErr, $errLog | Out-Null

Write-Host "====================================================" -ForegroundColor Cyan
Write-Host "  ScriptureCast Server Started" -ForegroundColor Cyan
Write-Host "====================================================" -ForegroundColor Cyan
Write-Host "  PID:       $($proc.Id)" -ForegroundColor Green
Write-Host "  Dashboard  -> http://localhost:$port" -ForegroundColor Green
Write-Host "  Screen     -> http://localhost:$port/screen" -ForegroundColor Green
Write-Host "  API Docs   -> http://localhost:$port/docs" -ForegroundColor Green
Write-Host "  Logs:      $outLog / $errLog" -ForegroundColor Green
Write-Host "====================================================" -ForegroundColor Cyan
Write-Host "  Run '.\stop_bg.ps1' to stop the server" -ForegroundColor Yellow

if (-not $NoBrowser) {
    Start-Process "http://localhost:$port"
}
