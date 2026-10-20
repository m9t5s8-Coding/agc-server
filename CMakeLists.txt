cmake_minimum_required(VERSION 3.20)

project(agc-server)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

file(GLOB_RECURSE  APP_SRC "${CMAKE_SOURCE_DIR}/src/*cpp")
add_executable(agc-server ${APP_SRC})

target_include_directories(
agc-server PRIVATE
${CMAKE_CURRENT_SOURCE_DIR}/include
${CMAKE_CURRENT_SOURCE_DIR}/external
)

install(TARGETS agc-server DESTINATION /usr/local/bin)
