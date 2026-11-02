Unicode true
!include "MUI2.nsh"
!include "LogicLib.nsh"
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

!macro ReadShortcutTargetFunction PREFIX
Function ${PREFIX}ReadShortcutTarget
 System::Store S
 Pop $9
 StrCpy $4 ""
 System::Call "ole32::CoInitialize(p 0) i.r5"
 System::Call "ole32::CoCreateInstance(g '{00021401-0000-0000-C000-000000000046}', p 0, i 1, g '{000214F9-0000-0000-C000-000000000046}', *p .r1) i.r0"
 ${If} $0 = 0
  System::Call "$1->0(g '{0000010b-0000-0000-C000-000000000046}', *p .r2) i.r0"
  ${If} $0 = 0
   System::Call "$2->5(w r9, i 0) i.r0"
   ${If} $0 = 0
    System::Call "$1->3(w .r4, i ${NSIS_MAX_STRLEN}, p 0, i 0) i.r0"
    ${If} $0 != 0
     StrCpy $4 ""
    ${EndIf}
   ${EndIf}
   System::Call "$2->2()"
  ${EndIf}
  System::Call "$1->2()"
 ${EndIf}
 ${If} $5 = 0
 ${OrIf} $5 = 1
  System::Call "ole32::CoUninitialize()"
 ${EndIf}
 Push $4
 System::Store L
FunctionEnd
!macroend
!insertmacro ReadShortcutTargetFunction ""
!insertmacro ReadShortcutTargetFunction "un."

!macro InstallAppShortcut PATH
 StrCpy $1 1
 ${If} ${FileExists} "${PATH}"
  Push "${PATH}"
  Call ReadShortcutTarget
  Pop $0
  ${If} $0 != "$INSTDIR\Flixify Pro.exe"
   StrCpy $1 0
   DetailPrint "Preserving an existing shortcut that does not target this installation."
  ${EndIf}
 ${EndIf}
 ${If} $1 = 1
  ClearErrors
  CreateShortCut "${PATH}" "$INSTDIR\Flixify Pro.exe" "" "$INSTDIR\Flixify Pro.exe" 0 SW_SHOWNORMAL "" "Flixify Pro"
  ${If} ${Errors}
   SetErrorLevel 1
   Abort "The application shortcut could not be created."
  ${EndIf}
 ${EndIf}
!macroend

!macro RemoveAppShortcut PATH
 Push "${PATH}"
 Call un.ReadShortcutTarget
 Pop $0
 ${If} $0 == "$INSTDIR\Flixify Pro.exe"
  Delete "${PATH}"
 ${EndIf}
!macroend

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
 CreateDirectory "$DESKTOP"
 !insertmacro InstallAppShortcut "$SMPROGRAMS\Flixify Pro\Flixify Pro.lnk"
 !insertmacro InstallAppShortcut "$DESKTOP\Flixify Pro.lnk"
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
 !insertmacro RemoveAppShortcut "$DESKTOP\Flixify Pro.lnk"
 !insertmacro RemoveAppShortcut "$SMPROGRAMS\Flixify Pro\Flixify Pro.lnk"
 RMDir "$SMPROGRAMS\Flixify Pro"
 DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\FlixifyPro"
 !include "${UNINSTALL_MANIFEST}"
SectionEnd
