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
import CoreAudio
import Foundation
import Speech

let exitCodeUnavailable: Int32 = 2

/// No usable input device: none is the system default, or the default
/// carries no input channels.
struct NoAudioInputError: LocalizedError {
    let detail: String
    var errorDescription: String? { "no audio input device is available (\(detail))" }
}

/// The CoreAudio device with this UID, 0 when there is none.
func inputDevice(withUID uid: String) -> AudioObjectID {
    var address = AudioObjectPropertyAddress(
        mSelector: kAudioHardwarePropertyTranslateUIDToDevice,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain)
    var cfUid = uid as CFString
    var device: AudioObjectID = 0
    var size = UInt32(MemoryLayout<AudioObjectID>.size)
    let status = withUnsafePointer(to: &cfUid) { pointer in
        AudioObjectGetPropertyData(
            AudioObjectID(kAudioObjectSystemObject), &address,
            UInt32(MemoryLayout<CFString>.size), pointer, &size, &device)
    }
    return status == noErr ? device : 0
}

/// CoreAudio's default input device, 0 when the system has none.
func defaultInputDevice() -> AudioObjectID {
    var address = AudioObjectPropertyAddress(
        mSelector: kAudioHardwarePropertyDefaultInputDevice,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain)
    var device: AudioObjectID = 0
    var size = UInt32(MemoryLayout<AudioObjectID>.size)
    let status = AudioObjectGetPropertyData(
        AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size, &device)
    return status == noErr ? device : 0
}

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

    /// A step marker on stderr. Apple's audio frameworks report some
    /// failures as Objective-C exceptions, which Swift cannot catch and
    /// which end the process; the host shows the last stderr line with the
    /// exit, so the marker names the step that died.
    static func trace(_ step: String) {
        lock.lock()
        defer { lock.unlock() }
        FileHandle.standardError.write(Data("step: \(step)\n".utf8))
    }
}

/// One recording: an audio tap feeding a recognition request until "stop".
final class Recording {
    private let recognizer: SFSpeechRecognizer
    /// A specific CoreAudio input device (`--input-device <uid>`); nil for
    /// the system default.
    private let inputDevice: AudioObjectID?
    private let engine = AVAudioEngine()
    private let request = SFSpeechAudioBufferRecognitionRequest()
    private var task: SFSpeechRecognitionTask?
    private var isStopping = false
    private let onFinished: () -> Void

    init(recognizer: SFSpeechRecognizer, inputDevice: AudioObjectID?, onFinished: @escaping () -> Void) {
        self.recognizer = recognizer
        self.inputDevice = inputDevice
        self.onFinished = onFinished
    }

    func start() throws {
        request.shouldReportPartialResults = false
        if recognizer.supportsOnDeviceRecognition {
            request.requiresOnDeviceRecognition = true
        }
        // A Mac without an input device (a Mac mini with nothing plugged in,
        // seen 2026-09-22): the engine's input node still answers with a
        // nominal output format, but installing a tap on it raises an
        // Objective-C exception, which Swift cannot catch (a crash, not an
        // error). Check CoreAudio's default input and the hardware input
        // format first and report a plain error line instead.
        guard inputDevice != nil || defaultInputDevice() != 0 else {
            throw NoAudioInputError(detail: "no default input device")
        }
        Output.trace("input node")
        let input = engine.inputNode
        if var device = inputDevice {
            Output.trace("select device \(device)")
            guard let unit = input.audioUnit else {
                throw NoAudioInputError(detail: "the input node has no audio unit")
            }
            let status = AudioUnitSetProperty(
                unit, kAudioOutputUnitProperty_CurrentDevice, kAudioUnitScope_Global, 0,
                &device, UInt32(MemoryLayout<AudioObjectID>.size))
            guard status == noErr else {
                throw NoAudioInputError(detail: "device \(device) refused, status \(status)")
            }
        }
        Output.trace("input format")
        let hardware = input.inputFormat(forBus: 0)
        guard hardware.channelCount > 0, hardware.sampleRate > 0 else {
            throw NoAudioInputError(
                detail: "input format \(hardware.sampleRate) Hz, \(hardware.channelCount) channels")
        }
        // The tap takes the hardware input format: the node's output format
        // is cached from the device it was created with, and after a device
        // change the two differ, which AVFAudio treats as a fatal assertion.
        let cached = input.outputFormat(forBus: 0)
        Output.trace(
            "tap hardware \(hardware.sampleRate) Hz, \(hardware.channelCount) ch; node output \(cached.sampleRate) Hz, \(cached.channelCount) ch"
        )
        input.installTap(onBus: 0, bufferSize: 1024, format: hardware) { [request] buffer, _ in
            request.append(buffer)
        }
        Output.trace("engine start")
        engine.prepare()
        try engine.start()
        Output.trace("recognition task")
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
    private let inputDevice: AudioObjectID?
    private var recording: Recording?
    private var isStartQueued = false

    init(recognizer: SFSpeechRecognizer, inputDevice: AudioObjectID?) {
        self.recognizer = recognizer
        self.inputDevice = inputDevice
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
        let next = Recording(recognizer: recognizer, inputDevice: inputDevice) { [weak self] in
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
    // macOS attributes the request to the app that launched the helper:
    // Visual Studio Code in the panel, Terminal when run by hand, and no
    // one at all over SSH (denied without a prompt).
    Output.fail(
        "Speech recognition or the microphone is not allowed for the app that launched this helper (Visual Studio Code). Allow both in System Settings > Privacy & Security.")
}

guard let recognizer = SFSpeechRecognizer(locale: Locale.current) ?? SFSpeechRecognizer() else {
    Output.fail("No speech recogniser is available for this language.")
}
guard recognizer.isAvailable else {
    Output.fail("The speech recogniser is not available right now.")
}

// Diagnostics: `--input-device <CoreAudio UID>` captures from that device
// instead of the system default (the test rig feeds a loopback device; a
// user can pick one microphone among several).
var chosenInput: AudioObjectID? = nil
let arguments = CommandLine.arguments
if let flag = arguments.firstIndex(of: "--input-device") {
    guard flag + 1 < arguments.count else {
        Output.fail("--input-device needs a CoreAudio device UID.")
    }
    let uid = arguments[flag + 1]
    let device = inputDevice(withUID: uid)
    guard device != 0 else {
        Output.fail("No audio device has the UID \(uid).")
    }
    chosenInput = device
}

let session = Session(recognizer: recognizer, inputDevice: chosenInput)
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
