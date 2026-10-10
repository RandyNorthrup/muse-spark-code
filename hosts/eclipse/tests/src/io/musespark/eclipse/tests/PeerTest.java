package io.musespark.eclipse.tests;

import static org.junit.Assert.*;
import com.google.gson.*;
import io.musespark.eclipse.*;
import java.io.*;
import java.util.*;
import java.util.concurrent.*;
import org.junit.Test;

public class PeerTest {
    private static class Host implements MhpPeer.Host {
        int calls;
        volatile boolean stopped;
        final List<JsonObject> panels = new ArrayList<>();
        @Override public JsonElement request(String method, JsonObject params, java.util.function.BooleanSupplier cancelled) { calls++; return method.equals("shutdown") ? JsonNull.INSTANCE : Json.object("trusted", false); }
        @Override public void panel(JsonObject frame) { panels.add(frame); }
        @Override public void shutdown() { stopped = true; }
    }
    private static JsonObject initialize() { return Json.object("host", Json.object("id", "eclipse", "version", "4.38"), "protocolRange", Json.object("minimum", "mhp/1.5.0", "maximumExclusive", "mhp/1.6.0"), "capabilities", new String[] {"lifecycle", "workspace", "tab"}, "locale", "en", "theme", Json.object("kind", "dark", "tokens", new JsonObject()), "folders", new JsonArray(), "trusted", false); }
    private static JsonObject initialCall(JsonObject params) { return Json.object("jsonrpc", "2.0", "id", "runtime-init", "method", "initialize", "params", params); }
    private static JsonObject initialResult(String version, JsonElement capabilities) { return Json.object("jsonrpc", "2.0", "id", "eclipse-init", "result", Json.object("protocolVersion", version, "capabilities", capabilities)); }
    private static void negotiate(MhpPeer peer) throws Exception {
        peer.initialize(initialize());
        peer.accept(initialResult("mhp/1.5.0", initialize().get("capabilities")).toString());
        peer.initialized().get(2, TimeUnit.SECONDS);
    }
    @Test public void closeReturnsWhileTheRuntimeDoesNotReadItsPipe() throws Exception {
        ProcessBuilder builder = new ProcessBuilder("python3", "-c", "import time; print('ready', flush=True); time.sleep(100)");
        Map<String, String> clean = Assets.environment(builder.environment()); builder.environment().clear(); builder.environment().putAll(clean);
        Process child = builder.start();
        assertEquals("ready", new BufferedReader(new InputStreamReader(child.getInputStream())).readLine());
        CountDownLatch writing = new CountDownLatch(1);
        OutputStream output = new FilterOutputStream(child.getOutputStream()) {
            @Override public void write(byte[] bytes) throws IOException { writing.countDown(); out.write(bytes); }
        };
        PipedInputStream input = new PipedInputStream(); PipedOutputStream runtime = new PipedOutputStream(input);
        MhpPeer peer = new MhpPeer(new Contract(), input, output, new Host(), code -> { });
        ExecutorService closer = Executors.newSingleThreadExecutor();
        try {
            peer.send(Json.object("body", "x".repeat(1024 * 1024))); peer.start(); assertTrue(writing.await(2, TimeUnit.SECONDS));
            long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(2); boolean blocked = false;
            while (!blocked && System.nanoTime() < deadline) { blocked = Thread.getAllStackTraces().values().stream().flatMap(Arrays::stream).anyMatch(frame -> frame.getClassName().equals("java.io.FileOutputStream") && frame.getMethodName().equals("writeBytes")); Thread.onSpinWait(); }
            assertTrue("the authored child must leave the writer blocked in its pipe", blocked);
            closer.submit(peer::close).get(2, TimeUnit.SECONDS);
            assertTrue("the peer must return before its owner terminates the process", child.isAlive());
        } finally { child.destroyForcibly(); child.waitFor(2, TimeUnit.SECONDS); peer.close(); runtime.close(); closer.shutdownNow(); }
    }
    @Test public void transportFailureAfterInitializationShutsDownItsOwner() throws Exception {
        for (String ending : List.of("{}\n", "")) {
            Host host = new Host(); PipedInputStream input = new PipedInputStream(); PipedOutputStream runtime = new PipedOutputStream(input);
            try (MhpPeer peer = new MhpPeer(new Contract(), input, new ByteArrayOutputStream(), host, code -> { })) {
                negotiate(peer); peer.start(); runtime.write(ending.getBytes(java.nio.charset.StandardCharsets.UTF_8)); runtime.close();
                long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(2);
                while (!host.stopped && System.nanoTime() < deadline) Thread.onSpinWait();
                assertTrue("transport loss must close the owning session", host.stopped);
            } finally { runtime.close(); }
        }
        Host host = new Host(); PipedInputStream input = new PipedInputStream(); PipedOutputStream runtime = new PipedOutputStream(input);
        OutputStream broken = new OutputStream() { @Override public void write(int value) throws IOException { throw new IOException("fake writer failure"); } };
        try (MhpPeer peer = new MhpPeer(new Contract(), input, broken, host, code -> { })) {
            negotiate(peer); peer.start(); long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(2);
            while (!host.stopped && System.nanoTime() < deadline) Thread.onSpinWait(); assertTrue(host.stopped);
        } finally { runtime.close(); }
    }
    @Test public void cancelledAndTimedOutRequestsAcceptValidatedLateReplies() throws Exception {
        Host host = new Host();
        try (MhpPeer peer = new MhpPeer(new Contract(), new ByteArrayInputStream(new byte[0]), new ByteArrayOutputStream(), host, code -> fail(code))) {
            negotiate(peer);
            JsonObject params = Json.object("uri", "file:///x", "version", 1, "position", Json.object("line", 0, "character", 0), "context", Json.object("prefix", "", "suffix", "", "trigger", "invoke"));
            var cancelled = peer.request("tab/complete", params); cancelled.cancel(false);
            peer.accept(Json.object("jsonrpc", "2.0", "id", "eclipse-1", "error", Json.object("code", -32800, "message", "MHP_CANCELLED")).toString());
            var timedOut = peer.request("tab/complete", params); timedOut.completeExceptionally(new TimeoutException());
            assertThrows(IllegalArgumentException.class, () -> peer.accept(Json.object("jsonrpc", "2.0", "id", "eclipse-2", "result", Json.object("unexpected", true)).toString()));
            peer.accept(Json.object("jsonrpc", "2.0", "id", "eclipse-2", "result", new JsonArray()).toString());
            var next = peer.request("tab/complete", params); peer.accept(Json.object("jsonrpc", "2.0", "id", "eclipse-3", "result", new JsonArray()).toString()); assertTrue(next.get().isJsonArray()); assertFalse(host.stopped);
        }
    }
    @Test public void cancelledCorrelationRecordsRemainBounded() throws Exception {
        Contract contract = new Contract(); PipedInputStream input = new PipedInputStream(); PipedOutputStream runtime = new PipedOutputStream(input);
        try (MhpPeer peer = new MhpPeer(contract, input, new ByteArrayOutputStream(), new Host(), code -> { })) {
            negotiate(peer); peer.start();
            JsonObject params = Json.object("uri", "file:///x", "version", 1, "position", Json.object("line", 0, "character", 0), "context", Json.object("prefix", "", "suffix", "", "trigger", "invoke"));
            // Drain the transport independently: outstanding correlation, rather than queued bytes, must stay bounded.
            for (int i = 0; i < contract.queueMessages; i++) { peer.request("tab/complete", params).cancel(false); peer.drain(); }
            assertThrows(IllegalStateException.class, () -> peer.request("tab/complete", params));
            peer.accept(Json.object("jsonrpc", "2.0", "id", "eclipse-1", "result", new JsonArray()).toString());
            assertFalse(peer.request("tab/complete", params).isDone());
        } finally { runtime.close(); }
    }
    @Test public void handshakeCorrelationDirectionAndResultValidation() throws Exception {
        Host host = new Host(); Contract contract = new Contract();
        try (MhpPeer peer = new MhpPeer(contract, new ByteArrayInputStream(new byte[0]), new ByteArrayOutputStream(), host, code -> fail(code))) {
            String frame = Json.object("mhp", "1.5", "kind", "panel", "surface", "s", "direction", "toPanel", "seq", 1, "payload", Json.object("type", "conversationCleared")).toString();
            assertThrows(IllegalStateException.class, () -> peer.accept(frame));
            assertThrows(IllegalStateException.class, () -> peer.request("initialize", initialize()));
            negotiate(peer);
            assertThrows(IllegalArgumentException.class, () -> peer.accept(Json.object("jsonrpc", "2.0", "id", "unknown", "result", JsonNull.INSTANCE).toString()));
            assertThrows(IllegalArgumentException.class, () -> peer.accept(initialCall(initialize()).toString()));
            assertThrows(IllegalStateException.class, () -> peer.initialize(initialize()));
            peer.accept(frame); assertEquals(1, host.panels.size());
            assertThrows(IllegalArgumentException.class, () -> peer.accept(Json.object("jsonrpc", "2.0", "id", "x", "method", "tab/complete", "params", Json.object("uri", "file:///x", "version", 1, "position", Json.object("line", 0, "character", 0), "context", Json.object("prefix", "", "suffix", "", "trigger", "invoke"))).toString()));
            assertEquals(0, host.calls);
        }
    }
    @Test public void unnegotiatedTrafficAndUnsupportedRuntimeGroupsAreRefused() throws Exception {
        try (MhpPeer peer = new MhpPeer(new Contract(), new ByteArrayInputStream(new byte[0]), new ByteArrayOutputStream(), new Host(), code -> fail(code))) {
            peer.initialize(initialize());
            assertThrows(IllegalArgumentException.class, () -> peer.accept(initialResult("mhp/1.5.0", Json.GSON.toJsonTree(new String[] {"lifecycle", "hostMetadata"})).toString()));
            peer.accept(initialResult("mhp/1.5.0", Json.GSON.toJsonTree(new String[] {"lifecycle", "settings", "storage"})).toString());
            assertTrue(peer.initialized().isDone());
            assertThrows(IllegalStateException.class, () -> peer.request("tab/complete", Json.object("uri", "file:///x", "version", 1, "position", Json.object("line", 0, "character", 0), "context", Json.object("prefix", "", "suffix", "", "trigger", "invoke"))));
            assertThrows(IllegalStateException.class, () -> peer.notify("documents/didClose", Json.object("uri", "file:///x")));
        }
    }
    @Test public void correlatedCompletionResultsAreValidatedBeforeResolving() throws Exception {
        try (MhpPeer peer = new MhpPeer(new Contract(), new ByteArrayInputStream(new byte[0]), new ByteArrayOutputStream(), new Host(), code -> fail(code))) {
            negotiate(peer);
            var result = peer.request("tab/complete", Json.object("uri", "file:///x", "version", 1, "position", Json.object("line", 0, "character", 0), "context", Json.object("prefix", "", "suffix", "", "trigger", "invoke")));
            assertThrows(IllegalArgumentException.class, () -> peer.accept(Json.object("jsonrpc", "2.0", "id", "eclipse-1", "result", Json.object("unexpected", true)).toString()));
            assertFalse(result.isDone());
            peer.accept(Json.object("jsonrpc", "2.0", "id", "eclipse-1", "result", new JsonArray()).toString()); assertTrue(result.isDone());
        }
    }
    @Test public void rawLineReadIsBoundedBeforeJsonParsing() throws Exception {
        Contract contract = new Contract(); java.util.concurrent.atomic.AtomicInteger read = new java.util.concurrent.atomic.AtomicInteger(); CountDownLatch rejected = new CountDownLatch(1);
        InputStream oversized = new InputStream() {
            @Override public int read() { return read.incrementAndGet() > contract.frameCap * 2 ? '\n' : 'x'; }
            @Override public int read(byte[] buffer, int offset, int length) { int remaining = contract.frameCap * 2 - read.get(); if (remaining <= 0) { buffer[offset] = '\n'; read.incrementAndGet(); return 1; } int count = Math.min(length, remaining); Arrays.fill(buffer, offset, offset + count, (byte) 'x'); read.addAndGet(count); return count; }
        };
        try (MhpPeer peer = new MhpPeer(contract, oversized, new ByteArrayOutputStream(), new Host(), code -> rejected.countDown())) {
            peer.start(); assertTrue(rejected.await(2, TimeUnit.SECONDS)); assertTrue(read.get() <= contract.frameCap + contract.chunkBytes);
        }
    }
    @Test public void malformedUtf8IsRefusedBeforeDispatch() throws Exception {
        PipedInputStream input = new PipedInputStream(); PipedOutputStream runtime = new PipedOutputStream(input); CountDownLatch rejected = new CountDownLatch(1);
        byte[] body = (initialCall(initialize()).toString() + "\n").getBytes(java.nio.charset.StandardCharsets.UTF_8);
        body[initialCall(initialize()).toString().indexOf("eclipse")] = -1;
        try (MhpPeer peer = new MhpPeer(new Contract(), input, new ByteArrayOutputStream(), new Host(), code -> rejected.countDown())) {
            peer.start(); runtime.write(body); runtime.flush(); assertTrue(rejected.await(2, TimeUnit.SECONDS)); assertThrows(ExecutionException.class, () -> peer.initialized().get(2, TimeUnit.SECONDS));
        } finally { runtime.close(); }
    }
    @Test public void unhandledServiceMethodsKeepTheirTypedCapabilityRefusal() throws Exception {
        Host host = new Host() {
            @Override public JsonElement request(String method, JsonObject params, java.util.function.BooleanSupplier cancelled) { throw new IllegalArgumentException("MHP_CAPABILITY_UNAVAILABLE"); }
        };
        JsonObject offered = Json.object("host", Json.object("id", "eclipse", "version", "4.38"), "protocolRange", Json.object("minimum", "mhp/1.5.0", "maximumExclusive", "mhp/1.6.0"), "capabilities", new String[] {"lifecycle", "ui"}, "locale", "en", "theme", Json.object("kind", "dark", "tokens", new JsonObject()), "folders", new JsonArray(), "trusted", false);
        PipedInputStream input = new PipedInputStream(); PipedOutputStream runtime = new PipedOutputStream(input); ByteArrayOutputStream output = new ByteArrayOutputStream();
        try (MhpPeer peer = new MhpPeer(new Contract(), input, output, host, code -> fail(code))) {
            peer.initialize(offered);
            peer.accept(initialResult("mhp/1.5.0", initialize().get("capabilities")).toString());
            peer.initialized().get(2, TimeUnit.SECONDS);
            peer.start();
            peer.accept(Json.object("jsonrpc", "2.0", "id", "runtime-1", "method", "ui/openFile", "params", Json.object("title", "fixture")).toString());
            long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(2);
            while (!output.toString(java.nio.charset.StandardCharsets.UTF_8).contains("runtime-1") && System.nanoTime() < deadline) Thread.onSpinWait();
            String replies = output.toString(java.nio.charset.StandardCharsets.UTF_8);
            assertTrue(replies, replies.contains("\"code\":-32002") && replies.contains("MHP_CAPABILITY_UNAVAILABLE"));
            assertFalse(replies, replies.contains("MHP_INTERNAL_ERROR"));
            runtime.close();
        } finally { runtime.close(); }
    }
    @Test public void everySchemaErrorKeepsItsNumericCodeAndTechnicalMessageOnTheWire() throws Exception {
        JsonObject schema = Json.resource("/target/assets/mhp.json").getAsJsonObject();
        Map<String, Integer> expected = new LinkedHashMap<>();
        schema.getAsJsonObject("errorCodes").asMap().forEach((name, value) -> expected.put("MHP_" + name.replaceAll("([A-Z])", "_$1").toUpperCase(Locale.ROOT), value.getAsInt()));
        expected.put("MHP_CAPABILITY_UNAVAILABLE", -32002); expected.put("MHP_DIRTY_DOCUMENT", -32004);
        expected.put("MHP_INVALID_RANGE", -32602); expected.put("MHP_OVERLAPPING_EDITS", -32602);
        expected.put("account/path/private failure", -32603);
        List<String> failures = new ArrayList<>();
        for (var error : expected.entrySet()) {
            Host host = new Host() {
                @Override public JsonElement request(String method, JsonObject params, java.util.function.BooleanSupplier cancelled) { throw new IllegalArgumentException(error.getKey()); }
            };
            JsonObject offered = initialize(); offered.add("capabilities", Json.GSON.toJsonTree(new String[] {"lifecycle", "ui"}));
            PipedInputStream input = new PipedInputStream(); PipedOutputStream runtime = new PipedOutputStream(input);
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            try (MhpPeer peer = new MhpPeer(new Contract(), input, output, host, code -> fail(code))) {
                peer.initialize(offered); peer.accept(initialResult("mhp/1.5.0", offered.get("capabilities")).toString()); peer.initialized().get(2, TimeUnit.SECONDS); peer.start();
                peer.accept(Json.object("jsonrpc", "2.0", "id", "typed-error", "method", "ui/openFile", "params", Json.object("title", "fixture")).toString());
                long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(2);
                String reply = "";
                while (!reply.endsWith("\n") || !reply.contains("typed-error")) {
                    assertTrue("missing reply for " + error.getKey(), System.nanoTime() < deadline);
                    reply = output.toString(java.nio.charset.StandardCharsets.UTF_8); Thread.onSpinWait();
                }
                JsonObject failure = JsonParser.parseString(reply.lines().filter(line -> line.contains("typed-error")).findFirst().orElseThrow()).getAsJsonObject().getAsJsonObject("error");
                String message = error.getKey().startsWith("MHP_") ? error.getKey() : "MHP_INTERNAL_ERROR";
                if (error.getValue().intValue() != failure.get("code").getAsInt() || !message.equals(failure.get("message").getAsString())) failures.add(error.getKey() + ": " + failure);
            } finally { runtime.close(); }
        }
        assertTrue(failures.toString(), failures.isEmpty());
    }
    @Test public void legacyNegotiationRefusesCarrier() throws Exception {
        try (MhpPeer peer = new MhpPeer(new Contract(), new ByteArrayInputStream(new byte[0]), new ByteArrayOutputStream(), new Host(), code -> fail(code))) {
            peer.initialize(initialize());
            for (String version : List.of("mhp/1.0.0", "mhp/1.1.0", "mhp/1.2.0", "mhp/2.0.0"))
                assertThrows(IllegalArgumentException.class, () -> peer.accept(initialResult(version, initialize().get("capabilities")).toString()));
            assertFalse(peer.initialized().isDone());
            assertThrows(IllegalStateException.class, () -> peer.notify("workspace/didGrantTrust", Json.object("trusted", true)));
        }
    }
    @Test public void queueCapsPurgeAndOversizedFrameNeverAllocate() throws Exception {
        Contract contract = new Contract();
        try (MhpPeer peer = new MhpPeer(contract, new ByteArrayInputStream(new byte[0]), new ByteArrayOutputStream(), new Host(), code -> fail(code))) {
            JsonObject frame = Json.object("surface", "s");
            for (int i = 0; i < contract.queueMessages; i++) peer.send(frame);
            assertThrows(IllegalStateException.class, () -> peer.send(frame)); assertEquals(contract.queueMessages, peer.purge("s"));
            int reserved = peer.reserveBrowser(frame);
            for (int i = 1; i < contract.queueMessages; i++) peer.send(frame);
            assertThrows(IllegalStateException.class, () -> peer.reserveBrowser(frame));
            assertEquals(contract.queueMessages - 1, peer.purge("s")); peer.releaseBrowser(reserved);
            peer.send(frame); assertEquals(1, peer.purge("s"));
            String body = "x".repeat(contract.frameCap);
            assertThrows(IllegalArgumentException.class, () -> peer.send(Json.object("body", body)));
            assertEquals("MHP_PANEL_TOO_LARGE", assertThrows(IllegalArgumentException.class, () -> peer.accept(body + "x")).getMessage());
            JsonObject large = Json.object("surface", "s", "body", "x".repeat(contract.frameCap - 100));
            peer.send(large); peer.send(large);
            assertThrows(IllegalStateException.class, () -> peer.send(large)); assertEquals(2, peer.purge("s"));
        }
    }
    @Test public void cancellationReachesPendingHostWorkWithoutApplyingIt() throws Exception {
        CountDownLatch started = new CountDownLatch(1); CountDownLatch resume = new CountDownLatch(1); int[] applied = {0};
        Host host = new Host() {
            @Override public JsonElement request(String method, JsonObject params, java.util.function.BooleanSupplier cancelled) {
                if (method.equals("initialize")) return super.request(method, params, cancelled);
                started.countDown(); try { resume.await(2, TimeUnit.SECONDS); } catch (InterruptedException ex) { Thread.currentThread().interrupt(); }
                if (cancelled.getAsBoolean()) throw new IllegalArgumentException("MHP_CANCELLED");
                applied[0]++; return Json.object("trusted", true);
            }
        };
        PipedInputStream input = new PipedInputStream(); PipedOutputStream runtime = new PipedOutputStream(input); ByteArrayOutputStream output = new ByteArrayOutputStream();
        try (MhpPeer peer = new MhpPeer(new Contract(), input, output, host, code -> fail(code))) {
            negotiate(peer); peer.start();
            peer.accept(Json.object("jsonrpc", "2.0", "id", "cancel-me", "method", "workspace/trust", "params", new JsonObject()).toString()); assertTrue(started.await(2, TimeUnit.SECONDS));
            assertThrows(IllegalArgumentException.class, () -> peer.accept(Json.object("jsonrpc", "2.0", "id", "cancel-me", "method", "workspace/trust", "params", new JsonObject()).toString()));
            peer.accept(Json.object("jsonrpc", "2.0", "method", "$/cancelRequest", "params", Json.object("id", "cancel-me")).toString()); resume.countDown(); peer.drain();
            assertEquals(0, applied[0]); assertTrue(output.toString(java.nio.charset.StandardCharsets.UTF_8).contains("MHP_CANCELLED")); runtime.close();
        }
    }
    @Test public void fakeRuntimeMultiplexesFragmentedCrlfServiceAndCarrier() throws Exception {
        Contract contract = new Contract(); Host host = new Host(); PipedInputStream input = new PipedInputStream(); PipedOutputStream runtime = new PipedOutputStream(input); ByteArrayOutputStream output = new ByteArrayOutputStream(); List<String> logs = new ArrayList<>();
        try (MhpPeer peer = new MhpPeer(contract, input, output, host, logs::add)) {
            var initialized = peer.initialize(initialize()); peer.start();
            byte[] response = (initialResult("mhp/1.5.0", initialize().get("capabilities")).toString() + "\r\n").getBytes(java.nio.charset.StandardCharsets.UTF_8);
            runtime.write(response, 0, 2); runtime.flush(); runtime.write(response, 2, response.length - 2); runtime.flush(); initialized.get(2, TimeUnit.SECONDS);
            runtime.write((Json.object("jsonrpc", "2.0", "id", "runtime-1", "method", "workspace/trust", "params", new JsonObject()).toString() + "\n").getBytes(java.nio.charset.StandardCharsets.UTF_8)); runtime.flush();
            long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(2);
            while (!output.toString(java.nio.charset.StandardCharsets.UTF_8).contains("runtime-1") && System.nanoTime() < deadline) Thread.onSpinWait();
            assertTrue(output.toString(java.nio.charset.StandardCharsets.UTF_8).contains("runtime-1")); assertEquals(1, host.calls); assertTrue(logs.isEmpty());
            runtime.close();
            long stopDeadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(2);
            while (!host.stopped && System.nanoTime() < stopDeadline) Thread.onSpinWait();
            assertTrue(host.stopped);
            runtime.close();
        }
    }
    @Test public void numericIdsShareDuplicateAndCancellationIdentity() throws Exception {
        CountDownLatch started = new CountDownLatch(1); CountDownLatch resume = new CountDownLatch(1); java.util.concurrent.atomic.AtomicInteger applied = new java.util.concurrent.atomic.AtomicInteger();
        Host host = new Host() {
            @Override public JsonElement request(String method, JsonObject params, java.util.function.BooleanSupplier cancelled) {
                if (method.equals("initialize")) return super.request(method, params, cancelled);
                started.countDown(); try { resume.await(2, TimeUnit.SECONDS); } catch (InterruptedException ex) { Thread.currentThread().interrupt(); }
                if (cancelled.getAsBoolean()) throw new IllegalArgumentException("MHP_CANCELLED"); applied.incrementAndGet(); return Json.object("trusted", true);
            }
        };
        PipedInputStream input = new PipedInputStream(); PipedOutputStream runtime = new PipedOutputStream(input); ByteArrayOutputStream output = new ByteArrayOutputStream();
        try (MhpPeer peer = new MhpPeer(new Contract(), input, output, host, code -> fail(code))) {
            negotiate(peer); peer.start();
            peer.accept(Json.object("jsonrpc", "2.0", "id", new java.math.BigDecimal("1.0"), "method", "workspace/trust", "params", new JsonObject()).toString()); assertTrue(started.await(2, TimeUnit.SECONDS));
            assertThrows(IllegalArgumentException.class, () -> peer.accept(Json.object("jsonrpc", "2.0", "id", 1, "method", "workspace/trust", "params", new JsonObject()).toString()));
            peer.accept(Json.object("jsonrpc", "2.0", "method", "$/cancelRequest", "params", Json.object("id", 1)).toString()); resume.countDown(); peer.drain();
            assertEquals(0, applied.get()); assertTrue(output.toString(java.nio.charset.StandardCharsets.UTF_8).contains("MHP_CANCELLED"));
        } finally { resume.countDown(); runtime.close(); }
    }
}
