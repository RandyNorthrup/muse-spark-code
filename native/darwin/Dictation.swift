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
// Capture mode (`--capture`) serves Muse Voice, the opt-in paid engine, in
// which the extension host streams the audio to Meta's Muse Voice Transcribe
// and the text comes back from there. The helper then recognises nothing and
// asks macOS for the microphone alone, never for speech recognition. It sends
// the microphone's audio as it is heard, converted to signed 16-bit
// little-endian PCM, mono, at 16,000 Hz, in lines of 100 ms (3,200 bytes),
// base64-encoded. The commands are the same; the lines are these:
//
//   stdout  {"type":"ready","language":"pcm_s16le","recognizer":"capture 16000 Hz mono"}
//   stdout  {"type":"listening"}                    once the audio engine runs after "start"
//   stdout  {"type":"audio","data":"<base64>"}      100 ms of audio, again and again while listening
//   stdout  {"type":"stopped"}                      after "stop", once the last, shorter audio line is out
//   stdout  {"type":"error","reason":"..."}         (then exits 2)
//
// "quit" in capture mode stops the microphone and exits without sending the
// audio still held back, since the host that asked for it is going away. The
// Windows helper has the same mode, with the same lines.
//
// Built by native/darwin/build.sh (CI's macOS job) into a universal binary
// with Info.plist embedded, since the microphone and speech-recognition
// permission prompts need usage descriptions even for a command-line tool.

import AVFoundation
import CoreAudio
import Foundation
import Speech

let exitCodeUnavailable: Int32 = 2

// MARK: - Responsibility

/// macOS charges a process's privacy requests to the app responsible for it,
/// which for a helper is the app that started it: Visual Studio Code for the
/// panel. VS Code declares no speech-recognition purpose, so macOS refuses
/// that request without asking (microsoft/vscode#307364), and dictation
/// cannot start from the panel at all. So the helper starts itself once
/// more, disclaiming that responsibility, and the copy answers for its own
/// requests: macOS asks for "muse-dictate" with the usage descriptions in
/// its own embedded Info.plist, and System Settings lists it under that name
/// (PLAN.md M28).
///
/// `responsibility_spawnattrs_setdisclaim` is a private libsystem call,
/// the one Chromium, Qt and Electron's `disclaim` spawn option use. It is
/// looked up at run time: where it is missing, or the spawn fails, the
/// helper runs as it always did and says so on stderr. The first process
/// stays as a thin parent, so the host's process handle, its signals and
/// the exit code mean what they did; stdin, stdout and stderr are inherited.
let disclaimedMarker = "MUSE_DICTATE_DISCLAIMED"
/// `RTLD_DEFAULT` on Darwin: search every image loaded into the process.
let everyLoadedImage = UnsafeMutableRawPointer(bitPattern: -2)
/// A process ended by a signal exits, by shell convention, with 128 + the signal.
let signalExitBase: Int32 = 128
let forwardedSignals: [Int32] = [SIGTERM, SIGINT, SIGHUP]

typealias SetDisclaim = @convention(c) (UnsafeMutablePointer<posix_spawnattr_t?>, Int32) -> Int32

/// True in the copy that disclaimed its parent's responsibility.
let isDisclaimed = ProcessInfo.processInfo.environment[disclaimedMarker] != nil

/// The host's signals, caught from before the copy exists until this
/// process exits: a signal that arrives while the copy starts is held and
/// sent on to it once its id is known, so the host never ends the parent
/// alone and leaves the copy holding the pipes. The sources run on a queue
/// of their own, so a signal is caught the moment it is delivered, whatever
/// the main thread is doing.
final class SignalRelay {
    private let queue = DispatchQueue(label: "muse-dictate.signal-relay")
    private var sources: [DispatchSourceSignal] = []
    private var target: pid_t = 0
    private var caught: Int32 = 0

    init() {
        for number in forwardedSignals {
            // The source first: the kernel records a signal for it even while
            // it is ignored, and ignoring it is what stops it ending us.
            let source = DispatchSource.makeSignalSource(signal: number, queue: queue)
            source.setEventHandler { [unowned self] in
                if target > 0 {
                    kill(target, number)
                } else {
                    caught = number
                }
            }
            source.resume()
            sources.append(source)
            signal(number, SIG_IGN)
        }
    }

    /// From now on signals go to `copy`, the one caught meanwhile first.
    func forward(to copy: pid_t) {
        queue.sync {
            target = copy
            if caught != 0 {
                kill(copy, caught)
            }
        }
    }

    /// No copy after all: the dispositions are restored, and a signal caught
    /// meanwhile ends this process as it would have.
    func release() {
        let pending: Int32 = queue.sync {
            sources.forEach { $0.cancel() }
            return caught
        }
        forwardedSignals.forEach { signal($0, SIG_DFL) }
        if pending != 0 {
            raise(pending)
        }
    }
}

/// The copy's process id, or nil when the helper could not start it and
/// runs itself instead (the reason written on stderr). The copy starts with
/// the default action for the relayed signals, which the relay ignores here.
func startDisclaimedCopy() -> pid_t? {
    guard let symbol = dlsym(everyLoadedImage, "responsibility_spawnattrs_setdisclaim") else {
        FileHandle.standardError.write(
            Data("responsibility_spawnattrs_setdisclaim is not available; asking as the app that started the helper\n".utf8))
        return nil
    }
    guard let executable = Bundle.main.executablePath else {
        FileHandle.standardError.write(Data("the helper's own path is unknown; asking as the app that started it\n".utf8))
        return nil
    }
    let setDisclaim = unsafeBitCast(symbol, to: SetDisclaim.self)
    var attributes: posix_spawnattr_t? = nil
    posix_spawnattr_init(&attributes)
    defer { posix_spawnattr_destroy(&attributes) }
    guard setDisclaim(&attributes, 1) == 0 else {
        FileHandle.standardError.write(Data("disclaiming responsibility failed; asking as the app that started the helper\n".utf8))
        return nil
    }
    // An ignored signal stays ignored across exec: reset the relayed ones.
    var defaults = sigset_t()
    sigemptyset(&defaults)
    forwardedSignals.forEach { sigaddset(&defaults, $0) }
    posix_spawnattr_setsigdefault(&attributes, &defaults)
    posix_spawnattr_setflags(&attributes, Int16(POSIX_SPAWN_SETSIGDEF))
    var environment = ProcessInfo.processInfo.environment
    environment[disclaimedMarker] = "1"
    let argv = [executable] + CommandLine.arguments.dropFirst()
    let envp = environment.map { "\($0.key)=\($0.value)" }
    var cArgv = argv.map { strdup($0) } + [nil]
    var cEnvp = envp.map { strdup($0) } + [nil]
    defer {
        cArgv.forEach { free($0) }
        cEnvp.forEach { free($0) }
    }
    var pid: pid_t = 0
    let status = posix_spawn(&pid, executable, nil, &attributes, &cArgv, &cEnvp)
    guard status == 0 else {
        FileHandle.standardError.write(
            Data("starting the helper disclaimed failed (\(String(cString: strerror(status)))); asking as the app that started it\n".utf8))
        return nil
    }
    return pid
}

/// Stands in for the copy until it exits: the relay sends it the host's
/// signals, and its exit status becomes this process's.
func relayUntilExit(of copy: pid_t, with relay: SignalRelay) -> Never {
    relay.forward(to: copy)
    let exit = DispatchSource.makeProcessSource(identifier: copy, eventMask: .exit, queue: .main)
    exit.setEventHandler {
        var status: Int32 = 0
        waitpid(copy, &status, 0)
        // WIFEXITED / WEXITSTATUS / WTERMSIG, which Swift does not import.
        let signalled = status & 0x7f
        Foundation.exit(signalled == 0 ? (status >> 8) & 0xff : signalExitBase + signalled)
    }
    exit.resume()
    withExtendedLifetime((relay, exit)) { dispatchMain() }
}

if !isDisclaimed {
    let relay = SignalRelay()
    if let copy = startDisclaimedCopy() {
        relayUntilExit(of: copy, with: relay)
    }
    relay.release()
}

/// No usable input device: none is the system default, or the default
/// carries no input channels.
struct NoAudioInputError: LocalizedError {
    let detail: String
    var errorDescription: String? { "no audio input device is available (\(detail))" }
}

/// `--on-device`: refuse Apple's servers, even where that means no result.
/// By default Apple chooses: on-device recognition where the model is
/// installed (Apple silicon with Dictation on), otherwise its servers at no
/// charge. Forcing on-device where `supportsOnDeviceRecognition` is true
/// but the model is absent (an Intel Mac mini, 2026-09-22) yields an empty
/// final result and no error, which is worse than the server round trip.
let requiresOnDeviceRecognition = CommandLine.arguments.contains("--on-device")

/// `--capture`: send the microphone's audio instead of recognising it (the
/// capture mode in the header). The disclaimed copy starts with the same
/// arguments, so the copy captures too.
let isCaptureMode = CommandLine.arguments.contains("--capture")

/// Capture mode's audio: signed 16-bit PCM, mono, 16,000 Hz. Intel and Apple
/// silicon are both little-endian, so the samples as they lie in memory are
/// already the little-endian bytes the host expects.
let captureSampleRate: Double = 16_000
/// The encoding named in capture mode's "ready" line.
let captureEncoding = "pcm_s16le"
/// Audio per capture line: 100 ms of 16-bit mono at 16,000 Hz.
let captureLineBytes = 3_200
/// Room in each converted buffer beyond the tap buffer's own length at the
/// new rate, for the frames the sample-rate converter held back from an
/// earlier buffer and releases with this one.
let converterHeadroomFrames: AVAudioFrameCount = 512
/// The largest magnitude a 16-bit sample reaches, for the level in the trace.
let int16FullScale: Float = 32_768
/// The frames per tap buffer asked of AVAudioEngine, which may deliver more.
let tapBufferFrames: AVAudioFrameCount = 1024

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

/// The engine's input node, switched to `inputDevice` when one was chosen,
/// and the hardware input format a tap on it must take.
func openInput(of engine: AVAudioEngine, device inputDevice: AudioObjectID?) throws -> (
    node: AVAudioInputNode, format: AVAudioFormat
) {
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
    return (input, hardware)
}

/// What a "start" begins: a Recording, which recognises speech, or in
/// capture mode a Capture, which sends the audio itself.
protocol Listener: AnyObject {
    func start() throws
    /// Ends the audio; "stopped" follows once the last result is out.
    func stop()
    /// Ends the audio and sends nothing more.
    func cancel()
}

/// One recording: an audio tap feeding a recognition request until "stop".
final class Recording: Listener {
    private let recognizer: SFSpeechRecognizer
    /// A specific CoreAudio input device (`--input-device <uid>`); nil for
    /// the system default.
    private let inputDevice: AudioObjectID?
    private let engine = AVAudioEngine()
    private let request = SFSpeechAudioBufferRecognitionRequest()
    private var task: SFSpeechRecognitionTask?
    private var isStopping = false
    private let onFinished: () -> Void
    /// Level metering for the stderr trace: a silent microphone is the
    /// commonest reason for "no text", and this names it.
    private var peak: Float = 0
    private var bufferCount = 0

    init(recognizer: SFSpeechRecognizer, inputDevice: AudioObjectID?, onFinished: @escaping () -> Void) {
        self.recognizer = recognizer
        self.inputDevice = inputDevice
        self.onFinished = onFinished
    }

    func start() throws {
        request.shouldReportPartialResults = false
        request.taskHint = .dictation
        if requiresOnDeviceRecognition {
            request.requiresOnDeviceRecognition = true
        }
        Output.trace(
            "recognition \(request.requiresOnDeviceRecognition ? "on device only" : "on device where installed, otherwise Apple's servers")")
        let (input, hardware) = try openInput(of: engine, device: inputDevice)
        input.installTap(onBus: 0, bufferSize: tapBufferFrames, format: hardware) { [weak self, request] buffer, _ in
            request.append(buffer)
            self?.meter(buffer)
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

    /// Runs on the audio thread: the loudest sample so far and the buffer count.
    private func meter(_ buffer: AVAudioPCMBuffer) {
        bufferCount += 1
        guard let channels = buffer.floatChannelData else { return }
        let frames = Int(buffer.frameLength)
        for channel in 0..<Int(buffer.format.channelCount) {
            let samples = channels[channel]
            for frame in 0..<frames {
                peak = max(peak, abs(samples[frame]))
            }
        }
    }

    private func handle(result: SFSpeechRecognitionResult?, error: Error?) {
        if let result = result, result.isFinal {
            let text = result.bestTranscription.formattedString
            Output.trace("final result: \(text.count) characters")
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
            Output.trace(
                "recognition error \(nsError.domain) \(nsError.code): \(error.localizedDescription)")
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
        Output.trace("captured \(bufferCount) buffers, peak level \(peak)")
        Output.send(["type": "stopped"])
        onFinished()
    }
}

/// The capture converter could not be made.
struct CaptureError: LocalizedError {
    let detail: String
    var errorDescription: String? { detail }
}

/// One capture (capture mode): an audio tap whose buffers are converted to
/// 16,000 Hz mono 16-bit PCM and sent as "audio" lines until "stop".
final class Capture: Listener {
    /// A specific CoreAudio input device (`--input-device <uid>`); nil for
    /// the system default.
    private let inputDevice: AudioObjectID?
    private let engine = AVAudioEngine()
    private let onFinished: () -> Void
    /// Guards everything below it. The tap runs on the audio engine's own
    /// thread, while "stop" and "quit" run on the main queue.
    private let lock = NSLock()
    private var converter: AVAudioConverter?
    /// Converted audio not yet sent: less than a line's worth between taps.
    private var pending = Data()
    /// Set by "stop" and "quit"; a tap buffer that arrives afterwards is dropped.
    private var isClosed = false
    /// For the stderr trace, as in Recording: a silent microphone is the
    /// commonest reason for "no text", and the level names it.
    private var bufferCount = 0
    private var sentBytes = 0
    private var peak = 0

    init(inputDevice: AudioObjectID?, onFinished: @escaping () -> Void) {
        self.inputDevice = inputDevice
        self.onFinished = onFinished
    }

    func start() throws {
        guard
            let target = AVAudioFormat(
                commonFormat: .pcmFormatInt16, sampleRate: captureSampleRate, channels: 1, interleaved: true)
        else {
            throw CaptureError(detail: "the \(Int(captureSampleRate)) Hz mono 16-bit format could not be made")
        }
        let (input, hardware) = try openInput(of: engine, device: inputDevice)
        Output.trace(
            "converter \(hardware.sampleRate) Hz, \(hardware.channelCount) ch to \(target.sampleRate) Hz, \(target.channelCount) ch, 16-bit")
        guard let converter = AVAudioConverter(from: hardware, to: target) else {
            throw CaptureError(
                detail:
                    "no converter from \(hardware.sampleRate) Hz, \(hardware.channelCount) channels to \(Int(captureSampleRate)) Hz mono 16-bit PCM"
            )
        }
        // Mix every input channel into the one sent, rather than keep the
        // first and drop the rest, so a microphone on any channel is heard.
        converter.downmix = true
        self.converter = converter
        input.installTap(onBus: 0, bufferSize: tapBufferFrames, format: hardware) { [weak self] buffer, _ in
            self?.receive(buffer)
        }
        Output.trace("engine start")
        engine.prepare()
        try engine.start()
        Output.send(["type": "listening"])
    }

    /// Ends the audio: the converter gives up the frames it still holds, the
    /// rest goes out as a last, shorter line, then "stopped".
    func stop() {
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
        guard drain() else { return }
        Output.send(["type": "stopped"])
        onFinished()
    }

    func cancel() {
        lock.lock()
        isClosed = true
        lock.unlock()
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
    }

    /// Runs on the audio thread: converts one tap buffer and sends every
    /// whole line's worth of audio it completes.
    private func receive(_ buffer: AVAudioPCMBuffer) {
        lock.lock()
        defer { lock.unlock() }
        guard !isClosed else { return }
        bufferCount += 1
        convert(buffer)
        sendLines(includingRest: false)
    }

    /// Closes the capture and sends everything still held; false when it was
    /// already closed. A tap buffer still in flight when the tap was removed
    /// either went out before this or is dropped after it.
    private func drain() -> Bool {
        lock.lock()
        defer { lock.unlock() }
        guard !isClosed else { return false }
        isClosed = true
        convert(nil)
        sendLines(includingRest: true)
        Output.trace(
            "captured \(bufferCount) buffers, sent \(sentBytes) bytes, peak level \(Float(peak) / int16FullScale)")
        return true
    }

    /// Feeds one tap buffer through the converter, or with nil the end of
    /// the stream, which makes the converter give up what it holds back.
    /// The converted audio joins `pending`. Called with the lock held.
    private func convert(_ buffer: AVAudioPCMBuffer?) {
        guard let converter = converter else { return }
        let ratio = captureSampleRate / converter.inputFormat.sampleRate
        let capacity =
            AVAudioFrameCount((Double(buffer?.frameLength ?? 0) * ratio).rounded(.up)) + converterHeadroomFrames
        var isSupplied = false
        while true {
            guard let output = AVAudioPCMBuffer(pcmFormat: converter.outputFormat, frameCapacity: capacity) else {
                return
            }
            var failure: NSError?
            let status = converter.convert(to: output, error: &failure) { _, inputStatus in
                guard let buffer = buffer else {
                    inputStatus.pointee = .endOfStream
                    return nil
                }
                // The converter may ask more than once per call; the buffer
                // goes in once.
                guard !isSupplied else {
                    inputStatus.pointee = .noDataNow
                    return nil
                }
                isSupplied = true
                inputStatus.pointee = .haveData
                return buffer
            }
            if status == .error {
                Output.fail(
                    "The microphone's audio could not be converted: \(failure?.localizedDescription ?? "no reason given")")
            }
            append(output)
            // .haveData means the output buffer filled and more is waiting;
            // .inputRanDry and .endOfStream mean everything so far is out.
            guard status == .haveData, output.frameLength > 0 else { return }
        }
    }

    private func append(_ output: AVAudioPCMBuffer) {
        guard output.frameLength > 0, let samples = output.int16ChannelData?[0] else { return }
        let frames = UnsafeBufferPointer(start: samples, count: Int(output.frameLength))
        for sample in frames {
            peak = max(peak, abs(Int(sample)))
        }
        pending.append(frames)
    }

    /// Sends `pending` in lines of 100 ms, and with `includingRest` whatever
    /// shorter remainder is left too.
    private func sendLines(includingRest: Bool) {
        var start = pending.startIndex
        while pending.endIndex - start >= captureLineBytes {
            let end = start + captureLineBytes
            sendAudio(pending[start..<end])
            start = end
        }
        if includingRest, start < pending.endIndex {
            sendAudio(pending[start...])
            start = pending.endIndex
        }
        pending = Data(pending[start...])
    }

    private func sendAudio(_ chunk: Data) {
        sentBytes += chunk.count
        Output.send(["type": "audio", "data": chunk.base64EncodedString()])
    }
}

final class Session {
    /// Makes what a "start" begins, given what it calls once it has stopped.
    private let makeRecording: (@escaping () -> Void) -> Listener
    private var recording: Listener?
    private var isStartQueued = false

    init(makeRecording: @escaping (@escaping () -> Void) -> Listener) {
        self.makeRecording = makeRecording
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
        let next = makeRecording { [weak self] in
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

/// The name macOS asks under, and System Settings lists: the helper's own
/// (its embedded CFBundleName) once it has disclaimed responsibility.
let helperName = "muse-dictate"

/// The app macOS asks on this helper's behalf. Disclaimed, that is the
/// helper itself. Otherwise macOS charges the requests to the app that
/// started it: Visual Studio Code when the panel starts it (the extension
/// passes VS Code's own name with `--app-name`), Terminal when it is run by
/// hand, and an SSH session, which macOS never prompts, over SSH (tccd
/// logged "responsible=... sshd-keygen-wrapper, requesting=...dictate" and
/// "Policy disallows prompt" for the M26 check on the owner's Mac mini).
let appName: String = {
    if isDisclaimed {
        return helperName
    }
    let arguments = CommandLine.arguments
    if let flag = arguments.firstIndex(of: "--app-name"), flag + 1 < arguments.count {
        return arguments[flag + 1]
    }
    return "the app that started this helper"
}()

/// Asks for speech recognition, then the microphone; nil when both are
/// allowed, otherwise the refusal the user reads. Each request is announced
/// on stderr first, so a helper that macOS ends at a request (rather than
/// answering it) names the request in the host's report.
func authorizationFailure() -> String? {
    let semaphore = DispatchSemaphore(value: 0)
    var speechStatus = SFSpeechRecognizerAuthorizationStatus.notDetermined
    Output.trace("asking macOS for speech recognition for \(appName)")
    SFSpeechRecognizer.requestAuthorization { status in
        speechStatus = status
        semaphore.signal()
    }
    semaphore.wait()
    switch speechStatus {
    case .authorized:
        break
    case .restricted:
        return "Speech recognition is restricted on this Mac (by a device-management profile or Screen Time), so dictation cannot run."
    case _ where isDisclaimed:
        return "macOS did not allow speech recognition for \(helperName), Muse Spark Code's dictation helper. Turn it on in System Settings > Privacy & Security > Speech Recognition and try again."
    default:
        // Visual Studio Code declares a microphone purpose but no speech
        // recognition purpose in its Info.plist, and macOS then refuses the
        // request without asking (microsoft/vscode#307364): there is no
        // switch to turn on in that case, and the text says so.
        return "macOS did not allow speech recognition for \(appName), the app that started the dictation helper. If \(appName) is listed in System Settings > Privacy & Security > Speech Recognition, turn it on and try again. If it is not listed, macOS refused without asking, which it does for Visual Studio Code because Visual Studio Code does not declare speech recognition (microsoft/vscode#307364); dictation cannot work there until it does."
    }
    var isMicrophoneAllowed = false
    Output.trace("asking macOS for the microphone for \(appName)")
    AVCaptureDevice.requestAccess(for: .audio) { granted in
        isMicrophoneAllowed = granted
        semaphore.signal()
    }
    semaphore.wait()
    guard isMicrophoneAllowed else {
        return "macOS did not allow the microphone for \(appName), the app that started the dictation helper. Turn it on in System Settings > Privacy & Security > Microphone and try again."
    }
    return nil
}

/// Capture mode asks for the microphone alone: the audio is transcribed by
/// the extension host's engine, so speech recognition is never requested.
/// Nil when the microphone is allowed, otherwise the refusal the user reads.
/// A decided status is not asked again; an undecided one is asked, and
/// announced on stderr first as in `authorizationFailure()`.
func microphoneFailure() -> String? {
    switch AVCaptureDevice.authorizationStatus(for: .audio) {
    case .authorized:
        return nil
    case .restricted:
        return "The microphone is restricted on this Mac (by a device-management profile or Screen Time), so dictation cannot run."
    case .notDetermined:
        let semaphore = DispatchSemaphore(value: 0)
        var isMicrophoneAllowed = false
        Output.trace("asking macOS for the microphone for \(appName)")
        AVCaptureDevice.requestAccess(for: .audio) { granted in
            isMicrophoneAllowed = granted
            semaphore.signal()
        }
        semaphore.wait()
        if isMicrophoneAllowed {
            return nil
        }
    default:
        Output.trace("macOS has refused the microphone to \(appName)")
    }
    if isDisclaimed {
        return "macOS did not allow the microphone for \(helperName), Muse Spark Code's dictation helper. Turn it on in System Settings > Privacy & Security > Microphone and try again."
    }
    return "macOS did not allow the microphone for \(appName), the app that started the dictation helper. Turn it on in System Settings > Privacy & Security > Microphone and try again."
}

/// Diagnostics: `--input-device <CoreAudio UID>` captures from that device
/// instead of the system default (the test rig feeds a loopback device; a
/// user can pick one microphone among several). Nil for the system default.
func chosenInputDevice() -> AudioObjectID? {
    let arguments = CommandLine.arguments
    guard let flag = arguments.firstIndex(of: "--input-device") else {
        return nil
    }
    guard flag + 1 < arguments.count else {
        Output.fail("--input-device needs a CoreAudio device UID.")
    }
    let uid = arguments[flag + 1]
    let device = inputDevice(withUID: uid)
    guard device != 0 else {
        Output.fail("No audio device has the UID \(uid).")
    }
    return device
}

/// Normal mode: speech recognition and the microphone allowed, a recogniser
/// for the current language, then "ready".
func startDictation() -> Session {
    if let refusal = authorizationFailure() {
        Output.fail(refusal)
    }
    guard let recognizer = SFSpeechRecognizer(locale: Locale.current) ?? SFSpeechRecognizer() else {
        Output.fail("No speech recogniser is available for this language.")
    }
    guard recognizer.isAvailable else {
        Output.fail("The speech recogniser is not available right now.")
    }
    let chosenInput = chosenInputDevice()
    let session = Session { onFinished in
        Recording(recognizer: recognizer, inputDevice: chosenInput, onFinished: onFinished)
    }
    Output.send([
        "type": "ready",
        "language": recognizer.locale.identifier,
        "recognizer": recognizer.supportsOnDeviceRecognition
            ? "Apple Speech (on-device capable)" : "Apple Speech",
    ])
    return session
}

/// Capture mode: the microphone allowed, then "ready" naming the audio format.
func startCapture() -> Session {
    if let refusal = microphoneFailure() {
        Output.fail(refusal)
    }
    let chosenInput = chosenInputDevice()
    let session = Session { onFinished in
        Capture(inputDevice: chosenInput, onFinished: onFinished)
    }
    Output.send([
        "type": "ready",
        "language": captureEncoding,
        "recognizer": "capture \(Int(captureSampleRate)) Hz mono",
    ])
    return session
}

let session = isCaptureMode ? startCapture() : startDictation()

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
