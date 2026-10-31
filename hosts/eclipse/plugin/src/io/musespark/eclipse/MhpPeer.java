package io.musespark.eclipse;

import com.google.gson.*;
import java.io.*;
import java.nio.ByteBuffer;
import java.nio.charset.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.function.Consumer;

/** One bounded writer for the multiplexed pipe. No wire/provider text is logged. */
public final class MhpPeer implements AutoCloseable {
    public interface Host {
        JsonElement request(String method, JsonObject params, java.util.function.BooleanSupplier cancelled) throws Exception;
        void panel(JsonObject frame);
        void shutdown();
    }
    private record Pending(String method, CompletableFuture<JsonElement> result) { }
    private record Write(byte[] bytes, String surface) { }
    private final Contract contract;
    private final Host host;
    private final Consumer<String> log;
    private final OutputStream output;
    private final InputStream input;
    private final Map<String, Pending> pending = new ConcurrentHashMap<>();
    private final ArrayDeque<Write> queue = new ArrayDeque<>();
    private final ExecutorService reader = Executors.newSingleThreadExecutor();
    private final ExecutorService writer = Executors.newSingleThreadExecutor();
    private final ExecutorService dispatch = Executors.newSingleThreadExecutor();
    private final Set<String> runningService = ConcurrentHashMap.newKeySet();
    private final Set<String> cancelled = ConcurrentHashMap.newKeySet();
    private int bytes;
    private int messages;
    private long nextId;
    private volatile boolean initialized;
    private boolean initializing;
    private volatile boolean closed;
    private volatile Set<String> capabilities = Set.of();
    private Set<String> hostCapabilities = Set.of();
    private final CompletableFuture<JsonElement> initialization = new CompletableFuture<>();
    public MhpPeer(Contract contract, InputStream input, OutputStream output, Host host, Consumer<String> log) {
        this.contract = contract; this.input = input; this.output = output; this.host = host; this.log = log;
    }
    public void start() { reader.submit(this::readLoop); writer.submit(this::writeLoop); }
    public CompletableFuture<JsonElement> initialized() { return initialization; }
    public synchronized CompletableFuture<JsonElement> initialize(JsonObject params) {
        if (closed || initializing || initialized) throw new IllegalStateException("MHP_ALREADY_INITIALIZED");
        JsonObject frame = Json.object("jsonrpc", "2.0", "id", "eclipse-init", "method", "initialize", "params", params);
        contract.call(frame);
        Set<String> offered = new HashSet<>();
        params.getAsJsonArray("capabilities").forEach(capability -> offered.add(capability.getAsString()));
        hostCapabilities = Set.copyOf(offered);
        initializing = true;
        pending.put("eclipse-init", new Pending("initialize", initialization));
        try { send(frame); } catch (RuntimeException ex) { close(); throw ex; }
        initialization.orTimeout(100, TimeUnit.SECONDS).whenComplete((value, error) -> { if (error != null) close(); });
        return initialization;
    }
    public CompletableFuture<JsonElement> request(String method, JsonObject params) {
        if (!initialized) throw new IllegalStateException("MHP_NOT_INITIALIZED");
        JsonObject definition = contract.method(method);
        if (!definition.get("direction").getAsString().equals("hostToRuntime")) throw new IllegalArgumentException("MHP_INVALID_DIRECTION");
        if (!capabilities.contains(definition.get("capability").getAsString())) throw new IllegalStateException("MHP_CAPABILITY_UNAVAILABLE");
        String id;
        synchronized (this) { id = "eclipse-" + ++nextId; }
        JsonObject frame = Json.object("jsonrpc", "2.0", "id", id, "method", method, "params", params);
        contract.call(frame);
        CompletableFuture<JsonElement> future = new CompletableFuture<>();
        synchronized (pending) {
            if (pending.size() >= contract.queueMessages) throw new IllegalStateException("MHP_PANEL_BACKPRESSURE");
            pending.put(id, new Pending(method, future));
        }
        try { send(frame); } catch (RuntimeException ex) { pending.remove(id); throw ex; }
        future.orTimeout(100, TimeUnit.SECONDS).whenComplete((value, error) -> {
            if (error != null && pending.containsKey(id) && !closed) notify("$/cancelRequest", Json.object("id", id));
        });
        return future;
    }
    public void notify(String method, JsonObject params) {
        JsonObject frame = Json.object("jsonrpc", "2.0", "method", method, "params", params);
        contract.call(frame);
        if (!initialized) throw new IllegalStateException("MHP_NOT_INITIALIZED");
        JsonObject definition = contract.method(method);
        String direction = definition.get("direction").getAsString();
        if (direction.equals("runtimeToHost")) throw new IllegalArgumentException("MHP_INVALID_DIRECTION");
        if (!hostCapabilities.contains(definition.get("capability").getAsString())) throw new IllegalStateException("MHP_CAPABILITY_UNAVAILABLE");
        send(frame);
    }
    public void send(JsonObject frame) {
        byte[] body = frame.toString().getBytes(StandardCharsets.UTF_8);
        if (body.length > contract.frameCap) throw new IllegalArgumentException("MHP_PANEL_TOO_LARGE");
        synchronized (queue) {
            if (closed) throw new IllegalStateException("MHP_CLOSED");
            if (messages + 1 > contract.queueMessages || bytes + body.length > contract.queueBytes) throw new IllegalStateException("MHP_PANEL_BACKPRESSURE");
            queue.add(new Write(body, frame.has("surface") ? frame.get("surface").getAsString() : null));
            bytes += body.length; messages++; queue.notifyAll();
        }
    }
    public int reserveBrowser(JsonObject frame) {
        int size = frame.toString().getBytes(StandardCharsets.UTF_8).length;
        synchronized (queue) {
            if (closed) throw new IllegalStateException("MHP_CLOSED");
            if (size > contract.frameCap || messages + 1 > contract.queueMessages || bytes + size > contract.queueBytes) throw new IllegalStateException("MHP_PANEL_BACKPRESSURE");
            bytes += size; messages++; return size;
        }
    }
    public void releaseBrowser(int size) { synchronized (queue) { if (!closed) { bytes -= size; messages--; queue.notifyAll(); } } }
    public int purge(String surface) {
        synchronized (queue) {
            int count = 0;
            Iterator<Write> iterator = queue.iterator();
            while (iterator.hasNext()) {
                Write write = iterator.next();
                if (surface.equals(write.surface)) { bytes -= write.bytes.length; messages--; count++; iterator.remove(); }
            }
            return count;
        }
    }
    public void accept(String line) {
        if (line.getBytes(StandardCharsets.UTF_8).length > contract.frameCap) throw new IllegalArgumentException("MHP_PANEL_TOO_LARGE");
        JsonElement value = Json.parse(line);
        if (!value.isJsonObject()) throw new IllegalArgumentException("MHP_INVALID_REQUEST");
        JsonObject frame = value.getAsJsonObject();
        if (frame.has("mhp")) {
            if (!initialized) throw new IllegalStateException("MHP_INCOMPATIBLE_VERSION");
            String kind = frame.get("kind").getAsString();
            if (kind.equals("panelError")) { contract.panel("error", frame); log.accept(frame.get("code").getAsString()); return; }
            if (!kind.equals("panel")) throw new IllegalArgumentException("MHP_INVALID_DIRECTION");
            contract.panel("envelope", frame); host.panel(frame); return;
        }
        if (frame.has("method")) {
            contract.call(frame);
            String method = frame.get("method").getAsString();
            JsonObject definition = contract.method(method);
            if (definition.get("direction").getAsString().equals("hostToRuntime")) throw new IllegalArgumentException("MHP_INVALID_DIRECTION");
            if (!initialized) throw new IllegalStateException("MHP_NOT_INITIALIZED");
            if (method.equals("$/cancelRequest")) { String target = requestKey(frame.getAsJsonObject("params").get("id")); if (runningService.contains(target)) cancelled.add(target); return; }
            if (!hostCapabilities.contains(definition.get("capability").getAsString())) { fail(frame.get("id"), -32002, "MHP_CAPABILITY_UNAVAILABLE"); return; }
            String serviceId = requestKey(frame.get("id"));
            if (!runningService.add(serviceId)) throw new IllegalArgumentException("MHP_DUPLICATE_ID");
            int reserved;
            try { reserved = reserveBrowser(frame); } catch (RuntimeException ex) { runningService.remove(serviceId); throw ex; }
            dispatch.submit(() -> { try { dispatch(frame); } finally { runningService.remove(requestKey(frame.get("id"))); cancelled.remove(requestKey(frame.get("id"))); releaseBrowser(reserved); } }); return;
        }
        if (frame.has("error")) contract.failure(frame);
        if (!frame.has("id")) throw new IllegalArgumentException("MHP_UNCORRELATED_RESULT");
        String id = frame.get("id").getAsString();
        Pending request = pending.get(id);
        if (request == null) throw new IllegalArgumentException("MHP_UNCORRELATED_RESULT");
        if (!frame.has("error")) contract.result(request.method, frame);
        pending.remove(id);
        if (frame.has("error")) { request.result.completeExceptionally(new IOException("MHP_RUNTIME_REQUEST_FAILED")); return; }
        JsonElement result = frame.get("result");
        if (request.method.equals("initialize")) {
            Set<String> supported = new HashSet<>();
            result.getAsJsonObject().getAsJsonArray("capabilities").forEach(capability -> supported.add(capability.getAsString()));
            capabilities = Set.copyOf(supported); initialized = true; initializing = false;
        }
        request.result.complete(result);
    }
    private void dispatch(JsonObject frame) {
        JsonElement id = frame.get("id");
        if (cancelled.remove(requestKey(id))) { fail(id, -32800, "MHP_CANCELLED"); return; }
        try {
            synchronized (queue) {
                if (bytes + contract.frameCap > contract.queueBytes || messages + 1 > contract.queueMessages) { fail(id, -32603, "MHP_INTERNAL_ERROR"); return; }
            }
            JsonElement result = host.request(frame.get("method").getAsString(), frame.getAsJsonObject("params"), () -> cancelled.contains(requestKey(id)));
            JsonObject response = Json.object("jsonrpc", "2.0", "id", id, "result", result);
            contract.result(frame.get("method").getAsString(), response);
            send(response);
        } catch (Exception ex) {
            String message = MhpErrors.technicalCode(ex);
            fail(id, MhpErrors.numeric(message), message);
        } finally { cancelled.remove(requestKey(id)); }
    }
    private static String requestKey(JsonElement id) {
        return id.getAsJsonPrimitive().isNumber() ? "number:" + id.getAsBigDecimal().stripTrailingZeros().toPlainString() : id.toString();
    }
    private void fail(JsonElement id, int code, String message) {
        JsonObject frame = Json.object("jsonrpc", "2.0", "id", id, "error", Json.object("code", code, "message", message));
        contract.failure(frame); send(frame);
    }
    private void readLoop() {
        try {
            ByteArrayOutputStream line = new ByteArrayOutputStream();
            byte[] chunk = new byte[contract.chunkBytes];
            int count;
            while (!closed && (count = input.read(chunk)) != -1) {
                int start = 0;
                for (int i = 0; i < count; i++) if (chunk[i] == '\n') {
                    appendLine(line, chunk, start, i - start);
                    byte[] raw = line.toByteArray(); line.reset();
                    int length = raw.length > 0 && raw[raw.length - 1] == '\r' ? raw.length - 1 : raw.length;
                    String body = StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(raw, 0, length)).toString();
                    accept(body); start = i + 1;
                }
                appendLine(line, chunk, start, count - start);
            }
            if (line.size() != 0) throw new IOException("MHP_TRUNCATED_FRAME");
        } catch (Exception ex) { if (!closed) log.accept("MHP_TRANSPORT_FAILURE"); }
        finally { close(); }
    }
    private void appendLine(ByteArrayOutputStream line, byte[] chunk, int start, int length) throws IOException {
        if (line.size() + length > contract.frameCap + 1) throw new IOException("MHP_PANEL_TOO_LARGE");
        line.write(chunk, start, length);
    }
    private void writeLoop() {
        try {
            while (!closed) {
                Write write;
                synchronized (queue) { while (queue.isEmpty() && !closed) queue.wait(); if (closed) return; write = queue.remove(); }
                output.write(write.bytes); output.write('\n'); output.flush();
                synchronized (queue) { bytes -= write.bytes.length; messages--; queue.notifyAll(); }
            }
        } catch (IOException | InterruptedException ex) { if (!closed) log.accept("MHP_TRANSPORT_FAILURE"); close(); }
    }
    public void drain() {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(2);
        synchronized (queue) {
            try { while (!closed && messages != 0 && System.nanoTime() < deadline) queue.wait(100); }
            catch (InterruptedException ex) { Thread.currentThread().interrupt(); }
        }
    }
    @Override public void close() {
        synchronized (queue) { if (closed) return; closed = true; queue.clear(); bytes = 0; messages = 0; queue.notifyAll(); }
        for (Pending request : pending.values()) request.result.completeExceptionally(new IOException("MHP_CLOSED"));
        pending.clear(); reader.shutdownNow(); writer.shutdownNow(); dispatch.shutdownNow();
        host.shutdown();
        initialization.completeExceptionally(new IOException("MHP_CLOSED"));
        // Process pipe close may wait for a blocked writer; the owning session terminates its process.
        Thread.startVirtualThread(() -> {
            try { input.close(); } catch (IOException ex) { log.accept("MHP_CLOSE_FAILURE"); }
            try { output.close(); } catch (IOException ex) { log.accept("MHP_CLOSE_FAILURE"); }
        });
    }
}
