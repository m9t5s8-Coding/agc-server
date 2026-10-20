BUILD_DIR := build
EXE_NAME := agc-server

all: build_install

configure:
	@cmake -S . -B $(BUILD_DIR)

build: configure
	@cmake --build $(BUILD_DIR)

install:
	@sudo cmake --install $(BUILD_DIR)

build_install: build install

.PHONY: all configure build install build_install
