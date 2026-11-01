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
$app = Start-Process -FilePath $installedExe -PassThru
$windowProof = @{
  passed = $false
  processId = $app.Id
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
  $windowProof | ConvertTo-Json -Depth 8 | Set-Content -Encoding utf8 (Join-Path $Proof 'installed-window-report.json')
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
