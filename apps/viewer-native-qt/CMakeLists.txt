cmake_minimum_required(VERSION 3.28)

project(FlixifyNativeQt VERSION 2.2.38 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_AUTOMOC ON)
set(CMAKE_AUTORCC ON)
set(CMAKE_AUTOUIC ON)

option(FLIXIFY_ENABLE_INSTALL "Enable install targets for packaging" ON)
set(FLIXIFY_API_BASE_URL "$ENV{FLIXIFY_API_BASE_URL}" CACHE STRING "Flixify API base URL")
set(LIBVLC_ROOT "$ENV{LIBVLC_ROOT}" CACHE PATH "Path to the libVLC runtime root")
set(FLIXIFY_WINDOWS_ICON "${CMAKE_CURRENT_SOURCE_DIR}/../viewer-windows/resources/icon.ico")
if(FLIXIFY_API_BASE_URL STREQUAL "")
  set(FLIXIFY_API_BASE_URL "https://api.flixify.pro")
endif()
if(LIBVLC_ROOT STREQUAL "" AND WIN32)
  if(EXISTS "C:/Program Files/VideoLAN/VLC/libvlc.dll")
    set(LIBVLC_ROOT "C:/Program Files/VideoLAN/VLC" CACHE PATH "Path to the libVLC runtime root" FORCE)
  elseif(EXISTS "C:/Program Files (x86)/VideoLAN/VLC/libvlc.dll")
    set(LIBVLC_ROOT "C:/Program Files (x86)/VideoLAN/VLC" CACHE PATH "Path to the libVLC runtime root" FORCE)
  endif()
endif()
if(LIBVLC_ROOT STREQUAL "")
  message(FATAL_ERROR "LIBVLC_ROOT tanimli degil. libVLC runtime dizini gerekli.")
endif()

list(APPEND CMAKE_MODULE_PATH "${CMAKE_CURRENT_SOURCE_DIR}/cmake")

find_package(Qt6 6.5 REQUIRED COMPONENTS Core Gui Quick Qml QuickControls2 Network)

qt_standard_project_setup(REQUIRES 6.5)

if(WIN32)
  file(TO_NATIVE_PATH "${FLIXIFY_WINDOWS_ICON}" FLIXIFY_WINDOWS_ICON_NATIVE)
  string(REPLACE "\\" "\\\\" FLIXIFY_WINDOWS_ICON_RC "${FLIXIFY_WINDOWS_ICON_NATIVE}")
  configure_file(
    "${CMAKE_CURRENT_SOURCE_DIR}/src/windows_app.rc.in"
    "${CMAKE_CURRENT_BINARY_DIR}/windows_app.rc"
    @ONLY
  )
endif()

qt_add_executable(FlixifyNativeQt
  src/main.cpp
  src/api_client.cpp
  src/libvlc_runtime.cpp
  src/playback_controller.cpp
  src/native_video_surface.cpp
  src/resources.qrc
  $<$<PLATFORM_ID:Windows>:${CMAKE_CURRENT_BINARY_DIR}/windows_app.rc>
)

target_include_directories(FlixifyNativeQt PRIVATE src)

target_link_libraries(FlixifyNativeQt
  PRIVATE
    Qt6::Core
    Qt6::Gui
    Qt6::Quick
    Qt6::Qml
    Qt6::QuickControls2
    Qt6::Network
)

if(WIN32)
  target_link_libraries(FlixifyNativeQt PRIVATE dwmapi)
endif()

target_compile_definitions(FlixifyNativeQt PRIVATE
  FLIXIFY_API_BASE_URL="${FLIXIFY_API_BASE_URL}"
  FLIXIFY_APP_VERSION="${PROJECT_VERSION}"
)

set_target_properties(FlixifyNativeQt PROPERTIES
  WIN32_EXECUTABLE TRUE
  MACOSX_BUNDLE TRUE
  MACOSX_BUNDLE_GUI_IDENTIFIER "pro.flixify.nativeqt"
  MACOSX_BUNDLE_BUNDLE_NAME "Flixify Pro"
  MACOSX_BUNDLE_SHORT_VERSION_STRING "${PROJECT_VERSION}"
  MACOSX_BUNDLE_BUNDLE_VERSION "${PROJECT_VERSION}"
  OUTPUT_NAME "Flixify Pro"
)

if(FLIXIFY_ENABLE_INSTALL)
  include(GNUInstallDirs)
  if(WIN32)
    set(CMAKE_INSTALL_BINDIR "." CACHE STRING "Install binary directory" FORCE)
  endif()
  set(FLIXIFY_INSTALL_RUNTIME_DESTINATION "${CMAKE_INSTALL_BINDIR}")
  if(WIN32)
    set(FLIXIFY_INSTALL_PLUGIN_DESTINATION "plugins")
    set(FLIXIFY_INSTALL_LUA_DESTINATION "lua")
  else()
    set(FLIXIFY_INSTALL_PLUGIN_DESTINATION "${CMAKE_INSTALL_BINDIR}/plugins")
    set(FLIXIFY_INSTALL_LUA_DESTINATION "${CMAKE_INSTALL_BINDIR}/lua")
  endif()
  install(TARGETS FlixifyNativeQt
    BUNDLE DESTINATION .
    RUNTIME DESTINATION ${FLIXIFY_INSTALL_RUNTIME_DESTINATION}
  )
  qt_generate_deploy_qml_app_script(
    TARGET FlixifyNativeQt
    OUTPUT_SCRIPT deploy_qt_runtime
    NO_COMPILER_RUNTIME
    NO_TRANSLATIONS
    NO_UNSUPPORTED_PLATFORM_ERROR
  )
  install(SCRIPT ${deploy_qt_runtime})
  if(WIN32)
    install(CODE [[
      file(GLOB flixify_runtime_files
        "${CMAKE_INSTALL_PREFIX}/bin/*.dll"
        "${CMAKE_INSTALL_PREFIX}/bin/qt.conf"
      )
      foreach(runtime_file IN LISTS flixify_runtime_files)
        file(COPY "${runtime_file}" DESTINATION "${CMAKE_INSTALL_PREFIX}")
      endforeach()
    ]])
  endif()
  if(EXISTS "${LIBVLC_ROOT}/libvlc.dll")
    install(FILES "${LIBVLC_ROOT}/libvlc.dll" DESTINATION ${FLIXIFY_INSTALL_RUNTIME_DESTINATION})
  endif()
  if(EXISTS "${LIBVLC_ROOT}/libvlccore.dll")
    install(FILES "${LIBVLC_ROOT}/libvlccore.dll" DESTINATION ${FLIXIFY_INSTALL_RUNTIME_DESTINATION})
  endif()
  if(EXISTS "${LIBVLC_ROOT}/plugins")
    install(DIRECTORY "${LIBVLC_ROOT}/plugins/" DESTINATION "${FLIXIFY_INSTALL_PLUGIN_DESTINATION}")
  endif()
  if(EXISTS "${LIBVLC_ROOT}/lua")
    install(DIRECTORY "${LIBVLC_ROOT}/lua/" DESTINATION "${FLIXIFY_INSTALL_LUA_DESTINATION}")
  endif()
endif()

set(CPACK_PACKAGE_NAME "Flixify Pro")
set(CPACK_PACKAGE_VENDOR "Flixify")
set(CPACK_PACKAGE_INSTALL_DIRECTORY "Flixify Pro")
set(CPACK_PACKAGE_VERSION "${PROJECT_VERSION}")
if(WIN32)
  set(CPACK_GENERATOR "NSIS")
  set(CPACK_PACKAGE_FILE_NAME "Flixify-Pro-Setup-${PROJECT_VERSION}-x64")
  set(CPACK_NSIS_DISPLAY_NAME "Flixify Pro")
  set(CPACK_NSIS_PACKAGE_NAME "Flixify Pro")
  set(CPACK_NSIS_MUI_ICON "${FLIXIFY_WINDOWS_ICON}")
  set(CPACK_NSIS_MUI_UNIICON "${FLIXIFY_WINDOWS_ICON}")
  set(CPACK_NSIS_INSTALLED_ICON_NAME "Flixify Pro.exe")
  set(CPACK_NSIS_EXECUTABLES_DIRECTORY ".")
  set(CPACK_NSIS_MUI_FINISHPAGE_RUN "Flixify Pro.exe")
  set(CPACK_PACKAGE_EXECUTABLES "Flixify Pro" "Flixify Pro")
  set(
    CPACK_NSIS_EXTRA_INSTALL_COMMANDS
    "CreateShortCut \\\"$DESKTOP\\\\Flixify Pro.lnk\\\" \\\"$INSTDIR\\\\Flixify Pro.exe\\\" \\\"\\\" \\\"$INSTDIR\\\\Flixify Pro.exe\\\" 0"
  )
  set(
    CPACK_NSIS_EXTRA_UNINSTALL_COMMANDS
    "Delete \\\"$DESKTOP\\\\Flixify Pro.lnk\\\""
  )
endif()

include(CPack)
