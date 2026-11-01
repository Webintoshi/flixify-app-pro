param(
  [Parameter(Mandatory=$true)][string]$Installer,
  [Parameter(Mandatory=$true)][string]$Stage,
  [Parameter(Mandatory=$true)][string]$Proof
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$installRoot = 'C:\flixify\install-test'
if (Test-Path $installRoot) { throw 'Install test directory must not already exist' }
$signature = Get-AuthenticodeSignature -FilePath $Installer
if ($signature.Status -ne 'NotSigned') { throw "Unexpected installer signing status: $($signature.Status)" }
$process = Start-Process -FilePath $Installer -ArgumentList @('/S', "/D=$installRoot") -PassThru -Wait
if ($process.ExitCode -ne 0) { throw "Installer failed: $($process.ExitCode)" }
$installedExe = Join-Path $installRoot 'Flixify Pro.exe'
if (!(Test-Path $installedExe)) { throw 'Installer did not install the application' }
$expected = (Get-FileHash (Join-Path $Stage 'Flixify Pro.exe') -Algorithm SHA256).Hash
$actual = (Get-FileHash $installedExe -Algorithm SHA256).Hash
if ($expected -ne $actual) { throw 'Installed executable differs from staged executable' }
$app = Start-Process -FilePath $installedExe -PassThru
try {
  Start-Sleep -Seconds 4
  $app.Refresh()
  if ($app.HasExited) { throw "Installed application exited prematurely: $($app.ExitCode)" }
  if ($app.MainWindowHandle -eq 0) { throw 'Installed application did not create a rendered window' }
  $closed = $app.CloseMainWindow()
  if (!$closed) { throw 'Installed application did not accept normal window close' }
  if (!$app.WaitForExit(10000)) { throw 'Installed application failed to stop after close' }
} finally {
  $app.Refresh()
  if (!$app.HasExited) { $app.Kill(); $app.WaitForExit() }
}
$sentinelDirectory = Join-Path $installRoot 'user-created'
New-Item -ItemType Directory -Path $sentinelDirectory -ErrorAction Stop | Out-Null
$sentinel = Join-Path $sentinelDirectory 'keep.txt'
Set-Content -LiteralPath $sentinel -Value 'user data preserved' -Encoding utf8
$upgrade = Start-Process -FilePath $Installer -ArgumentList @('/S', "/D=$installRoot") -PassThru -Wait
if ($upgrade.ExitCode -ne 0) { throw "Upgrade install failed: $($upgrade.ExitCode)" }
if (!(Test-Path -LiteralPath $sentinel)) { throw 'Upgrade removed a user-created file' }
$uninstall = Start-Process -FilePath (Join-Path $installRoot 'Uninstall.exe') -ArgumentList '/S' -PassThru -Wait
if ($uninstall.ExitCode -ne 0) { throw "Uninstaller failed: $($uninstall.ExitCode)" }
$deadline = [DateTime]::UtcNow.AddSeconds(15)
while (((Test-Path $installedExe) -or (Test-Path (Join-Path $installRoot 'Uninstall.exe'))) -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 250 }
if (Test-Path $installedExe) { throw 'Uninstaller left the application installed' }
if (!(Test-Path -LiteralPath $sentinel) -or ((Get-Content -LiteralPath $sentinel -Raw).Trim() -ne 'user data preserved')) { throw 'Uninstall removed or changed a user-created file' }
Remove-Item -LiteralPath $sentinel
Remove-Item -LiteralPath $sentinelDirectory
if (Test-Path -LiteralPath $installRoot) { [System.IO.Directory]::Delete($installRoot, $false) }
@{
  userDataPreservedAcrossUpgradeAndUninstall = $true
  passed = $true
  installerSignature = 'NotSigned'
  installScope = 'current user'
  installedExeMatchesStage = $true
  installedWindowStarted = $true
  uninstallerRemovedApp = $true
} | ConvertTo-Json | Set-Content -Encoding utf8 (Join-Path $Proof 'install-report.json')
