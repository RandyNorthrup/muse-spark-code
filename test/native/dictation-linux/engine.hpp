#pragma once
#include <stdexcept>
#include <string>
#include <vector>
class Engine {
public:
  explicit Engine(const std::string &model) {
    if (model == "fail") throw std::runtime_error("model-load");
  }
  std::string recognize(const std::vector<float> &audio) {
    if (audio.empty()) throw std::runtime_error("recognition");
    return "Recognized fixture";
  }
};
