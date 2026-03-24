$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$logDir = Join-Path $root "logs"
$outLog = Join-Path $logDir "telegram-panel-bot.out.log"
$errLog = Join-Path $logDir "telegram-panel-bot.err.log"

Get-CimInstance Win32_Process |
  Where-Object { $_.CommandLine -match "telegram-panel-bot\.mjs" } |
  ForEach-Object {
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
  }

New-Item -ItemType Directory -Force -Path $logDir | Out-Null

if (Test-Path $outLog) {
  Remove-Item $outLog -Force
}

if (Test-Path $errLog) {
  Remove-Item $errLog -Force
}

$process = Start-Process `
  -FilePath "node" `
  -ArgumentList "scripts/telegram-panel-bot.mjs" `
  -WorkingDirectory $root `
  -WindowStyle Hidden `
  -RedirectStandardOutput $outLog `
  -RedirectStandardError $errLog `
  -PassThru

Start-Sleep -Seconds 3
$process.Refresh()

"Started PID: $($process.Id)"

if (Test-Path $outLog) {
  Get-Content $outLog
}

if (Test-Path $errLog) {
  Get-Content $errLog
}
