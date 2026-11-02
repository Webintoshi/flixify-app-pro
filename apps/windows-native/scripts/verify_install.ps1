param(
  [Parameter(Mandatory=$true)][string]$Installer,
  [Parameter(Mandatory=$true)][string]$Stage,
  [Parameter(Mandatory=$true)][string]$Proof
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$installRoot = 'C:\flixify\install-test'
if (Test-Path $installRoot) { throw 'Install test directory must not already exist' }
$desktopDirectory = [Environment]::GetFolderPath('DesktopDirectory')
$programsDirectory = [Environment]::GetFolderPath('Programs')
if (!$desktopDirectory -or !$programsDirectory) { throw 'Current-user Windows shell folders could not be resolved' }
$desktopShortcut = Join-Path $desktopDirectory 'Flixify Pro.lnk'
$startMenuShortcut = Join-Path $programsDirectory 'Flixify Pro\Flixify Pro.lnk'
foreach ($shortcut in @($desktopShortcut, $startMenuShortcut)) {
  if (Test-Path -LiteralPath $shortcut) { throw 'Shortcut verification requires an unused test desktop and Start Menu entry' }
}
$shell = New-Object -ComObject WScript.Shell
$signature = Get-AuthenticodeSignature -FilePath $Installer
if ($signature.Status -ne 'NotSigned') { throw "Unexpected installer signing status: $($signature.Status)" }
$process = Start-Process -FilePath $Installer -ArgumentList @('/S', "/D=$installRoot") -PassThru -Wait
if ($process.ExitCode -ne 0) { throw "Installer failed: $($process.ExitCode)" }
$installedExe = Join-Path $installRoot 'Flixify Pro.exe'
if (!(Test-Path $installedExe)) { throw 'Installer did not install the application' }
$expected = (Get-FileHash (Join-Path $Stage 'Flixify Pro.exe') -Algorithm SHA256).Hash
$actual = (Get-FileHash $installedExe -Algorithm SHA256).Hash
if ($expected -ne $actual) { throw 'Installed executable differs from staged executable' }
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class FlixifyInstallWindows {
    public sealed class WindowInfo {
        public long Handle;
        public long Owner;
        public string ClassName;
        public string Title;
        public bool Visible;
        public bool ToolWindow;
    }
    private delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr parameter);
    [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr parameter);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] private static extern IntPtr GetWindow(IntPtr hwnd, uint command);
    [DllImport("user32.dll", EntryPoint="GetWindowLongPtrW")] private static extern IntPtr GetWindowLongPtr(IntPtr hwnd, int index);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] private static extern int GetClassName(IntPtr hwnd, StringBuilder text, int count);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] private static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int count);
    [DllImport("user32.dll", SetLastError=true)] public static extern bool PostMessage(IntPtr hwnd, uint message, IntPtr w, IntPtr l);
    public static WindowInfo[] Snapshot(int processId) {
        var result = new List<WindowInfo>();
        EnumWindows((hwnd, unused) => {
            uint ownerPid;
            GetWindowThreadProcessId(hwnd, out ownerPid);
            if (ownerPid != (uint)processId) return true;
            var title = new StringBuilder(512);
            var className = new StringBuilder(256);
            GetWindowText(hwnd, title, title.Capacity);
            GetClassName(hwnd, className, className.Capacity);
            result.Add(new WindowInfo {
                Handle = hwnd.ToInt64(), Owner = GetWindow(hwnd, 4).ToInt64(),
                ClassName = className.ToString(), Title = title.ToString(),
                Visible = IsWindowVisible(hwnd),
                ToolWindow = (GetWindowLongPtr(hwnd, -20).ToInt64() & 0x80) != 0
            });
            return true;
        }, IntPtr.Zero);
        return result.ToArray();
    }
}
'@
function Get-SafeWindowSnapshot([int]$ProcessId) {
  @([FlixifyInstallWindows]::Snapshot($ProcessId) | ForEach-Object {
    $titleHash = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($_.Title))).ToLowerInvariant()
    $safeClass = if ($_.ClassName -match '^(Qt[A-Za-z0-9_]+|FlixifyProRoot|FlixifyProVideoSurface)$') { $_.ClassName } else { '[unexpected class redacted]' }
    @{
      handle = ('0x{0:x}' -f $_.Handle)
      ownerHandle = ('0x{0:x}' -f $_.Owner)
      class = $safeClass
      classSha256 = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($_.ClassName))).ToLowerInvariant()
      title = if ($_.Title -eq 'Flixify Pro') { 'Flixify Pro' } elseif ($_.Title.Length -eq 0) { '' } else { '[unexpected title redacted]' }
      titleSha256 = $titleHash
      titleLength = $_.Title.Length
      visible = $_.Visible
      toolWindow = $_.ToolWindow
    }
  })
}
function Assert-AppShortcut([string]$Path) {
  if (!(Test-Path -LiteralPath $Path -PathType Leaf)) { throw 'Installer did not create an application shortcut in the current-user shell folder' }
  $link = $shell.CreateShortcut($Path)
  try {
    if ($link.TargetPath -ne $installedExe) { throw 'Application shortcut does not target the installed executable' }
    if ($link.Arguments -ne '') { throw 'Application shortcut has unexpected launch arguments' }
    if ($link.WorkingDirectory -ne $installRoot) { throw 'Application shortcut has the wrong working directory' }
    if ($link.IconLocation -notmatch '^(.*),\s*(-?\d+)$' -or
        $Matches[1].Trim('"') -ne $installedExe -or $Matches[2] -ne '0') {
      throw 'Application shortcut does not use the installed application icon'
    }
    if ($link.WindowStyle -ne 1) { throw 'Application shortcut does not open a normal window' }
  } finally {
    [Runtime.InteropServices.Marshal]::FinalReleaseComObject($link) | Out-Null
  }
}
function Invoke-DesktopLaunchAndClose([string]$ReportName) {
$app = Start-Process -FilePath $desktopShortcut -PassThru
if (!$app) { throw 'Desktop shortcut did not launch an application process' }
$windowProof = @{
  passed = $false
  processId = $app.Id
  launchMethod = 'desktop shortcut'
  closeMethod = 'WM_CLOSE to exact visible unowned Flixify Pro root window'
  closeTimeoutMs = 10000
  cleanupTerminatedProcess = $false
}
try {
  Start-Sleep -Seconds 4
  $app.Refresh()
  $windowProof.beforeClose = @(Get-SafeWindowSnapshot $app.Id)
  if ($app.HasExited) { throw "Installed application exited prematurely: $($app.ExitCode)" }
  $windowProof.dotNetMainWindowHandle = ('0x{0:x}' -f $app.MainWindowHandle.ToInt64())
  $roots = @([FlixifyInstallWindows]::Snapshot($app.Id) | Where-Object {
    $_.Visible -and $_.Owner -eq 0 -and !$_.ToolWindow -and $_.Title -eq 'Flixify Pro' -and
    ($_.ClassName -match '^Qt[A-Za-z0-9_]*QWindow[A-Za-z0-9_]*$' -or $_.ClassName -eq 'FlixifyProRoot')
  })
  if ($roots.Count -ne 1) { throw 'Installed application did not expose exactly one visible Flixify Pro root window' }
  $rootHandle = [IntPtr]::new($roots[0].Handle)
  $windowProof.selectedRootHandle = ('0x{0:x}' -f $roots[0].Handle)
  $windowProof.dotNetSelectedRoot = $app.MainWindowHandle.ToInt64() -eq $roots[0].Handle
  if (![FlixifyInstallWindows]::PostMessage($rootHandle, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)) {
    throw 'Installed application root window did not accept WM_CLOSE'
  }
  $windowProof.closePosted = $true
  $stopped = $app.WaitForExit(10000)
  $windowProof.afterClose = @(Get-SafeWindowSnapshot $app.Id)
  $windowProof.exitedWithinTimeout = $stopped
  if (!$stopped) { throw 'Installed application failed to stop after normal root-window close' }
  $windowProof.exitCode = $app.ExitCode
  if ($app.ExitCode -ne 0) { throw "Installed application exited abnormally after root-window close: $($app.ExitCode)" }
  $windowProof.passed = $true
} catch {
  $windowProof.failure = 'Installed application root-window shutdown verification failed'
  throw
} finally {
  $app.Refresh()
  if (!$app.HasExited) {
    $windowProof.beforeFailureCleanup = @(Get-SafeWindowSnapshot $app.Id)
    $windowProof.cleanupTerminatedProcess = $true
  }
  $windowProof | ConvertTo-Json -Depth 8 | Set-Content -Encoding utf8 (Join-Path $Proof $ReportName)
  if (!$app.HasExited) { $app.Kill(); $app.WaitForExit() }
}
}
function Invoke-TestInstaller {
  $installation = Start-Process -FilePath $Installer -ArgumentList @('/S', "/D=$installRoot") -PassThru -Wait
  if ($installation.ExitCode -ne 0) { throw "Installer failed: $($installation.ExitCode)" }
}
function Invoke-TestUninstaller {
  $uninstall = Start-Process -FilePath (Join-Path $installRoot 'Uninstall.exe') -ArgumentList '/S' -PassThru -Wait
  if ($uninstall.ExitCode -ne 0) { throw "Uninstaller failed: $($uninstall.ExitCode)" }
  $deadline = [DateTime]::UtcNow.AddSeconds(15)
  while (((Test-Path $installedExe) -or (Test-Path (Join-Path $installRoot 'Uninstall.exe'))) -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 250 }
  if ((Test-Path $installedExe) -or (Test-Path (Join-Path $installRoot 'Uninstall.exe'))) { throw 'Uninstaller left the application installed' }
}
Assert-AppShortcut $desktopShortcut
Assert-AppShortcut $startMenuShortcut
Invoke-DesktopLaunchAndClose 'installed-window-report.json'
$sentinelDirectory = Join-Path $installRoot 'user-created'
New-Item -ItemType Directory -Path $sentinelDirectory -ErrorAction Stop | Out-Null
$sentinel = Join-Path $sentinelDirectory 'keep.txt'
Set-Content -LiteralPath $sentinel -Value 'user data preserved' -Encoding utf8
Remove-Item -LiteralPath $desktopShortcut
Invoke-TestInstaller
Assert-AppShortcut $desktopShortcut
Assert-AppShortcut $startMenuShortcut
if (!(Test-Path -LiteralPath $sentinel)) { throw 'Upgrade removed a user-created file' }
$changedLink = $shell.CreateShortcut($desktopShortcut)
$changedLink.WorkingDirectory = $env:TEMP
$changedLink.Arguments = '--installer-shortcut-repair-test'
$changedLink.IconLocation = "$env:SystemRoot\System32\shell32.dll,0"
$changedLink.Save()
[Runtime.InteropServices.Marshal]::FinalReleaseComObject($changedLink) | Out-Null
Invoke-TestInstaller
Assert-AppShortcut $desktopShortcut
Assert-AppShortcut $startMenuShortcut
Invoke-DesktopLaunchAndClose 'installed-window-upgrade-report.json'
Invoke-TestUninstaller
if ((Test-Path -LiteralPath $desktopShortcut) -or (Test-Path -LiteralPath $startMenuShortcut)) {
  throw 'Uninstaller left an application-owned shortcut'
}
if (!(Test-Path -LiteralPath $sentinel) -or ((Get-Content -LiteralPath $sentinel -Raw).Trim() -ne 'user data preserved')) { throw 'Uninstall removed or changed a user-created file' }
Remove-Item -LiteralPath $sentinel
Remove-Item -LiteralPath $sentinelDirectory
if (Test-Path -LiteralPath $installRoot) { [System.IO.Directory]::Delete($installRoot, $false) }
$unrelatedLink = $shell.CreateShortcut($desktopShortcut)
$unrelatedLink.TargetPath = Join-Path $env:SystemRoot 'System32\notepad.exe'
$unrelatedLink.Description = 'User-created unrelated shortcut preservation fixture'
$unrelatedLink.Save()
[Runtime.InteropServices.Marshal]::FinalReleaseComObject($unrelatedLink) | Out-Null
$unrelatedHash = (Get-FileHash -LiteralPath $desktopShortcut -Algorithm SHA256).Hash
try {
  Invoke-TestInstaller
  if ((Get-FileHash -LiteralPath $desktopShortcut -Algorithm SHA256).Hash -ne $unrelatedHash) {
    throw 'Installer overwrote an unrelated preexisting desktop shortcut'
  }
  Assert-AppShortcut $startMenuShortcut
  Invoke-TestUninstaller
  if (!(Test-Path -LiteralPath $desktopShortcut) -or
      (Get-FileHash -LiteralPath $desktopShortcut -Algorithm SHA256).Hash -ne $unrelatedHash) {
    throw 'Uninstaller removed or changed an unrelated desktop shortcut'
  }
  if (Test-Path -LiteralPath $startMenuShortcut) { throw 'Uninstaller left an owned Start Menu shortcut' }
} finally {
  if ((Test-Path -LiteralPath $desktopShortcut) -and
      (Get-FileHash -LiteralPath $desktopShortcut -Algorithm SHA256).Hash -eq $unrelatedHash) {
    Remove-Item -LiteralPath $desktopShortcut
  }
  [Runtime.InteropServices.Marshal]::FinalReleaseComObject($shell) | Out-Null
}
@{
  userDataPreservedAcrossUpgradeAndUninstall = $true
  passed = $true
  installerSignature = 'NotSigned'
  installScope = 'current user'
  installedExeMatchesStage = $true
  installedWindowStarted = $true
  uninstallerRemovedApp = $true
  desktopFolderSource = 'Windows current-user DesktopDirectory known folder'
  desktopShortcutCreated = $true
  startMenuShortcutCreated = $true
  shortcutPropertiesVerified = $true
  desktopShortcutRestoredOnUpgrade = $true
  ownedShortcutRepairedOnUpgrade = $true
  ownedShortcutsRemovedOnUninstall = $true
  unrelatedDesktopShortcutPreserved = $true
} | ConvertTo-Json | Set-Content -Encoding utf8 (Join-Path $Proof 'install-report.json')
