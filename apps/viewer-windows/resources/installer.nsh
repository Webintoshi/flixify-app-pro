!macro preInit
  nsExec::ExecToLog '"$SYSDIR\cmd.exe" /C taskkill /F /IM "${APP_EXECUTABLE_FILENAME}" /T 2>nul'
  nsExec::ExecToLog '"$SYSDIR\cmd.exe" /C taskkill /F /IM "Flixify Pro.exe" /T 2>nul'
  nsExec::ExecToLog '"$SYSDIR\cmd.exe" /C taskkill /F /IM "Flixify-Pro*.exe" /T 2>nul'
!macroend

!macro customCheckAppRunning
  nsExec::ExecToLog '"$SYSDIR\cmd.exe" /C taskkill /F /IM "${APP_EXECUTABLE_FILENAME}" /T 2>nul'
  nsExec::ExecToLog '"$SYSDIR\cmd.exe" /C taskkill /F /IM "Flixify Pro.exe" /T 2>nul'
  nsExec::ExecToLog '"$SYSDIR\cmd.exe" /C taskkill /F /IM "Flixify-Pro*.exe" /T 2>nul'
  nsExec::ExecToLog `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -Command "Get-CimInstance -ClassName Win32_Process | ? {$$_.Path -and $$_.Path.StartsWith('$INSTDIR', 'CurrentCultureIgnoreCase')} | % { Stop-Process -Id $$_.ProcessId -Force -ErrorAction SilentlyContinue }"`
  Sleep 1200
!macroend

!macro customInit
  nsExec::ExecToLog 'taskkill /F /IM "Flixify Pro*.exe" /T'
!macroend

!macro customInstall
  nsExec::ExecToLog 'taskkill /F /IM "Flixify Pro*.exe" /T'
!macroend

!macro customUnInstall
  nsExec::ExecToLog 'taskkill /F /IM "Flixify Pro*.exe" /T'
!macroend
