find_path(LIBVLC_INCLUDE_DIR
  NAMES vlc/vlc.h
  HINTS
    ${LIBVLC_ROOT}
    ENV LIBVLC_ROOT
  PATH_SUFFIXES include
)

find_library(LIBVLC_LIBRARY
  NAMES vlc libvlc
  HINTS
    ${LIBVLC_ROOT}
    ENV LIBVLC_ROOT
  PATH_SUFFIXES lib lib64 sdk/lib
)

find_path(LIBVLC_PLUGIN_DIR
  NAMES plugins.dat
  HINTS
    ${LIBVLC_ROOT}
    ENV LIBVLC_ROOT
  PATH_SUFFIXES plugins lib/vlc/plugins
)

include(FindPackageHandleStandardArgs)
find_package_handle_standard_args(LibVLC
  REQUIRED_VARS LIBVLC_INCLUDE_DIR LIBVLC_LIBRARY
)

if(LibVLC_FOUND AND NOT TARGET LibVLC::LibVLC)
  add_library(LibVLC::LibVLC UNKNOWN IMPORTED)
  set_target_properties(LibVLC::LibVLC PROPERTIES
    IMPORTED_LOCATION "${LIBVLC_LIBRARY}"
    INTERFACE_INCLUDE_DIRECTORIES "${LIBVLC_INCLUDE_DIR}"
  )
endif()
