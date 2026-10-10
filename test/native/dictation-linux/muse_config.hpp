#pragma once
// Test-only audio protocol fixture; production generates this header from constants.ts.
namespace muse_config {
constexpr unsigned RATE = 16000;
constexpr unsigned FRAMES_PER_SECOND = 5;
constexpr unsigned PHRASE_SECONDS = 10;
constexpr unsigned QUEUE_SECONDS = 30;
constexpr unsigned WAV_SECONDS = 60;
constexpr float SILENCE = 0.004f;
constexpr unsigned THREADS = 3;
}
