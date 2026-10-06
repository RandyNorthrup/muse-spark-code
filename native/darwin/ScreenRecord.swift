// M105 R1. The build inserts runIfRequested() after the existing disclaim,
// before dictation asks for permissions. This mode never transcribes or sends.
import AVFoundation
import CoreGraphics
import Foundation
import ScreenCaptureKit

struct ScreenRecordOptions {
    static let minimumSeconds = 10
    static let maximumSeconds = 600
    static let maximumBytes = 200 * 1024 * 1024
    let output: URL
    let seconds: Int
    let maxBytes: Int
    let microphone: Bool
    let systemAudio: Bool

    init(arguments: [String]) throws {
        var values: [String: String] = [:]
        let names = ["--output", "--max-seconds", "--max-bytes", "--microphone", "--system-audio"]
        guard arguments.count == names.count * 2 else { throw ScreenRecordFailure.invalidOptions }
        for index in stride(from: 0, to: arguments.count, by: 2) {
            let name = arguments[index]
            values[name] = arguments[index + 1]
        }
        guard let file = values["--output"], file.hasPrefix("/"),
            let seconds = Int(values["--max-seconds"] ?? ""),
            (Self.minimumSeconds...Self.maximumSeconds).contains(seconds),
            let bytes = Int(values["--max-bytes"] ?? ""), bytes > 0, bytes <= Self.maximumBytes,
            let microphone = Self.boolean(values["--microphone"]),
            let systemAudio = Self.boolean(values["--system-audio"])
        else { throw ScreenRecordFailure.invalidOptions }
        self.output = URL(fileURLWithPath: file)
        self.seconds = seconds
        self.maxBytes = bytes
        self.microphone = microphone
        self.systemAudio = systemAudio
    }

    private static func boolean(_ value: String?) -> Bool? {
        if value == "true" { return true }
        if value == "false" { return false }
        return nil
    }

    func validateOutput() throws {
        var status = stat()
        let parent = output.deletingLastPathComponent().path
        guard lstat(parent, &status) == 0, Self.isPrivateDirectory(status, owner: getuid()),
            output.pathExtension == "mp4", lstat(output.path, &status) == -1, errno == ENOENT
        else { throw ScreenRecordFailure.invalidOptions }
    }

    static func isPrivateDirectory(_ status: stat, owner: uid_t) -> Bool {
        status.st_mode & S_IFMT == S_IFDIR && status.st_uid == owner && status.st_mode & 0o777 == 0o700
    }

    func fallbackArguments(audioDevice: UInt32) throws -> [String] {
        // screencapture -G records an input device, never system sound.
        guard !systemAudio else { throw ScreenRecordFailure.unsupportedAudio }
        var args = ["-v", "-V", String(seconds), "-D", "1"]
        if microphone {
            guard audioDevice != 0 else { throw ScreenRecordFailure.unavailable }
            args += ["-G", String(audioDevice)]
        }
        return args + [output.deletingLastPathComponent().appendingPathComponent("capture.mov").path]
    }

    func conversionArguments(source: String) -> [String] {
        ["--source", source, "--output", output.path, "--preset", "Preset1920x1080", "--duration", String(seconds)]
    }
}

enum ScreenRecordFailure: String, Error {
    case screenPermissionDenied, microphonePermissionDenied, unavailable, unsupportedAudio
    case failed, tooLarge, cancelled, invalidOptions
}

enum ScreenRecord {
    @available(macOS 12.3, *)
    static func stoppedByUser(_ error: Error) -> Bool {
        let failure = error as NSError
        return failure.domain == SCStreamErrorDomain && failure.code == SCStreamError.Code.userStopped.rawValue
    }
    static func send(_ frame: [String: String]) {
        if let data = try? JSONSerialization.data(withJSONObject: frame, options: [.sortedKeys]) {
            FileHandle.standardOutput.write(data + Data([10]))
        }
    }

    static func fail(_ code: ScreenRecordFailure) -> Never {
        send(["type": "error", "code": code.rawValue])
        exit(2)
    }

    // Requests are injected so the actual opt-in/denial order is testable without TCC.
    static func permissionFailure(microphoneRequested: Bool, requestScreen: () -> Bool, requestMicrophone: () -> Bool) -> ScreenRecordFailure? {
        if !requestScreen() { return .screenPermissionDenied }
        if microphoneRequested && !requestMicrophone() { return .microphonePermissionDenied }
        return nil
    }

    static func runIfRequested() {
        guard let flag = CommandLine.arguments.firstIndex(of: "--record-screen") else { return }
        // This read-only probe exercises the disclaimed mode without asking TCC.
        if Array(CommandLine.arguments.suffix(from: flag + 1)) == ["--probe"] {
            send(["type": "available", "responsibility": ProcessInfo.processInfo.environment["MUSE_DICTATE_DISCLAIMED"] == nil ? "parent" : "helper"])
            exit(0)
        }
        let options: ScreenRecordOptions
        do {
            options = try ScreenRecordOptions(arguments: Array(CommandLine.arguments.suffix(from: flag + 1)))
            try options.validateOutput()
        } catch { fail(.invalidOptions) }
        umask(0o077)
        // Only an interactive entry point calls this mode. Permission checks run
        // after disclaim and after argument/private-output validation.
        if options.systemAudio {
            guard #available(macOS 13.0, *) else { fail(.unsupportedAudio) }
        }
        let failure = permissionFailure(microphoneRequested: options.microphone, requestScreen: {
            CGPreflightScreenCaptureAccess() || CGRequestScreenCaptureAccess()
        }, requestMicrophone: {
            let semaphore = DispatchSemaphore(value: 0)
            var allowed = false
            AVCaptureDevice.requestAccess(for: .audio) { granted in allowed = granted; semaphore.signal() }
            semaphore.wait()
            return allowed
        })
        if let failure { fail(failure) }
        if #available(macOS 12.3, *) {
            let recorder = ScreenKitRecorder(options: options)
            recorder.listen()
            recorder.queue.async { recorder.start() }
            withExtendedLifetime(recorder) { dispatchMain() }
        } else {
            let recorder = ScreenFallbackRecorder(options: options)
            recorder.listen()
            recorder.queue.async { recorder.start() }
            withExtendedLifetime(recorder) { dispatchMain() }
        }
    }
}

// One owner for stdin, signal and duration/size bounds, shared by both encoders.
class ScreenRecordLifecycle: NSObject {
    let options: ScreenRecordOptions
    let queue = DispatchQueue(label: "muse-dictate.screen-record")
    private var signals: [DispatchSourceSignal] = []
    private var timer: DispatchSourceTimer?
    var stopping = false
    var started = false
    private let now: () -> Date

    init(options: ScreenRecordOptions, now: @escaping () -> Date = Date.init) { self.options = options; self.now = now }
    func start() { ScreenRecord.fail(.unavailable) }
    func stop(cancel: Bool) { ScreenRecord.fail(cancel ? .cancelled : .failed) }

    func listen() {
        for number in [SIGTERM, SIGINT, SIGHUP] {
            let source = DispatchSource.makeSignalSource(signal: number, queue: queue)
            source.setEventHandler { [weak self] in self?.stop(cancel: true) }
            source.resume()
            signal(number, SIG_IGN)
            signals.append(source)
        }
        Thread { [weak self] in
            while let line = readLine() {
                let command = line.trimmingCharacters(in: .whitespacesAndNewlines)
                self?.queue.async { [weak self] in
                    if command == "stop" { self?.stop(cancel: false) }
                    if command == "cancel" || command == "quit" { self?.stop(cancel: true) }
                }
            }
            self?.queue.async { [weak self] in self?.stop(cancel: true) }
        }.start()
    }

    func began() {
        guard !stopping else { stop(cancel: true); return }
        started = true
        ScreenRecord.send(["type": "recording"])
        let deadline = now().addingTimeInterval(Double(options.seconds))
        let timer = DispatchSource.makeTimerSource(queue: queue)
        timer.schedule(deadline: .now(), repeating: 1)
        timer.setEventHandler { [weak self] in
            guard let self else { return }
            let files = (try? FileManager.default.contentsOfDirectory(at: options.output.deletingLastPathComponent(), includingPropertiesForKeys: [.fileSizeKey])) ?? []
            let tooLarge = files.contains { ((try? $0.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0) > self.options.maxBytes }
            if tooLarge { abort(.tooLarge) }
            if now() >= deadline { stop(cancel: false) }
        }
        self.timer = timer
        timer.resume()
    }

    func endBounds() { timer?.cancel(); timer = nil }
    func abort(_ code: ScreenRecordFailure) { removeFiles(); ScreenRecord.fail(code) }
    func removeFiles() {
        try? FileManager.default.removeItem(at: options.output)
        for name in ["capture.mp4", "capture.mov"] {
            try? FileManager.default.removeItem(at: options.output.deletingLastPathComponent().appendingPathComponent(name))
        }
    }
    func finished() {
        let size = (try? options.output.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
        guard size > 0, size <= options.maxBytes else { removeFiles(); ScreenRecord.fail(.tooLarge) }
        chmod(options.output.path, 0o600)
        ScreenRecord.send(["type": "finished"])
        exit(0)
    }
}

// AVAssetWriter is also exercised with generated frames/audio, without TCC.
final class ScreenMovieWriter {
    static let framesPerSecond: Int32 = 30
    static let audioRate = 48_000
    static let audioBitRate = 128_000
    let writer: AVAssetWriter
    let video: AVAssetWriterInput
    let system: AVAssetWriterInput?
    let microphone: AVAssetWriterInput?
    private let maximumSeconds: Int
    private var firstFrame: CMTime?
    private var lastFrame: CMTime?

    init(url: URL, width: Int, height: Int, systemAudio: Bool, microphone: Bool, maximumSeconds: Int) throws {
        self.maximumSeconds = maximumSeconds
        writer = try AVAssetWriter(outputURL: url, fileType: .mp4)
        video = AVAssetWriterInput(mediaType: .video, outputSettings: [
            AVVideoCodecKey: AVVideoCodecType.h264, AVVideoWidthKey: width, AVVideoHeightKey: height,
        ])
        video.expectsMediaDataInRealTime = true
        writer.add(video)
        let assetWriter = writer
        func audio(_ enabled: Bool) -> AVAssetWriterInput? {
            guard enabled else { return nil }
            let input = AVAssetWriterInput(mediaType: .audio, outputSettings: [
                AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: Self.audioRate,
                AVNumberOfChannelsKey: 2, AVEncoderBitRateKey: Self.audioBitRate,
            ])
            input.expectsMediaDataInRealTime = true
            assetWriter.add(input)
            return input
        }
        system = audio(systemAudio)
        self.microphone = audio(microphone)
    }

    func append(_ sample: CMSampleBuffer, input: AVAssetWriterInput) throws {
        guard sample.isValid, CMSampleBufferDataIsReady(sample) else { return }
        let time = CMSampleBufferGetPresentationTimeStamp(sample)
        if firstFrame == nil {
            guard input === video else { return }
            guard writer.startWriting() else { throw ScreenRecordFailure.failed }
            writer.startSession(atSourceTime: time)
            firstFrame = time
        }
        guard let firstFrame, time >= firstFrame, time < firstFrame + CMTime(value: Int64(maximumSeconds), timescale: 1) else { return }
        if input.isReadyForMoreMediaData {
            guard input.append(sample) else { throw ScreenRecordFailure.failed }
            if input === video { lastFrame = time }
        }
    }

    func finish(at stopTime: CMTime = CMClockGetTime(CMClockGetHostTimeClock()), _ completion: @escaping (Bool) -> Void) {
        guard let firstFrame, let lastFrame else { writer.cancelWriting(); completion(false); return }
        // Static desktops may produce only one frame; retain it for the elapsed recording.
        let end = min(firstFrame + CMTime(value: Int64(maximumSeconds), timescale: 1), max(lastFrame + CMTime(value: 1, timescale: Self.framesPerSecond), stopTime))
        writer.endSession(atSourceTime: end)
        video.markAsFinished(); system?.markAsFinished(); microphone?.markAsFinished()
        writer.finishWriting { completion(self.writer.status == .completed) }
    }

    static func synchronized(_ sample: CMSampleBuffer, from clock: CMClock) throws -> CMSampleBuffer {
        // AVCaptureSession.h: audio PTS uses synchronizationClock, not necessarily
        // the host clock used by ScreenCaptureKit. Keep PCM's per-sample duration.
        var timing = CMSampleTimingInfo()
        guard CMSampleBufferGetSampleTimingInfo(sample, at: 0, timingInfoOut: &timing) == noErr else { throw ScreenRecordFailure.failed }
        timing.presentationTimeStamp = CMSyncConvertTime(timing.presentationTimeStamp, from: clock, to: CMClockGetHostTimeClock())
        var converted: CMSampleBuffer?
        guard CMSampleBufferCreateCopyWithNewTiming(allocator: kCFAllocatorDefault, sampleBuffer: sample, sampleTimingEntryCount: 1, sampleTimingArray: &timing, sampleBufferOut: &converted) == noErr, let converted else { throw ScreenRecordFailure.failed }
        return converted
    }

    static func mixSoundtracks(source: URL, output: URL, completion: @escaping (Bool) -> Void) throws {
        let asset = AVURLAsset(url: source)
        let composition = AVMutableComposition()
        let range = CMTimeRange(start: .zero, duration: asset.duration)
        for track in asset.tracks {
            guard let target = composition.addMutableTrack(withMediaType: track.mediaType, preferredTrackID: kCMPersistentTrackID_Invalid) else { throw ScreenRecordFailure.failed }
            try target.insertTimeRange(range, of: track, at: .zero)
        }
        guard let export = AVAssetExportSession(asset: composition, presetName: AVAssetExportPresetHighestQuality) else { throw ScreenRecordFailure.failed }
        let mix = AVMutableAudioMix()
        mix.inputParameters = composition.tracks(withMediaType: .audio).map { track in
            let parameters = AVMutableAudioMixInputParameters(track: track)
            parameters.setVolume(1, at: .zero)
            return parameters
        }
        export.audioMix = mix; export.outputURL = output; export.outputFileType = .mp4
        export.exportAsynchronously { completion(export.status == .completed) }
    }
}

@available(macOS 12.3, *)
final class ScreenKitRecorder: ScreenRecordLifecycle, SCStreamOutput, SCStreamDelegate, AVCaptureAudioDataOutputSampleBufferDelegate {
    private var stream: SCStream?
    private var movie: ScreenMovieWriter?
    private var microphoneSession: AVCaptureSession?

    override func start() {
        SCShareableContent.getExcludingDesktopWindows(false, onScreenWindowsOnly: true) { content, error in
            self.queue.async {
                guard !self.stopping else { self.removeFiles(); ScreenRecord.fail(.cancelled) }
                guard let display = content?.displays.first(where: { $0.displayID == CGMainDisplayID() }) ?? content?.displays.first else {
                    let failure = (error as NSError?)?.code == SCStreamError.Code.userDeclined.rawValue ? ScreenRecordFailure.screenPermissionDenied : .unavailable
                    ScreenRecord.fail(failure)
                }
                do {
                    let configuration = SCStreamConfiguration()
                    configuration.width = display.width; configuration.height = display.height
                    configuration.minimumFrameInterval = CMTime(value: 1, timescale: ScreenMovieWriter.framesPerSecond)
                    if #available(macOS 13.0, *) {
                        configuration.capturesAudio = self.options.systemAudio
                        configuration.sampleRate = ScreenMovieWriter.audioRate; configuration.channelCount = 2
                    }
                    let file = self.options.systemAudio && self.options.microphone ? self.options.output.deletingLastPathComponent().appendingPathComponent("capture.mp4") : self.options.output
                    self.movie = try ScreenMovieWriter(url: file, width: display.width, height: display.height, systemAudio: self.options.systemAudio, microphone: self.options.microphone, maximumSeconds: self.options.seconds)
                    let stream = SCStream(filter: SCContentFilter(display: display, excludingWindows: []), configuration: configuration, delegate: self)
                    self.stream = stream
                    try stream.addStreamOutput(self, type: .screen, sampleHandlerQueue: self.queue)
                    if #available(macOS 13.0, *), self.options.systemAudio { try stream.addStreamOutput(self, type: .audio, sampleHandlerQueue: self.queue) }
                    if self.options.microphone { try self.startMicrophone() }
                    stream.startCapture { error in
                        self.queue.async {
                            if let error { self.removeFiles(); ScreenRecord.fail((error as NSError).code == SCStreamError.Code.userDeclined.rawValue ? .screenPermissionDenied : .failed) }
                            if self.stopping { self.stop(cancel: true) } else { self.began() }
                        }
                    }
                } catch { self.removeFiles(); ScreenRecord.fail(.failed) }
            }
        }
    }

    private func startMicrophone() throws {
        guard let device = AVCaptureDevice.default(for: .audio) else { throw ScreenRecordFailure.unavailable }
        let session = AVCaptureSession()
        let input = try AVCaptureDeviceInput(device: device)
        let output = AVCaptureAudioDataOutput()
        guard session.canAddInput(input), session.canAddOutput(output) else { throw ScreenRecordFailure.unavailable }
        session.addInput(input); session.addOutput(output)
        output.setSampleBufferDelegate(self, queue: queue)
        microphoneSession = session
        session.startRunning()
    }

    func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        guard !stopping, let input = movie?.microphone, let clock = microphoneSession?.synchronizationClock else { return }
        do { append(try ScreenMovieWriter.synchronized(sampleBuffer, from: clock), input: input) }
        catch { removeFiles(); ScreenRecord.fail(.failed) }
    }
    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        if type == .screen {
            // Idle/incomplete frames are not encodable frames.
            guard CMSampleBufferGetImageBuffer(sampleBuffer) != nil, let input = movie?.video else { return }
            append(sampleBuffer, input: input)
        } else if #available(macOS 13.0, *), type == .audio, let input = movie?.system { append(sampleBuffer, input: input) }
    }
    private func append(_ sample: CMSampleBuffer, input: AVAssetWriterInput) {
        guard !stopping else { return }
        do { try movie?.append(sample, input: input) } catch { removeFiles(); ScreenRecord.fail(.failed) }
    }
    func stream(_ stream: SCStream, didStopWithError error: Error) {
        queue.async {
            if ScreenRecord.stoppedByUser(error) && !self.stopping {
                self.stopping = true; self.endBounds(); self.microphoneSession?.stopRunning()
                self.finishMovie()
            } else if !self.stopping {
                self.removeFiles(); ScreenRecord.fail((error as NSError).code == SCStreamError.Code.userDeclined.rawValue ? .screenPermissionDenied : .failed)
            }
        }
    }

    override func stop(cancel: Bool) {
        if cancel { stream?.stopCapture(); microphoneSession?.stopRunning(); movie?.writer.cancelWriting(); removeFiles(); ScreenRecord.fail(.cancelled) }
        guard !stopping else { return }
        stopping = true; endBounds()
        guard started else { return }
        microphoneSession?.stopRunning()
        stream?.stopCapture { error in
            self.queue.async {
                guard error == nil else { self.removeFiles(); ScreenRecord.fail(.failed) }
                self.finishMovie()
            }
        }
    }

    private func finishMovie() {
        guard let movie else { removeFiles(); ScreenRecord.fail(.failed) }
        movie.finish { success in
            guard success else { self.removeFiles(); ScreenRecord.fail(.failed) }
            if self.options.systemAudio && self.options.microphone { self.mixSoundtracks(source: movie.writer.outputURL) }
            else { self.finished() }
        }
    }

    private func mixSoundtracks(source: URL) {
        do {
            try ScreenMovieWriter.mixSoundtracks(source: source, output: options.output) { success in
                guard success else { self.removeFiles(); ScreenRecord.fail(.failed) }
                try? FileManager.default.removeItem(at: source)
                self.finished()
            }
        } catch { removeFiles(); ScreenRecord.fail(.failed) }
    }
}

final class ScreenFallbackRecorder: ScreenRecordLifecycle {
    private var process: Process?
    private let runProcess: (Process) throws -> Void

    init(options: ScreenRecordOptions, runProcess: @escaping (Process) throws -> Void = { try $0.run() }) {
        self.runProcess = runProcess
        super.init(options: options)
    }
    override func start() {
        do {
            let args = try options.fallbackArguments(audioDevice: defaultInputDevice())
            let capture = Process()
            capture.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
            capture.arguments = args
            capture.standardOutput = FileHandle.nullDevice; capture.standardError = FileHandle.nullDevice
            capture.terminationHandler = { child in self.queue.async {
                self.endBounds()
                guard child.terminationStatus == 0 || self.stopping else { self.removeFiles(); ScreenRecord.fail(.failed) }
                self.stopping = true
                self.convert(source: args.last ?? "")
            } }
            process = capture
            try runProcess(capture)
            began()
        } catch let failure as ScreenRecordFailure { ScreenRecord.fail(failure) }
        catch { ScreenRecord.fail(.unavailable) }
    }
    override func stop(cancel: Bool) {
        if cancel { abort(.cancelled) }
        guard !stopping else { return }
        stopping = true; endBounds(); process?.interrupt()
    }
    override func abort(_ code: ScreenRecordFailure) {
        if let process, process.isRunning { kill(process.processIdentifier, SIGKILL); process.waitUntilExit() }
        super.abort(code)
    }
    private func convert(source: String) {
        let converter = Process()
        converter.executableURL = URL(fileURLWithPath: "/usr/bin/avconvert")
        converter.arguments = options.conversionArguments(source: source)
        converter.standardOutput = FileHandle.nullDevice; converter.standardError = FileHandle.nullDevice
        converter.terminationHandler = { child in
            guard child.terminationStatus == 0 else { self.removeFiles(); ScreenRecord.fail(.failed) }
            try? FileManager.default.removeItem(atPath: source)
            self.finished()
        }
        process = converter
        do { try runProcess(converter) } catch { removeFiles(); ScreenRecord.fail(.unavailable) }
    }
}
