$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$ensureScript = Join-Path $root "scripts\ensure-telegram-panel-bot.cmd"
$startupDir = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Startup"
$startupCmd = Join-Path $startupDir "Flixify Telegram Panel Bot Startup.cmd"

$minuteTask = "Flixify Telegram Panel Bot Watchdog"
$logonTask = "Flixify Telegram Panel Bot Startup"

schtasks /Create /SC MINUTE /MO 1 /TN $minuteTask /TR "`"$ensureScript`"" /F | Out-Null

schtasks /Create /SC ONLOGON /TN $logonTask /TR "`"$ensureScript`"" /F | Out-Null
if ($LASTEXITCODE -ne 0) {
  New-Item -ItemType Directory -Force -Path $startupDir | Out-Null
  Set-Content -Path $startupCmd -Value "@echo off`r`ncall `"$ensureScript`"`r`n" -Encoding ASCII
}

Write-Output "Installed:"
Write-Output " - $minuteTask"
Write-Output " - $logonTask"
