// Muse Spark Code: voice dictation helper for macOS.
//
// Recognises speech with Apple's Speech framework (SFSpeechRecognizer) fed
// from the default microphone through AVAudioEngine. Apple frameworks only;
// nothing is installed and nothing is billed. Recognition runs on the device
// whenever the recogniser supports it for the current language; otherwise
// Apple's servers do it under Apple's privacy terms (see docs/PRIVACY.md).
//
// Same line protocol as native/windows/dictate.ps1. Commands arrive on stdin,
// one per line; results leave on stdout, one JSON object per line:
//
//   stdin  "start"  begin listening        stdout  {"type":"ready","language":"en-US","recognizer":"..."}
//   stdin  "stop"   finish the phrase       stdout  {"type":"listening"}
//   stdin  "quit"   exit (EOF does too)     stdout  {"type":"text","text":"..."}
//                                           stdout  {"type":"stopped"}
//                                           stdout  {"type":"error","reason":"..."}   (then exits 2)
//
// Built by native/darwin/build.sh (CI's macOS job) into a universal binary
// with Info.plist embedded, since the microphone and speech-recognition
// permission prompts need usage descriptions even for a command-line tool.

import AVFoundation
import Foundation
import Speech

let exitCodeUnavailable: Int32 = 2

enum Output {
    static let lock = NSLock()

    static func send(_ payload: [String: Any]) {
        lock.lock()
        defer { lock.unlock() }
        guard let data = try? JSONSerialization.data(withJSONObject: payload, options: []) else {
            return
        }
        FileHandle.standardOutput.write(data)
        FileHandle.standardOutput.write(Data([0x0A]))
    }

    static func fail(_ reason: String) -> Never {
        send(["type": "error", "reason": reason])
        exit(exitCodeUnavailable)
    }
}

/// One recording: an audio tap feeding a recognition request until "stop".
final class Recording {
    private let recognizer: SFSpeechRecognizer
    private let engine = AVAudioEngine()
    private let request = SFSpeechAudioBufferRecognitionRequest()
    private var task: SFSpeechRecognitionTask?
    private var isStopping = false
    private let onFinished: () -> Void

    init(recognizer: SFSpeechRecognizer, onFinished: @escaping () -> Void) {
        self.recognizer = recognizer
        self.onFinished = onFinished
    }

    func start() throws {
        request.shouldReportPartialResults = false
        if recognizer.supportsOnDeviceRecognition {
            request.requiresOnDeviceRecognition = true
        }
        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { [request] buffer, _ in
            request.append(buffer)
        }
        engine.prepare()
        try engine.start()
        task = recognizer.recognitionTask(with: request) { [weak self] result, error in
            self?.handle(result: result, error: error)
        }
        Output.send(["type": "listening"])
    }

    /// Ends the audio; the final transcription arrives, then "stopped".
    func stop() {
        guard !isStopping else { return }
        isStopping = true
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
        request.endAudio()
    }

    func cancel() {
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
        task?.cancel()
    }

    private func handle(result: SFSpeechRecognitionResult?, error: Error?) {
        if let result = result, result.isFinal {
            let text = result.bestTranscription.formattedString
            if !text.isEmpty {
                Output.send(["type": "text", "text": text])
            }
            finish()
            return
        }
        if let error = error {
            // Ending audio with nothing said reports "no speech detected";
            // that is a normal stop, not a failure.
            let nsError = error as NSError
            let isSilence = nsError.domain == "kAFAssistantErrorDomain" && nsError.code == 1110
            if !isStopping || !isSilence {
                Output.send([
                    "type": "error",
                    "reason": "Speech recognition stopped: \(error.localizedDescription)",
                ])
                cancel()
                exit(exitCodeUnavailable)
            }
            finish()
        }
    }

    private func finish() {
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
        Output.send(["type": "stopped"])
        onFinished()
    }
}

final class Session {
    private let recognizer: SFSpeechRecognizer
    private var recording: Recording?
    private var isStartQueued = false

    init(recognizer: SFSpeechRecognizer) {
        self.recognizer = recognizer
    }

    func handle(command: String) {
        switch command {
        case "start":
            if recording == nil {
                startRecording()
            } else {
                isStartQueued = true
            }
        case "stop":
            isStartQueued = false
            recording?.stop()
        case "quit":
            recording?.cancel()
            exit(0)
        default:
            break
        }
    }

    private func startRecording() {
        let next = Recording(recognizer: recognizer) { [weak self] in
            self?.recordingFinished()
        }
        do {
            try next.start()
            recording = next
        } catch {
            Output.fail("The microphone could not be started: \(error.localizedDescription)")
        }
    }

    private func recordingFinished() {
        recording = nil
        if isStartQueued {
            isStartQueued = false
            startRecording()
        }
    }
}

func requestAuthorization() -> Bool {
    let semaphore = DispatchSemaphore(value: 0)
    var speechStatus = SFSpeechRecognizerAuthorizationStatus.notDetermined
    SFSpeechRecognizer.requestAuthorization { status in
        speechStatus = status
        semaphore.signal()
    }
    semaphore.wait()
    guard speechStatus == .authorized else {
        return false
    }
    var isMicrophoneAllowed = false
    AVCaptureDevice.requestAccess(for: .audio) { granted in
        isMicrophoneAllowed = granted
        semaphore.signal()
    }
    semaphore.wait()
    return isMicrophoneAllowed
}

guard requestAuthorization() else {
    Output.fail(
        "Speech recognition or the microphone is not allowed for Visual Studio Code. Allow both in System Settings > Privacy & Security.")
}

guard let recognizer = SFSpeechRecognizer(locale: Locale.current) ?? SFSpeechRecognizer() else {
    Output.fail("No speech recogniser is available for this language.")
}
guard recognizer.isAvailable else {
    Output.fail("The speech recogniser is not available right now.")
}

let session = Session(recognizer: recognizer)
Output.send([
    "type": "ready",
    "language": recognizer.locale.identifier,
    "recognizer": recognizer.supportsOnDeviceRecognition ? "Apple Speech (on device)" : "Apple Speech",
])

// Commands are read on a background thread and handled on the main queue,
// where the audio engine and the recognition callbacks are serialised.
Thread {
    while let line = readLine() {
        let command = line.trimmingCharacters(in: .whitespacesAndNewlines)
        DispatchQueue.main.async {
            session.handle(command: command)
        }
    }
    // EOF: the host went away.
    DispatchQueue.main.async {
        session.handle(command: "quit")
    }
}.start()

dispatchMain()
