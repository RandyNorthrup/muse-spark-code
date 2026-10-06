// Synthetic, permission-free tests of the production encoder and guards.
import AVFoundation
import Foundation
import ScreenCaptureKit

setbuf(stdout, nil)

func defaultInputDevice() -> UInt32 { 0 } // Only the unused fallback start needs this symbol.

func check(_ condition: @autoclosure () -> Bool, _ name: String) {
    guard condition() else { fputs("FAIL: \(name)\n", stderr); exit(1) }
    print("PASS: \(name)")
}
func refuses(_ name: String, code: ScreenRecordFailure, _ operation: () throws -> Void) {
    do { try operation(); check(false, name) }
    catch let error as ScreenRecordFailure { check(error == code, name) }
    catch { check(false, name) }
}

let folder = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
let output = folder.appendingPathComponent("recording.mp4")
let base = ["--output", output.path, "--max-seconds", "10", "--max-bytes", "209715200", "--microphone", "false", "--system-audio", "false"]

// Test-only processes replace capture, never requesting screen/microphone access.
if CommandLine.arguments.contains("--fallback-finalize") {
    try Data([0, 0]).write(to: output)
    var recorder: ScreenFallbackRecorder?
    recorder = ScreenFallbackRecorder(options: try ScreenRecordOptions(arguments: base), runProcess: { process in
        if process.arguments?.contains("-v") != true {
            check(recorder?.stopping == true, "fallback completion protects conversion from late Stop")
            recorder?.stop(cancel: false)
        }
        process.executableURL = URL(fileURLWithPath: "/usr/bin/true")
        process.arguments = []
        try process.run()
    })
    recorder?.start()
    withExtendedLifetime(recorder) { dispatchMain() }
}

if CommandLine.arguments.contains("--final-size") || CommandLine.arguments.contains("--final-empty") {
    var arguments = base; arguments[5] = "1"
    try Data(CommandLine.arguments.contains("--final-size") ? [0, 0] : []).write(to: output)
    ScreenRecordLifecycle(options: try ScreenRecordOptions(arguments: arguments)).finished()
}

final class TestLifecycle: ScreenRecordLifecycle {
    override func stop(cancel: Bool) {
        check(!cancel, "native maximum stops without discarding")
        exit(0)
    }
    override func abort(_ code: ScreenRecordFailure) {
        check(code == .tooLarge, "native size cap stops the encoder")
        exit(0)
    }
}
if CommandLine.arguments.contains("--deadline") || CommandLine.arguments.contains("--size") {
    var arguments = base
    let sizeTest = CommandLine.arguments.contains("--size")
    if sizeTest { arguments[5] = "1"; try Data([0, 0]).write(to: output) }
    var clock = Date(timeIntervalSince1970: 0)
    let lifecycle = TestLifecycle(options: try ScreenRecordOptions(arguments: arguments), now: {
        let result = clock
        if !sizeTest { clock = clock.addingTimeInterval(11) }
        return result
    })
    // A test-only clock expires the actual native timer without a ten-second wait.
    lifecycle.began()
    DispatchQueue.global().asyncAfter(deadline: .now() + 2) { check(false, sizeTest ? "native size cap stops the encoder" : "native maximum stops without discarding") }
    withExtendedLifetime(lifecycle) { dispatchMain() }
}
func options(replacing flag: String, with value: String) throws -> ScreenRecordOptions {
    var arguments = base
    guard let index = arguments.firstIndex(of: flag) else { fatalError("missing test flag") }
    arguments[index + 1] = value
    return try ScreenRecordOptions(arguments: arguments)
}

for value in ["0", "9", "601", "10.5"] {
    refuses("duration \(value) is refused", code: .invalidOptions) { _ = try options(replacing: "--max-seconds", with: value) }
}
for value in ["0", "-1", "209715201"] {
    refuses("byte cap \(value) is refused", code: .invalidOptions) { _ = try options(replacing: "--max-bytes", with: value) }
}
for flag in ["--microphone", "--system-audio"] {
    refuses("explicit boolean \(flag)", code: .invalidOptions) { _ = try options(replacing: flag, with: "yes") }
}
refuses("relative output is refused", code: .invalidOptions) { _ = try options(replacing: "--output", with: "relative.mp4") }
refuses("missing flag is refused", code: .invalidOptions) { _ = try ScreenRecordOptions(arguments: Array(base.dropLast(2))) }
refuses("extra flag is refused", code: .invalidOptions) { _ = try ScreenRecordOptions(arguments: base + ["--unknown", "false"]) }
var duplicate = base; duplicate[duplicate.count - 2] = "--microphone"
refuses("duplicate flag is refused", code: .invalidOptions) { _ = try ScreenRecordOptions(arguments: duplicate) }
var unknown = base; unknown[unknown.count - 2] = "--unknown"
refuses("unknown flag is refused", code: .invalidOptions) { _ = try ScreenRecordOptions(arguments: unknown) }
let valid = try ScreenRecordOptions(arguments: base)
try valid.validateOutput()
check(!valid.microphone && !valid.systemAudio, "sound is off for the explicit default choices")
var foreign = stat(); foreign.st_mode = mode_t(S_IFDIR) | 0o700; foreign.st_uid = getuid() + 1
check(!ScreenRecordOptions.isPrivateDirectory(foreign, owner: getuid()), "foreign-owned output directory is refused")
foreign.st_uid = getuid(); foreign.st_mode = mode_t(S_IFREG) | 0o700
check(!ScreenRecordOptions.isPrivateDirectory(foreign, owner: getuid()), "regular-file output directory is refused")
chmod(folder.path, 0o755)
refuses("public output directory is refused", code: .invalidOptions) { try valid.validateOutput() }
chmod(folder.path, 0o700)
try FileManager.default.createSymbolicLink(at: output, withDestinationURL: folder.appendingPathComponent("missing.mp4"))
refuses("dangling output symlink is refused", code: .invalidOptions) { try valid.validateOutput() }
try FileManager.default.removeItem(at: output)
let alias = folder.appendingPathComponent("alias")
try FileManager.default.createSymbolicLink(at: alias, withDestinationURL: folder)
refuses("symlink output directory is refused", code: .invalidOptions) {
    try options(replacing: "--output", with: alias.appendingPathComponent("recording.mp4").path).validateOutput()
}
try FileManager.default.removeItem(at: alias)
refuses("non-mp4 output is refused", code: .invalidOptions) {
    try options(replacing: "--output", with: folder.appendingPathComponent("recording.mov").path).validateOutput()
}
check(ScreenRecord.permissionFailure(microphoneRequested: false, requestScreen: { false }, requestMicrophone: { true }) == .screenPermissionDenied, "screen denial has its recovery code")
check(ScreenRecord.permissionFailure(microphoneRequested: true, requestScreen: { true }, requestMicrophone: { false }) == .microphonePermissionDenied, "microphone denial has its recovery code")
var microphoneRequests = 0
check(ScreenRecord.permissionFailure(microphoneRequested: false, requestScreen: { true }, requestMicrophone: { microphoneRequests += 1; return false }) == nil && microphoneRequests == 0, "unselected microphone needs no permission")
check(ScreenRecord.permissionFailure(microphoneRequested: true, requestScreen: { false }, requestMicrophone: { microphoneRequests += 1; return false }) == .screenPermissionDenied && microphoneRequests == 0, "screen denial never asks for the microphone")
if #available(macOS 12.3, *) {
    check(ScreenRecord.stoppedByUser(NSError(domain: SCStreamErrorDomain, code: SCStreamError.Code.userStopped.rawValue)), "OS indicator Stop is a successful stop")
    check(!ScreenRecord.stoppedByUser(NSError(domain: "foreign", code: SCStreamError.Code.userStopped.rawValue)), "foreign errors do not become OS indicator Stop")
    check(!ScreenRecord.stoppedByUser(NSError(domain: SCStreamErrorDomain, code: SCStreamError.Code.userDeclined.rawValue)), "permission denial is not OS indicator Stop")
}
let silentFallback = try valid.fallbackArguments(audioDevice: 0)
check(silentFallback == ["-v", "-V", "10", "-D", "1", folder.appendingPathComponent("capture.mov").path], "silent fallback is bounded with no audio argument")
let micOptions = try options(replacing: "--microphone", with: "true")
let micFallback = try micOptions.fallbackArguments(audioDevice: 42)
check(micFallback.suffix(3).dropLast() == ["-G", "42"], "fallback microphone uses the explicit input device")
refuses("missing fallback microphone is refused", code: .unavailable) { _ = try micOptions.fallbackArguments(audioDevice: 0) }
refuses("fallback system audio is refused", code: .unsupportedAudio) { _ = try options(replacing: "--system-audio", with: "true").fallbackArguments(audioDevice: 42) }

func videoSample(at time: CMTime) throws -> CMSampleBuffer {
    var pixel: CVPixelBuffer?
    check(CVPixelBufferCreate(kCFAllocatorDefault, 32, 32, kCVPixelFormatType_32BGRA, nil, &pixel) == kCVReturnSuccess, "allocate synthetic pixels")
    guard let pixel else { throw ScreenRecordFailure.failed }
    CVPixelBufferLockBaseAddress(pixel, [])
    if let address = CVPixelBufferGetBaseAddress(pixel) { memset(address, 100, CVPixelBufferGetDataSize(pixel)) }
    CVPixelBufferUnlockBaseAddress(pixel, [])
    var format: CMVideoFormatDescription?
    CMVideoFormatDescriptionCreateForImageBuffer(allocator: kCFAllocatorDefault, imageBuffer: pixel, formatDescriptionOut: &format)
    guard let format else { throw ScreenRecordFailure.failed }
    var timing = CMSampleTimingInfo(duration: CMTime(value: 1, timescale: 30), presentationTimeStamp: time, decodeTimeStamp: .invalid)
    var sample: CMSampleBuffer?
    CMSampleBufferCreateReadyWithImageBuffer(allocator: kCFAllocatorDefault, imageBuffer: pixel, formatDescription: format, sampleTiming: &timing, sampleBufferOut: &sample)
    guard let sample else { throw ScreenRecordFailure.failed }
    return sample
}

func audioSample(at time: CMTime, frequency: Double, phaseOffset: Double = 0) throws -> CMSampleBuffer {
    let frames = 1600
    var samples: [Float] = []
    for index in 0..<frames {
        let amplitude = Float(sin((phaseOffset + Double(index) / 48_000) * frequency * 2 * .pi)) / 4
        samples += [amplitude, amplitude]
    }
    let bytes = samples.withUnsafeBytes { Data($0) }
    var block: CMBlockBuffer?
    CMBlockBufferCreateWithMemoryBlock(allocator: kCFAllocatorDefault, memoryBlock: nil, blockLength: bytes.count, blockAllocator: kCFAllocatorDefault, customBlockSource: nil, offsetToData: 0, dataLength: bytes.count, flags: 0, blockBufferOut: &block)
    guard let block else { throw ScreenRecordFailure.failed }
    bytes.withUnsafeBytes { pointer in
        if let address = pointer.baseAddress { CMBlockBufferReplaceDataBytes(with: address, blockBuffer: block, offsetIntoDestination: 0, dataLength: bytes.count) }
    }
    var description = AudioStreamBasicDescription(mSampleRate: 48_000, mFormatID: kAudioFormatLinearPCM, mFormatFlags: kAudioFormatFlagIsFloat | kAudioFormatFlagIsPacked, mBytesPerPacket: 8, mFramesPerPacket: 1, mBytesPerFrame: 8, mChannelsPerFrame: 2, mBitsPerChannel: 32, mReserved: 0)
    var format: CMAudioFormatDescription?
    CMAudioFormatDescriptionCreate(allocator: kCFAllocatorDefault, asbd: &description, layoutSize: 0, layout: nil, magicCookieSize: 0, magicCookie: nil, extensions: nil, formatDescriptionOut: &format)
    guard let format else { throw ScreenRecordFailure.failed }
    var sample: CMSampleBuffer?
    CMAudioSampleBufferCreateReadyWithPacketDescriptions(allocator: kCFAllocatorDefault, dataBuffer: block, formatDescription: format, sampleCount: frames, presentationTimeStamp: time, packetDescriptions: nil, sampleBufferOut: &sample)
    guard let sample else { throw ScreenRecordFailure.failed }
    return sample
}

func firstDataSample(_ output: AVAssetReaderTrackOutput) -> CMSampleBuffer? {
    // AVAssetReaderOutput.h: nil output settings may emit zero-sample markers.
    while let sample = output.copyNextSampleBuffer() {
        if CMSampleBufferGetNumSamples(sample) > 0 { return sample }
    }
    return nil
}

func codec(_ asset: AVAsset, track: AVAssetTrack) throws -> FourCharCode {
    let reader = try AVAssetReader(asset: asset)
    let decoded = AVAssetReaderTrackOutput(track: track, outputSettings: nil)
    reader.add(decoded)
    guard reader.startReading(), let sample = firstDataSample(decoded), let format = CMSampleBufferGetFormatDescription(sample) else { throw ScreenRecordFailure.failed }
    return CMFormatDescriptionGetMediaSubType(format)
}

func encode(system: Bool, microphone: Bool, name: String) throws -> URL {
    let url = folder.appendingPathComponent(name)
    let movie = try ScreenMovieWriter(url: url, width: 32, height: 32, systemAudio: system, microphone: microphone, maximumSeconds: 10)
    let start = CMClockGetTime(CMClockGetHostTimeClock())
    for index in 0..<6 {
        let time = start + CMTime(value: Int64(index), timescale: 30)
        do {
            try movie.append(videoSample(at: time), input: movie.video)
            if let input = movie.system { try movie.append(audioSample(at: time, frequency: 440, phaseOffset: Double(index) / 30), input: input) }
            if let input = movie.microphone { try movie.append(audioSample(at: time, frequency: 880, phaseOffset: Double(index) / 30), input: input) }
        } catch {
            fputs("FAIL: append \(name): \(String(describing: movie.writer.error))\n", stderr)
            throw error
        }
        Thread.sleep(forTimeInterval: 1.0 / 30)
    }
    let finished = DispatchSemaphore(value: 0)
    var success = false
    movie.finish(at: start + CMTime(value: 6, timescale: 30)) { value in success = value; finished.signal() }
    check(finished.wait(timeout: .now() + 5) == .success && success, "writer finalizes \(name)")
    let asset = AVURLAsset(url: url)
    check(asset.tracks(withMediaType: .video).count == 1, "one video track in \(name)")
    check(asset.tracks(withMediaType: .audio).count == (system ? 1 : 0) + (microphone ? 1 : 0), "only selected sound tracks in \(name)")
    check(asset.duration.seconds > 0 && asset.duration.seconds < 1, "bounded nonempty duration in \(name)")
    guard let track = asset.tracks(withMediaType: .video).first else { throw ScreenRecordFailure.failed }
    let reader = try AVAssetReader(asset: asset)
    let decoded = AVAssetReaderTrackOutput(track: track, outputSettings: nil)
    reader.add(decoded)
    check(reader.startReading(), "recorded video is readable in \(name)")
    guard let sample = firstDataSample(decoded), let format = CMSampleBufferGetFormatDescription(sample) else {
        fputs("FAIL: read \(name): status \(reader.status.rawValue), error \(String(describing: reader.error)), track range \(track.timeRange)\n", stderr)
        throw ScreenRecordFailure.failed
    }
    check(CMFormatDescriptionGetMediaSubType(format) == kCMVideoCodecType_H264, "H264 video in \(name)")
    for track in asset.tracks(withMediaType: .audio) {
        let format = try codec(asset, track: track)
        check(format == kAudioFormatMPEG4AAC, "AAC sound in \(name)")
    }
    let bytes = try Data(contentsOf: url)
    check(String(data: bytes.subdata(in: 4..<8), encoding: .ascii) == "ftyp", "sniffable ISO-BMFF in \(name)")
    check(String(data: bytes.subdata(in: 8..<12), encoding: .ascii) != "qt  ", "mp4 rather than QuickTime brand in \(name)")
    return url
}
_ = try encode(system: false, microphone: false, name: "silent.mp4")
_ = try encode(system: true, microphone: false, name: "system.mp4")
_ = try encode(system: false, microphone: true, name: "microphone.mp4")
let source = try encode(system: true, microphone: true, name: "both.mp4")
let mixed = folder.appendingPathComponent("mixed.mp4")
let exported = DispatchSemaphore(value: 0)
var success = false
try ScreenMovieWriter.mixSoundtracks(source: source, output: mixed) { value in success = value; exported.signal() }
check(exported.wait(timeout: .now() + 5) == .success && success, "mix finalizes both sound sources")
check(AVURLAsset(url: mixed).tracks(withMediaType: .audio).count == 1, "both sound sources are mixed into one playable AAC track")
let mixedAsset = AVURLAsset(url: mixed)
guard let mixedTrack = mixedAsset.tracks(withMediaType: .audio).first else { throw ScreenRecordFailure.failed }
let mixedCodec = try codec(mixedAsset, track: mixedTrack)
check(mixedCodec == kAudioFormatMPEG4AAC, "mixed sound is AAC")
let audioReader = try AVAssetReader(asset: mixedAsset)
let audioOutput = AVAssetReaderTrackOutput(track: mixedTrack, outputSettings: [AVFormatIDKey: kAudioFormatLinearPCM, AVLinearPCMIsFloatKey: true, AVLinearPCMBitDepthKey: 32, AVLinearPCMIsNonInterleaved: false, AVNumberOfChannelsKey: 2, AVSampleRateKey: 48_000])
audioReader.add(audioOutput)
check(audioReader.startReading(), "mixed audio is decodable")
var left: [Float] = []
while let sample = audioOutput.copyNextSampleBuffer() {
    guard let block = CMSampleBufferGetDataBuffer(sample) else { continue }
    var pcm = [Float](repeating: 0, count: CMBlockBufferGetDataLength(block) / MemoryLayout<Float>.size)
    pcm.withUnsafeMutableBytes { bytes in
        if let base = bytes.baseAddress { CMBlockBufferCopyDataBytes(block, atOffset: 0, dataLength: bytes.count, destination: base) }
    }
    left += stride(from: 0, to: pcm.count, by: 2).map { pcm[$0] }
}
func energy(_ frequency: Double) -> Double {
    var sine = 0.0; var cosine = 0.0
    for (index, value) in left.enumerated() {
        let phase = Double(index) * frequency * 2 * .pi / 48_000
        sine += Double(value) * sin(phase); cosine += Double(value) * cos(phase)
    }
    return sqrt(sine * sine + cosine * cosine) / Double(max(1, left.count))
}
check(energy(440) > 0.005, "system sound survives mixing")
check(energy(880) > 0.005, "microphone sound survives mixing")
let conversion = Process()
conversion.executableURL = URL(fileURLWithPath: "/usr/bin/avconvert")
let converted = folder.appendingPathComponent("converted.mp4")
let conversionOptions = try options(replacing: "--output", with: converted.path)
conversion.arguments = conversionOptions.conversionArguments(source: source.path)
conversion.standardOutput = FileHandle.nullDevice; conversion.standardError = FileHandle.nullDevice
try conversion.run(); conversion.waitUntilExit()
check(conversion.terminationStatus == 0, "fallback avconvert succeeds natively with a synthetic recording")
check(AVURLAsset(url: converted).tracks(withMediaType: .video).count == 1, "fallback conversion contains playable video")
let empty = try ScreenMovieWriter(url: folder.appendingPathComponent("empty.mp4"), width: 32, height: 32, systemAudio: false, microphone: false, maximumSeconds: 10)
var emptySuccess = true
empty.finish { emptySuccess = $0 }
check(!emptySuccess, "an empty encoder refuses success")
let originalAudio = try audioSample(at: CMClockGetTime(CMClockGetHostTimeClock()), frequency: 440)
let synced = try ScreenMovieWriter.synchronized(originalAudio, from: CMClockGetHostTimeClock())
let clockDifference = abs((CMSampleBufferGetPresentationTimeStamp(synced) - CMSampleBufferGetPresentationTimeStamp(originalAudio)).seconds)
check(clockDifference < 1.0 / 48_000, "microphone clock converts to the host timebase")
var originalTiming = CMSampleTimingInfo(); var syncedTiming = CMSampleTimingInfo()
CMSampleBufferGetSampleTimingInfo(originalAudio, at: 0, timingInfoOut: &originalTiming)
CMSampleBufferGetSampleTimingInfo(synced, at: 0, timingInfoOut: &syncedTiming)
check(originalTiming.duration == syncedTiming.duration && CMSampleBufferGetNumSamples(synced) == CMSampleBufferGetNumSamples(originalAudio), "microphone retiming preserves per-sample timing")
let cappedURL = folder.appendingPathComponent("capped.mp4")
let capped = try ScreenMovieWriter(url: cappedURL, width: 32, height: 32, systemAudio: false, microphone: false, maximumSeconds: 1)
let capStart = CMClockGetTime(CMClockGetHostTimeClock())
try capped.append(videoSample(at: capStart), input: capped.video)
Thread.sleep(forTimeInterval: 0.1)
let capDone = DispatchSemaphore(value: 0)
capped.finish(at: capStart + CMTime(value: 2, timescale: 1)) { value in success = value; capDone.signal() }
check(capDone.wait(timeout: .now() + 5) == .success && success, "static screen finalizes")
check(AVURLAsset(url: cappedURL).duration.seconds > 0 && AVURLAsset(url: cappedURL).duration.seconds <= 1, "static screen duration is capped at the maximum")
print("All native screen-record tests passed without requesting privacy permissions.")
