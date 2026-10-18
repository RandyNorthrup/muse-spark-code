cmake_minimum_required(VERSION 3.16)
project(muse_dictate LANGUAGES C CXX)
set(CMAKE_CXX_STANDARD 17)
set(BUILD_SHARED_LIBS ON CACHE BOOL "" FORCE)
set(GGML_NATIVE OFF CACHE BOOL "" FORCE)
set(GGML_OPENMP OFF CACHE BOOL "" FORCE)
set(GGML_BACKEND_DL ON CACHE BOOL "" FORCE)
# Every CPU backend variant is built (x64/sse42/sandybridge/haswell/
# skylakex/icelake/alderlake/sapphirerapids on x86, the armv8/armv9 set on
# ARM) so the engine's ggml_backend_load_all selects the machine's best.
# scripts/build-linux-helper-pins.mjs EXPECTED must name them all: only
# pinned files are published as release assets and downloaded.
set(GGML_CPU_ALL_VARIANTS ON CACHE BOOL "" FORCE)
set(GGML_CPU_KLEIDIAI OFF CACHE BOOL "" FORCE)
set(GGML_LLAMAFILE OFF CACHE BOOL "" FORCE)
set(GGML_CUDA OFF CACHE BOOL "" FORCE)
set(GGML_VULKAN OFF CACHE BOOL "" FORCE)
set(GGML_METAL OFF CACHE BOOL "" FORCE)
set(CMAKE_RUNTIME_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR}/bin)
set(CMAKE_LIBRARY_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR}/bin)
set(CMAKE_BUILD_RPATH "$ORIGIN")
# Installation RPATH avoids CMake's trailing empty build search entry (cwd).
set(CMAKE_INSTALL_RPATH "$ORIGIN")
set(CMAKE_BUILD_WITH_INSTALL_RPATH TRUE)
set(CMAKE_BUILD_RPATH_USE_ORIGIN TRUE)
set(WHISPER_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(WHISPER_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
add_subdirectory(${WHISPER_SOURCE} whisper)
find_package(Threads REQUIRED)
add_executable(muse-dictate helper.cpp)
target_include_directories(muse-dictate PRIVATE ${CMAKE_CURRENT_SOURCE_DIR} ${MUSE_CONFIG_DIR})
target_compile_options(muse-dictate PRIVATE -Wall -Wextra -Werror)
target_link_libraries(muse-dictate PRIVATE whisper pulse-simple pulse Threads::Threads)
