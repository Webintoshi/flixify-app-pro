cmake_minimum_required(VERSION 3.28)

project(FlixifyNativeQt VERSION 2.1.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_AUTOMOC ON)
set(CMAKE_AUTORCC ON)
set(CMAKE_AUTOUIC ON)

option(FLIXIFY_ENABLE_INSTALL "Enable install targets for packaging" ON)
set(FLIXIFY_API_BASE_URL "$ENV{FLIXIFY_API_BASE_URL}" CACHE STRING "Flixify API base URL")
if(FLIXIFY_API_BASE_URL STREQUAL "")
  set(FLIXIFY_API_BASE_URL "https://api.flixify.pro")
endif()

list(APPEND CMAKE_MODULE_PATH "${CMAKE_CURRENT_SOURCE_DIR}/cmake")

find_package(Qt6 6.5 REQUIRED COMPONENTS Core Gui Quick Qml QuickControls2 Network)
find_package(LibVLC REQUIRED)

qt_standard_project_setup(REQUIRES 6.5)

qt_add_executable(FlixifyNativeQt
  src/main.cpp
  src/api_client.cpp
  src/playback_controller.cpp
  src/native_video_surface.cpp
  src/resources.qrc
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
    LibVLC::LibVLC
)

target_compile_definitions(FlixifyNativeQt PRIVATE
  FLIXIFY_API_BASE_URL="${FLIXIFY_API_BASE_URL}"
  FLIXIFY_APP_VERSION="${PROJECT_VERSION}"
)

set_target_properties(FlixifyNativeQt PROPERTIES
  WIN32_EXECUTABLE TRUE
  MACOSX_BUNDLE TRUE
  MACOSX_BUNDLE_GUI_IDENTIFIER "pro.flixify.nativeqt"
  MACOSX_BUNDLE_BUNDLE_NAME "Flixify Native Qt"
  MACOSX_BUNDLE_SHORT_VERSION_STRING "${PROJECT_VERSION}"
  MACOSX_BUNDLE_BUNDLE_VERSION "${PROJECT_VERSION}"
  OUTPUT_NAME "Flixify Native Qt"
)

if(FLIXIFY_ENABLE_INSTALL)
  include(GNUInstallDirs)
  install(TARGETS FlixifyNativeQt
    BUNDLE DESTINATION .
    RUNTIME DESTINATION ${CMAKE_INSTALL_BINDIR}
  )
  if(EXISTS "${LIBVLC_PLUGIN_DIR}")
    install(DIRECTORY "${LIBVLC_PLUGIN_DIR}/" DESTINATION "${CMAKE_INSTALL_BINDIR}/plugins")
  endif()
endif()

include(CPack)
