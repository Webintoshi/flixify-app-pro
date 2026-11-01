Unicode true
!include "MUI2.nsh"
!ifndef STAGE_DIR
 !error "STAGE_DIR is required"
!endif
!ifndef OUTPUT_FILE
 !error "OUTPUT_FILE is required"
!endif
!ifndef APP_VERSION
 !error "APP_VERSION is required"
!endif
!ifndef UNINSTALL_MANIFEST
 !error "UNINSTALL_MANIFEST is required"
!endif
Name "Flixify Pro TEST ${APP_VERSION}"
OutFile "${OUTPUT_FILE}"
InstallDir "$LOCALAPPDATA\Programs\Flixify Pro"
RequestExecutionLevel user
SetCompressor /SOLID lzma
SetOverwrite on
VIProductVersion "${APP_VERSION}.0"
VIAddVersionKey /LANG=1033 "ProductName" "Flixify Pro TEST"
VIAddVersionKey /LANG=1033 "CompanyName" "Flixify"
VIAddVersionKey /LANG=1033 "FileDescription" "Unsigned Flixify Pro TEST installer"
VIAddVersionKey /LANG=1033 "FileVersion" "${APP_VERSION}"
!define MUI_ICON "..\resources\app.ico"
!define MUI_UNICON "..\resources\app.ico"
!define MUI_ABORTWARNING
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "..\licenses\TEST-DISTRIBUTION.txt"
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "Turkish"
!insertmacro MUI_LANGUAGE "English"

Section "Flixify Pro" SEC_MAIN
 SetShellVarContext current
 SetOutPath "$INSTDIR"
 ClearErrors
 File /r "${STAGE_DIR}\*"
 IfErrors payload_error payload_ok
 payload_error:
 SetErrorLevel 1
 Abort "Application files could not be installed. Close Flixify Pro and try again."
 payload_ok:
 ClearErrors
 WriteUninstaller "$INSTDIR\Uninstall.exe"
 IfErrors uninstaller_error uninstaller_ok
 uninstaller_error:
 SetErrorLevel 1
 Abort "The uninstaller could not be written."
 uninstaller_ok:
 CreateDirectory "$SMPROGRAMS\Flixify Pro"
 CreateShortCut "$SMPROGRAMS\Flixify Pro\Flixify Pro.lnk" "$INSTDIR\Flixify Pro.exe"
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\FlixifyPro" "DisplayName" "Flixify Pro TEST"
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\FlixifyPro" "DisplayVersion" "${APP_VERSION}"
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\FlixifyPro" "Publisher" "Flixify"
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\FlixifyPro" "UninstallString" '$\"$INSTDIR\Uninstall.exe$\"'
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\FlixifyPro" "InstallLocation" "$INSTDIR"
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\FlixifyPro" "DisplayIcon" "$INSTDIR\Flixify Pro.exe"
 WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\FlixifyPro" "NoModify" 1
 WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\FlixifyPro" "NoRepair" 1
SectionEnd

Section "Uninstall"
 SetShellVarContext current
 Delete "$SMPROGRAMS\Flixify Pro\Flixify Pro.lnk"
 RMDir "$SMPROGRAMS\Flixify Pro"
 DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\FlixifyPro"
 !include "${UNINSTALL_MANIFEST}"
SectionEnd
