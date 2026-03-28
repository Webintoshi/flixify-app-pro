$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$logDir = Join-Path $root "logs"
$outLog = Join-Path $logDir "telegram-panel-bot.out.log"
$errLog = Join-Path $logDir "telegram-panel-bot.err.log"
$heartbeatFile = Join-Path $root "data\telegram-panel-bot-heartbeat.json"
$staleSeconds = 90

function Get-BotProcesses {
  Get-CimInstance Win32_Process -Filter "name = 'node.exe'" |
    Where-Object { $_.CommandLine -match "telegram-panel-bot\.mjs" }
}

function Get-HeartbeatAgeSeconds {
  if (!(Test-Path $heartbeatFile)) {
    return $null
  }

  try {
    $raw = Get-Content $heartbeatFile -Raw | ConvertFrom-Json
    if (-not $raw.lastHeartbeatAt) {
      return $null
    }
    $last = [DateTimeOffset]::Parse($raw.lastHeartbeatAt)
    return [int][Math]::Floor(([DateTimeOffset]::UtcNow - $last).TotalSeconds)
  } catch {
    return $null
  }
}

function Start-BotProcess {
  New-Item -ItemType Directory -Force -Path $logDir | Out-Null
  Start-Process `
    -FilePath "node" `
    -ArgumentList "scripts/telegram-panel-bot.mjs" `
    -WorkingDirectory $root `
    -WindowStyle Hidden `
    -RedirectStandardOutput $outLog `
    -RedirectStandardError $errLog | Out-Null
}

$processes = @(Get-BotProcesses)
$heartbeatAge = Get-HeartbeatAgeSeconds
$shouldRestart = $false

if ($processes.Count -eq 0) {
  $shouldRestart = $true
} elseif ($heartbeatAge -ne $null -and $heartbeatAge -gt $staleSeconds) {
  $shouldRestart = $true
}

if ($shouldRestart) {
  $processes | ForEach-Object {
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
  }
  Start-Sleep -Milliseconds 750
  Start-BotProcess
  Start-Sleep -Seconds 3
}

$running = @(Get-BotProcesses)
if ($running.Count -gt 0) {
  Write-Output "telegram-panel-bot OK"
  $running | Select-Object ProcessId, CommandLine
} else {
  Write-Error "telegram-panel-bot is not running"
  exit 1
}
