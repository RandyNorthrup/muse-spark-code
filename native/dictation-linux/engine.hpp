// Copyright (c) 2026 Randy Northrup
// SPDX-License-Identifier: MIT
#pragma once
#include "whisper.h"
#include "ggml-backend.h"
#include <muse_config.hpp>
#include <filesystem>
#include <unistd.h>
#include <cstdlib>
#include <stdexcept>
#include <string>
#include <vector>

class Engine {
  whisper_context *context;
public:
  explicit Engine(const std::string &model) {
    const auto file = std::filesystem::absolute(model);
    // ggml also discovers plugins in cwd and GGML_BACKEND_PATH. Neither may name a workspace.
    const auto directory = std::filesystem::read_symlink("/proc/self/exe").parent_path();
    if (chdir(directory.c_str()) != 0 || unsetenv("GGML_BACKEND_PATH") != 0)
      throw std::runtime_error("engine-directory");
    ggml_backend_load_all();
    auto config = whisper_context_default_params();
    config.use_gpu = false;
    context = whisper_init_from_file_with_params(file.c_str(), config);
    if (!context) throw std::runtime_error("model-load");
  }
  ~Engine() { whisper_free(context); }
  std::string recognize(const std::vector<float> &audio) {
    auto config = whisper_full_default_params(WHISPER_SAMPLING_GREEDY);
    config.n_threads = muse_config::THREADS;
    config.language = "en";
    config.no_context = true;
    config.single_segment = true;
    config.print_realtime = false;
    config.print_progress = false;
    config.print_timestamps = false;
    config.print_special = false;
    if (whisper_full(context, config, audio.data(), static_cast<int>(audio.size())) != 0)
      throw std::runtime_error("recognition");
    std::string text;
    for (int i = 0; i < whisper_full_n_segments(context); ++i)
      text += whisper_full_get_segment_text(context, i);
    return text;
  }
};
