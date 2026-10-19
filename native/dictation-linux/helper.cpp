// Copyright (c) 2026 Randy Northrup
// SPDX-License-Identifier: MIT
// Linux helper: PulseAudio's native client also connects to PipeWire's Pulse server.
// Only PCM held in bounded memory; no audio file is created by this helper.
#include <engine.hpp>
#include <muse_config.hpp>
#include <pulse/simple.h>
#include <atomic>
#include <condition_variable>
#include <cstdint>
#include <cstdlib>
#include <deque>
#include <fstream>
#include <unistd.h>
#include <iostream>
#include <memory>
#include <mutex>
#include <stdexcept>
#include <thread>
#include <vector>
#include <algorithm>
#include <cmath>
#include <cstring>
#include <filesystem>

using namespace muse_config;
constexpr size_t FRAME = RATE / FRAMES_PER_SECOND;
constexpr size_t PHRASE = RATE * PHRASE_SECONDS;
constexpr size_t QUEUE_LIMIT = RATE * QUEUE_SECONDS;
constexpr size_t WAV_LIMIT = RATE * WAV_SECONDS * 2;
std::mutex outputMutex;
std::atomic<bool> stopRequested{false};

std::string jsonQuote(const std::string &text) {
  std::string result = "\"";
  const char hex[] = "0123456789abcdef";
  for (unsigned char c : text) {
    if (c == '"' || c == '\\') { result += '\\'; result += static_cast<char>(c); }
    else if (c < 32) { result += "\\u00"; result += hex[c >> 4]; result += hex[c & 15]; }
    else result += static_cast<char>(c);
  }
  return result + "\"";
}
void line(const std::string &json) {
  std::lock_guard<std::mutex> lock(outputMutex);
  std::cout << json << std::endl;
}
void error(const std::string &code) { line("{\"type\":\"error\",\"reason\":" + jsonQuote(code) + "}"); }

unsigned u16(const unsigned char *p) { return p[0] | (unsigned(p[1]) << 8); }
unsigned u32(const unsigned char *p) { return u16(p) | (u16(p+2) << 16); }
std::vector<int16_t> wav(const std::string &file) {
  std::ifstream input(file, std::ios::binary);
  if (!input) throw std::runtime_error("input-wav");
  unsigned char header[12];
  if (!input.read(reinterpret_cast<char *>(header), sizeof header) ||
      std::memcmp(header, "RIFF", 4) || std::memcmp(header+8, "WAVE", 4))
    throw std::runtime_error("input-wav");
  bool format = false;
  for (;;) {
    unsigned char chunk[8];
    if (!input.read(reinterpret_cast<char *>(chunk), sizeof chunk)) break;
    unsigned size = u32(chunk+4);
    if (size > WAV_LIMIT) throw std::runtime_error("input-wav");
    if (!std::memcmp(chunk, "fmt ", 4)) {
      if (size < 16) throw std::runtime_error("input-wav");
      std::vector<unsigned char> bytes(size);
      if (!input.read(reinterpret_cast<char *>(bytes.data()), size)) throw std::runtime_error("input-wav");
      format = u16(bytes.data()) == 1 && u16(bytes.data()+2) == 1 &&
               u32(bytes.data()+4) == RATE && u16(bytes.data()+14) == 16;
    } else if (!std::memcmp(chunk, "data", 4)) {
      if (!format || size == 0 || size % 2) throw std::runtime_error("input-wav");
      std::vector<int16_t> samples(size / 2);
      if (!input.read(reinterpret_cast<char *>(samples.data()), size)) throw std::runtime_error("input-wav");
      return samples;
    } else input.seekg(size, std::ios::cur);
    if (size % 2) input.seekg(1, std::ios::cur);
  }
  throw std::runtime_error("input-wav");
}

// Offline capture must stay on this computer: PulseAudio's client (and
// PipeWire's Pulse layer with it) also honors PULSE_SERVER, so a network
// address inherited from the editor would move capture to TCP. A non-local
// choice is refused before any connection is opened; the explicit local
// socket below also overrides client.conf's default-server. Device selectors
// (PULSE_SINK/PULSE_SOURCE) and PipeWire daemon selectors (PIPEWIRE_REMOTE,
// PIPEWIRE_CORE) are cleared with it: a tunnelled device is a network path
// of the same class. Kept deliberately: PULSE_COOKIE (local authentication),
// XDG_RUNTIME_DIR (builds the socket path), HOME (local cookie and config;
// the explicit server wins over the config). Proxy variables are not read
// by the audio client. The launcher scrubs the same names first; this check
// also covers a direct launch.
const char *AUDIO_SERVER_VARIABLES[] = {
  "PULSE_SERVER", "PULSE_SINK", "PULSE_SOURCE", "PIPEWIRE_REMOTE", "PIPEWIRE_CORE",
};

bool isLocalAudioServer(const char *value) {
  if (value == nullptr || *value == '\0') return true;
  return std::strncmp(value, "unix:", 5) == 0;
}

std::string localAudioServer() {
  const char *runtime = std::getenv("XDG_RUNTIME_DIR");
  std::string directory;
  if (runtime != nullptr && *runtime != '\0') directory = runtime;
  else directory = "/run/user/" + std::to_string(geteuid());
  return "unix:" + directory + "/pulse/native";
}

void record(Engine &engine, const std::string &fixture) {
  std::mutex mutex;
  std::condition_variable changed;
  std::deque<std::vector<float>> queue;
  size_t queued = 0;
  bool done = false;
  bool failed = false;
  std::thread inference([&] {
    try {
      for (;;) {
        std::vector<float> audio;
        {
          std::unique_lock<std::mutex> lock(mutex);
          changed.wait(lock, [&] { return done || !queue.empty(); });
          if (queue.empty()) break;
          audio = std::move(queue.front()); queue.pop_front(); queued -= audio.size();
        }
        auto text = engine.recognize(audio);
        if (text.find_first_not_of(" \r\n\t") != std::string::npos)
          line("{\"type\":\"text\",\"text\":" + jsonQuote(text) + "}");
      }
    } catch (const std::exception &) {
      error("recognition"); stopRequested = true;
      std::lock_guard<std::mutex> lock(mutex); failed = true;
    }
  });
  try {
    const pa_sample_spec format{PA_SAMPLE_S16LE, RATE, 1};
    int reason = 0;
    std::unique_ptr<pa_simple, decltype(&pa_simple_free)> pulse(nullptr, pa_simple_free);
    std::vector<int16_t> input;
    if (fixture.empty()) {
      const char *selected = std::getenv("PULSE_SERVER");
      const bool local = isLocalAudioServer(selected);
      const std::string server =
          local && selected != nullptr && *selected != '\0' ? selected : localAudioServer();
      for (const char *name : AUDIO_SERVER_VARIABLES) unsetenv(name);
      if (!local) throw std::runtime_error("remote-server");
      pulse.reset(pa_simple_new(server.c_str(), "Muse Spark Code (Unofficial)", PA_STREAM_RECORD,
                               nullptr, "Muse Spark Code (Unofficial)", &format, nullptr, nullptr, &reason));
      if (!pulse) throw std::runtime_error("pulse-capture");
    } else input = wav(fixture);
    if (!stopRequested) line("{\"type\":\"listening\"}");
    std::vector<float> phrase;
    bool voiced = false;
    size_t quiet = 0, offset = 0;
    auto submit = [&] {
      if (voiced) {
        std::lock_guard<std::mutex> lock(mutex);
        if (failed || queued + phrase.size() > QUEUE_LIMIT) throw std::runtime_error("audio-backlog");
        queued += phrase.size(); queue.push_back(std::move(phrase)); changed.notify_one();
      }
      phrase.clear(); voiced = false; quiet = 0;
    };
    while (!stopRequested) {
      std::vector<int16_t> frame(FRAME);
      if (pulse) {
        if (pa_simple_read(pulse.get(), frame.data(), frame.size()*sizeof(int16_t), &reason) < 0)
          throw std::runtime_error("pulse-capture");
      } else {
        if (offset == input.size()) break;
        const size_t count = std::min(FRAME, input.size()-offset);
        std::copy_n(input.begin()+offset, count, frame.begin()); frame.resize(count); offset += count;
      }
      float level = 0;
      for (int16_t sample : frame) { float f = sample / 32768.0f; phrase.push_back(f); level += std::abs(f); }
      bool speech = level / frame.size() >= SILENCE;
      voiced = voiced || speech; quiet = speech ? 0 : quiet + frame.size();
      if (phrase.size() >= PHRASE || (quiet >= RATE && phrase.size() >= RATE * 2)) submit();
    }
    submit();
  } catch (const std::exception &e) { error(e.what()); }
  {
    std::lock_guard<std::mutex> lock(mutex); done = true;
  }
  changed.notify_one(); inference.join();
  line("{\"type\":\"stopped\"}");
}

int main(int argc, char **argv) {
  std::thread session;
  try {
    std::string model, fixture;
    for (int i = 1; i < argc; i += 2) {
      if (i+1 >= argc) throw std::runtime_error("arguments");
      if (std::string(argv[i]) == "--model") model = argv[i+1];
      else if (std::string(argv[i]) == "--input-wav") fixture = argv[i+1];
      else throw std::runtime_error("arguments");
    }
    if (model.empty()) throw std::runtime_error("arguments");
    if (!fixture.empty()) fixture = std::filesystem::absolute(fixture).string();
    Engine engine(model);
    line("{\"type\":\"ready\",\"language\":\"en\",\"recognizer\":\"whisper.cpp tiny.en\"}");
    std::string command;
    while (std::getline(std::cin, command)) {
      if (command == "start") {
        stopRequested = true;
        if (session.joinable()) session.join();
        stopRequested = false;
        session = std::thread([&] { record(engine, fixture); });
      } else if (command == "stop") stopRequested = true;
      else if (command == "quit") break;
      else { error("command"); break; }
    }
    stopRequested = true;
    if (session.joinable()) session.join();
  } catch (const std::exception &e) {
    stopRequested = true;
    if (session.joinable()) session.join();
    error(e.what()); return 1;
  }
  return 0;
}
