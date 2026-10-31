/*
 * muse-portal-record: the Linux screen recorder's native half (M105 R3,
 * RLF-RECORDING). libc only: no libdbus, no glib, no GStreamer headers.
 *
 * Why native: the ScreenCast portal hands its PipeWire descriptor over
 * D-Bus as a passed file descriptor (SCM_RIGHTS), which Node cannot
 * receive, and the consent picker belongs to the desktop session. This
 * helper speaks the session bus itself, runs the portal flow, spawns the
 * trusted gst-launch-1.0 the host bound at start, and supervises it.
 *
 * Sources: the D-Bus specification (message format, EXTERNAL auth, unix fd
 * passing; dbus.freedesktop.org/doc/dbus-specification.html) and the
 * xdg-desktop-portal ScreenCast/Request/Session API
 * (flatpak.github.io/xdg-desktop-portal/docs/doc-org.freedesktop.portal.ScreenCast.html):
 * CreateSession, SelectSources (once), Start, OpenPipeWireRemote, the
 * Request Response signal, and Session Close/Closed. Audio comes from the
 * default PipeWire daemon, not the portal: the portal governs no
 * microphone, so audio elements connect themselves and only video takes
 * the portal descriptor.
 *
 * Modes:
 *   --self-test   prints the ready line and exits 0; touches nothing.
 *   --probe       connects to the session bus and checks that the portal
 *                 answers with a ScreenCast interface. Creates no session,
 *                 shows no picker, asks for nothing.
 *   --portal --encoder <absolute gst-launch-1.0> --max-bytes <n>
 *     --max-seconds <n>
 *                 runs the portal flow (the desktop shows its picker),
 *                 prints the video source, then waits for the launch line
 *                 on stdin and supervises the encoder.
 *
 * Protocol, JSON lines on stdout (stderr is diagnostics, drained):
 *   {"type":"sources","fd":N,"nodeId":M}
 *   {"type":"complete"}                          exit 0
 *   {"type":"error","code":"permission|unavailable|failed|cancelled|revoked"}
 *                                                exit 1
 *   {"type":"closed"}                            portal revoked the session
 * Stdin, one line each (EOF cancels):
 *   {"launch":{"command":C,"args":[...],"output":O}}
 *   {"stop":true}                                EOS, then the encoder exits
 *   {"cancel":true}                              end the encoder at once
 *
 * D121: nothing here stops on a clock of ours. The picker waits until the
 * person answers it; stop waits for the encoder's own exit; only the
 * person's cancel (or the portal's revocation, or the parent's death)
 * ends the encoder at once. The 100 ms supervision tick is engineering
 * granularity for the size and lifetime the launch line carries, not a
 * stop: reaching either asks the encoder to finish (SIGINT under -e),
 * exactly like the person's stop.
 */
#define _GNU_SOURCE
#define _POSIX_C_SOURCE 200809L

#include <ctype.h>
#include <errno.h>
#include <fcntl.h>
#include <poll.h>
#include <signal.h>
#include <stdarg.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/prctl.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <sys/un.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

/* Protocol bounds (framing, never a person's value). */
#define LINE_MAX_BYTES 65536u
#define ARGS_MAX 512u
#define ARG_MAX_BYTES 16384u
#define MESSAGE_MAX_BYTES (4u * 1024u * 1024u)
#define AUTH_LINE_MAX_BYTES 16384u
#define TOKEN_MAX_BYTES 128u

#define PORTAL_BUS_NAME "org.freedesktop.portal.Desktop"
#define PORTAL_OBJECT_PATH "/org/freedesktop/portal/desktop"
#define PORTAL_SCREENCAST_IFACE "org.freedesktop.portal.ScreenCast"
#define PORTAL_REQUEST_IFACE "org.freedesktop.portal.Request"
#define PORTAL_SESSION_IFACE "org.freedesktop.portal.Session"
#define DBUS_BUS_NAME "org.freedesktop.DBus"
#define DBUS_OBJECT_PATH "/org/freedesktop/DBus"
#define DBUS_IFACE "org.freedesktop.DBus"
#define DBUS_PROPERTIES_IFACE "org.freedesktop.DBus.Properties"

#define CAPTURE_MONITOR 1u
#define CURSOR_EMBEDDED 2u

static const char *program_name = "muse-portal-record";

/* ------------------------------------------------------------------ */
/* Small utilities                                                      */
/* ------------------------------------------------------------------ */

static void diag(const char *format, ...) {
  va_list args;
  va_start(args, format);
  (void)fprintf(stderr, "%s: ", program_name);
  (void)vfprintf(stderr, format, args);
  (void)fprintf(stderr, "\n");
  va_end(args);
}

static void *checked_malloc(size_t size) {
  void *pointer = malloc(size == 0 ? 1 : size);
  if (pointer == NULL) {
    diag("out of memory");
    exit(1);
  }
  return pointer;
}

static void *checked_realloc(void *pointer, size_t size) {
  void *next = realloc(pointer, size == 0 ? 1 : size);
  if (next == NULL) {
    diag("out of memory");
    exit(1);
  }
  return next;
}

static char *checked_strdup(const char *text) {
  char *copy = strdup(text);
  if (copy == NULL) {
    diag("out of memory");
    exit(1);
  }
  return copy;
}

static int write_all(int fd, const void *data, size_t length) {
  const char *cursor = (const char *)data;
  while (length > 0) {
    ssize_t done = write(fd, cursor, length);
    if (done < 0) {
      if (errno == EINTR) continue;
      return -1;
    }
    if (done == 0) return -1;
    cursor += (size_t)done;
    length -= (size_t)done;
  }
  return 0;
}

/* ------------------------------------------------------------------ */
/* Growing byte buffer                                                  */
/* ------------------------------------------------------------------ */

typedef struct {
  char *data;
  size_t length;
  size_t capacity;
} ByteBuffer;

static void buffer_init(ByteBuffer *buffer) {
  buffer->data = NULL;
  buffer->length = 0;
  buffer->capacity = 0;
}

static void buffer_free(ByteBuffer *buffer) {
  free(buffer->data);
  buffer->data = NULL;
  buffer->length = 0;
  buffer->capacity = 0;
}

static void buffer_reserve(ByteBuffer *buffer, size_t extra) {
  if (buffer->length + extra <= buffer->capacity) return;
  size_t capacity = buffer->capacity == 0 ? 256 : buffer->capacity;
  while (capacity < buffer->length + extra) capacity *= 2;
  buffer->data = (char *)checked_realloc(buffer->data, capacity);
  buffer->capacity = capacity;
}

static void buffer_put(ByteBuffer *buffer, const void *data, size_t length) {
  buffer_reserve(buffer, length);
  memcpy(buffer->data + buffer->length, data, length);
  buffer->length += length;
}

static void buffer_put_byte(ByteBuffer *buffer, unsigned char value) {
  buffer_reserve(buffer, 1);
  buffer->data[buffer->length++] = (char)value;
}

static void buffer_align(ByteBuffer *buffer, size_t alignment) {
  size_t padding = (alignment - (buffer->length % alignment)) % alignment;
  for (size_t i = 0; i < padding; i++) buffer_put_byte(buffer, 0);
}

static void buffer_put_u32(ByteBuffer *buffer, uint32_t value) {
  buffer_align(buffer, 4);
  unsigned char bytes[4];
  bytes[0] = (unsigned char)(value & 0xffu);
  bytes[1] = (unsigned char)((value >> 8) & 0xffu);
  bytes[2] = (unsigned char)((value >> 16) & 0xffu);
  bytes[3] = (unsigned char)((value >> 24) & 0xffu);
  buffer_put(buffer, bytes, sizeof(bytes));
}

static void buffer_put_string(ByteBuffer *buffer, const char *text) {
  uint32_t length = (uint32_t)strlen(text);
  buffer_put_u32(buffer, length);
  buffer_put(buffer, text, length);
  buffer_put_byte(buffer, 0);
}

/* D-Bus object path: same wire shape as a string. */
static void buffer_put_path(ByteBuffer *buffer, const char *text) {
  buffer_put_string(buffer, text);
}

static void buffer_put_signature(ByteBuffer *buffer, const char *text) {
  size_t length = strlen(text);
  buffer_put_byte(buffer, (unsigned char)length);
  buffer_put(buffer, text, length);
  buffer_put_byte(buffer, 0);
}

/* A variant: the signature, then the value aligned to its own type. */
static void buffer_put_variant_string(ByteBuffer *buffer, const char *text) {
  buffer_put_signature(buffer, "s");
  buffer_put_string(buffer, text);
}

static void buffer_put_variant_u32(ByteBuffer *buffer, uint32_t value) {
  buffer_put_signature(buffer, "u");
  buffer_put_u32(buffer, value);
}

static void buffer_put_variant_bool(ByteBuffer *buffer, int value) {
  buffer_put_signature(buffer, "b");
  buffer_put_u32(buffer, value ? 1u : 0u);
}

/* One {string, variant} dict entry inside an a{sv} array. */
static void buffer_put_dict_entry(ByteBuffer *buffer, const char *key) {
  buffer_align(buffer, 8);
  buffer_put_string(buffer, key);
}

/* ------------------------------------------------------------------ */
/* D-Bus message reader                                                 */
/* ------------------------------------------------------------------ */

typedef struct {
  const unsigned char *data;
  size_t length;
  size_t offset;
  int failed;
} Cursor;

static void cursor_align(Cursor *cursor, size_t alignment) {
  size_t padding = (alignment - (cursor->offset % alignment)) % alignment;
  cursor->offset += padding;
  if (cursor->offset > cursor->length) cursor->failed = 1;
}

static uint32_t cursor_u32(Cursor *cursor) {
  cursor_align(cursor, 4);
  if (cursor->failed || cursor->offset + 4 > cursor->length) {
    cursor->failed = 1;
    return 0;
  }
  const unsigned char *at = cursor->data + cursor->offset;
  cursor->offset += 4;
  return (uint32_t)at[0] | ((uint32_t)at[1] << 8) | ((uint32_t)at[2] << 16) |
      ((uint32_t)at[3] << 24);
}

static unsigned char cursor_byte(Cursor *cursor) {
  if (cursor->offset + 1 > cursor->length) {
    cursor->failed = 1;
    return 0;
  }
  return cursor->data[cursor->offset++];
}

/* Reads a string or object path into a malloc'd NUL-terminated copy. */
static char *cursor_string(Cursor *cursor) {
  uint32_t length = cursor_u32(cursor);
  if (cursor->failed || cursor->offset + (size_t)length + 1 > cursor->length) {
    cursor->failed = 1;
    return NULL;
  }
  char *text = (char *)checked_malloc((size_t)length + 1);
  memcpy(text, cursor->data + cursor->offset, length);
  text[length] = '\0';
  if (cursor->data[cursor->offset + length] != '\0') {
    cursor->failed = 1;
    free(text);
    return NULL;
  }
  cursor->offset += (size_t)length + 1;
  return text;
}

static char *cursor_signature(Cursor *cursor) {
  if (cursor->offset + 1 > cursor->length) {
    cursor->failed = 1;
    return NULL;
  }
  size_t length = cursor->data[cursor->offset++];
  if (cursor->offset + length + 1 > cursor->length) {
    cursor->failed = 1;
    return NULL;
  }
  char *text = (char *)checked_malloc(length + 1);
  memcpy(text, cursor->data + cursor->offset, length);
  text[length] = '\0';
  if (cursor->data[cursor->offset + length] != '\0') {
    cursor->failed = 1;
    free(text);
    return NULL;
  }
  cursor->offset += length + 1;
  return text;
}

/* A parsed message header: only the fields this client reads. */
typedef struct {
  unsigned char type;
  uint32_t reply_serial;
  uint32_t unix_fds;
  char *path;
  char *interface;
  char *member;
  char *signature;
  char *error_name;
} Header;

static void header_free(Header *header) {
  free(header->path);
  free(header->interface);
  free(header->member);
  free(header->signature);
  free(header->error_name);
  memset(header, 0, sizeof(*header));
}

/* Parses the fixed 16-byte header plus the fields array. On success the
 * cursor sits at the body start (aligned to 8) and *body_length holds the
 * body's byte length. Every read is bounds-checked. */
static int parse_header(Cursor *cursor, Header *header, uint32_t *body_length) {
  memset(header, 0, sizeof(*header));
  if (cursor->length < 16) return -1;
  if (cursor->data[0] != 'l') {
    diag("the bus speaks big-endian, which this client does not");
    return -1;
  }
  header->type = cursor->data[1];
  if (cursor->data[3] != 1) return -1;
  *body_length = (uint32_t)cursor->data[4] | ((uint32_t)cursor->data[5] << 8) |
      ((uint32_t)cursor->data[6] << 16) | ((uint32_t)cursor->data[7] << 24);
  cursor->offset = 12;
  uint32_t fields_length = cursor_u32(cursor);
  if (cursor->failed) return -1;
  size_t fields_end = cursor->offset + fields_length;
  if (fields_end > cursor->length) return -1;
  while (cursor->offset < fields_end) {
    cursor_align(cursor, 8);
    if (cursor->failed || cursor->offset >= fields_end) break;
    unsigned char key = cursor_byte(cursor);
    char *value_signature = cursor_signature(cursor);
    if (cursor->failed || value_signature == NULL) {
      free(value_signature);
      return -1;
    }
    char **slot = NULL;
    if (key == 1 && strcmp(value_signature, "o") == 0) slot = &header->path;
    else if (key == 2 && strcmp(value_signature, "s") == 0) slot = &header->interface;
    else if (key == 3 && strcmp(value_signature, "s") == 0) slot = &header->member;
    else if (key == 4 && strcmp(value_signature, "s") == 0) slot = &header->error_name;
    else if (key == 8 && strcmp(value_signature, "g") == 0) slot = &header->signature;
    if (slot != NULL) {
      free(*slot);
      /* Paths and strings carry a four-byte length; signatures one. */
      *slot = key == 8 ? cursor_signature(cursor) : cursor_string(cursor);
      if (cursor->failed || *slot == NULL) {
        free(*slot);
        *slot = NULL;
        free(value_signature);
        return -1;
      }
    } else if (key == 5 && strcmp(value_signature, "u") == 0) {
      header->reply_serial = cursor_u32(cursor);
    } else if (
        (key == 6 || key == 7) && strcmp(value_signature, "s") == 0) {
      /* Destination and sender: read and dropped; calls match on the reply
       * serial and signals on interface, member and path. */
      char *dropped = cursor_string(cursor);
      free(dropped);
    } else if (key == 9 && strcmp(value_signature, "u") == 0) {
      header->unix_fds = cursor_u32(cursor);
    } else {
      /* Unknown field: cannot skip an unparsed variant shape, so refuse. */
      diag("unsupported header field %u with signature %s", key, value_signature);
      free(value_signature);
      return -1;
    }
    free(value_signature);
    if (cursor->failed) return -1;
  }
  cursor_align(cursor, 8);
  return cursor->failed ? -1 : 0;
}

/* ------------------------------------------------------------------ */
/* D-Bus message sending                                                */
/* ------------------------------------------------------------------ */

static uint32_t next_serial = 1;

typedef struct {
  ByteBuffer fields;
  ByteBuffer body;
  const char *signature;
} CallBuilder;

static void call_begin(CallBuilder *call, const char *signature) {
  buffer_init(&call->fields);
  buffer_init(&call->body);
  call->signature = signature;
}

static void call_free(CallBuilder *call) {
  buffer_free(&call->fields);
  buffer_free(&call->body);
}

static void call_field(CallBuilder *call, unsigned char key, char type, const char *text) {
  buffer_align(&call->fields, 8);
  buffer_put_byte(&call->fields, key);
  char signature[2];
  signature[0] = type;
  signature[1] = '\0';
  buffer_put_signature(&call->fields, signature);
  if (type == 'o') buffer_put_path(&call->fields, text);
  else if (type == 'g') buffer_put_signature(&call->fields, text);
  else buffer_put_string(&call->fields, text);
}

/* Sends a method call; returns its serial, or 0 on failure. */
static uint32_t bus_call(
    int fd,
    const char *destination,
    const char *path,
    const char *interface,
    const char *member,
    CallBuilder *call,
    int no_reply) {
  uint32_t serial = next_serial++;
  if (next_serial == 0) next_serial = 1;
  call_field(call, 6, 's', destination);
  call_field(call, 1, 'o', path);
  call_field(call, 2, 's', interface);
  call_field(call, 3, 's', member);
  if (call->signature[0] != '\0') call_field(call, 8, 'g', call->signature);
  ByteBuffer message;
  buffer_init(&message);
  buffer_put_byte(&message, 'l');
  buffer_put_byte(&message, 1);
  buffer_put_byte(&message, (unsigned char)(no_reply ? 1 : 0));
  buffer_put_byte(&message, 1);
  buffer_put_u32(&message, (uint32_t)call->body.length);
  buffer_put_u32(&message, serial);
  buffer_put_u32(&message, (uint32_t)call->fields.length);
  buffer_put(&message, call->fields.data, call->fields.length);
  buffer_align(&message, 8);
  if (call->body.length > 0) buffer_put(&message, call->body.data, call->body.length);
  int status = write_all(fd, message.data, message.length);
  buffer_free(&message);
  return status == 0 ? serial : 0;
}

/* ------------------------------------------------------------------ */
/* Bus connection: address, socket, authentication                      */
/* ------------------------------------------------------------------ */

/* Connects a unix socket at path, or an abstract one when abstracted. */
static int connect_unix(const char *name, int abstracted) {
  int fd = socket(AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC, 0);
  if (fd < 0) return -1;
  struct sockaddr_un address;
  memset(&address, 0, sizeof(address));
  address.sun_family = AF_UNIX;
  size_t length = strlen(name);
  if (abstracted) {
    if (length + 1 >= sizeof(address.sun_path)) {
      close(fd);
      return -1;
    }
    address.sun_path[0] = '\0';
    memcpy(address.sun_path + 1, name, length);
  } else {
    if (length >= sizeof(address.sun_path)) {
      close(fd);
      return -1;
    }
    memcpy(address.sun_path, name, length + 1);
  }
  socklen_t size = (socklen_t)(offsetof(struct sockaddr_un, sun_path) + length + 1);
  if (connect(fd, (struct sockaddr *)&address, size) != 0) {
    close(fd);
    return -1;
  }
  return fd;
}

/* Tries one bus address entry (`unix:path=...`, `unix:abstract=...`, or
 * `systemd:`); returns the connected fd or -1. Only the local transports
 * are tried: a recorder has no business on TCP. */
static int try_address_entry(const char *entry) {
  if (strncmp(entry, "systemd:", 8) == 0) {
    char fallback[64];
    (void)snprintf(fallback, sizeof(fallback), "/run/user/%u/bus", (unsigned)geteuid());
    return connect_unix(fallback, 0);
  }
  if (strncmp(entry, "unix:", 5) != 0) return -1;
  const char *params = entry + 5;
  /* Comma-separated key=value pairs; the value may itself hold an escaped
   * comma, which a bus path never needs, so a plain split is exact. */
  char *copy = checked_strdup(params);
  int fd = -1;
  char *save = NULL;
  for (char *pair = strtok_r(copy, ",", &save); pair != NULL;
       pair = strtok_r(NULL, ",", &save)) {
    if (strncmp(pair, "path=", 5) == 0 && pair[5] != '\0') {
      fd = connect_unix(pair + 5, 0);
      if (fd >= 0) break;
    } else if (strncmp(pair, "abstract=", 9) == 0 && pair[9] != '\0') {
      fd = connect_unix(pair + 9, 1);
      if (fd >= 0) break;
    }
  }
  free(copy);
  return fd;
}

/* Connects to the session bus: each address the environment names, then
 * the runtime directory's bus. Never autolaunches one. */
static int bus_connect(void) {
  const char *environment = getenv("DBUS_SESSION_BUS_ADDRESS");
  if (environment != NULL && environment[0] != '\0') {
    char *copy = checked_strdup(environment);
    int fd = -1;
    char *save = NULL;
    for (char *entry = strtok_r(copy, ";", &save); entry != NULL;
         entry = strtok_r(NULL, ";", &save)) {
      fd = try_address_entry(entry);
      if (fd >= 0) break;
    }
    free(copy);
    if (fd >= 0) return fd;
  }
  const char *runtime = getenv("XDG_RUNTIME_DIR");
  if (runtime != NULL && runtime[0] == '/' && strlen(runtime) < 500) {
    char fallback[512];
    int written = snprintf(fallback, sizeof(fallback), "%s/bus", runtime);
    if (written > 0 && (size_t)written < sizeof(fallback)) {
      int fd = connect_unix(fallback, 0);
      if (fd >= 0) return fd;
    }
  }
  char euid_fallback[64];
  (void)snprintf(euid_fallback, sizeof(euid_fallback), "/run/user/%u/bus", (unsigned)geteuid());
  return connect_unix(euid_fallback, 0);
}

/* Reads one \r\n-terminated auth line, bounded. Returns a malloc'd line
 * without the terminator, or NULL. */
static char *auth_read_line(int fd) {
  ByteBuffer line;
  buffer_init(&line);
  char byte = 0;
  for (;;) {
    ssize_t done = read(fd, &byte, 1);
    if (done < 0) {
      if (errno == EINTR) continue;
      buffer_free(&line);
      return NULL;
    }
    if (done == 0 || byte == '\n') {
      buffer_free(&line);
      return NULL;
    }
    if (line.length >= AUTH_LINE_MAX_BYTES) {
      buffer_free(&line);
      return NULL;
    }
    if (byte == '\r') {
      /* The terminator's second half follows at once, or this is no line. */
      for (;;) {
        done = read(fd, &byte, 1);
        if (done < 0 && errno == EINTR) continue;
        break;
      }
      if (done != 1 || byte != '\n') {
        buffer_free(&line);
        return NULL;
      }
      break;
    }
    buffer_put_byte(&line, (unsigned char)byte);
  }
  buffer_put_byte(&line, 0);
  return line.data;
}

static int auth_write(int fd, const char *text) {
  return write_all(fd, text, strlen(text));
}

static int auth_is_ok(const char *answer) {
  return strncmp(answer, "OK ", 3) == 0 || strcmp(answer, "OK") == 0;
}

static int auth_is_data(const char *answer) {
  return strncmp(answer, "DATA", 4) == 0 &&
      (answer[4] == '\0' || answer[4] == ' ');
}

/* EXTERNAL authentication, negotiated across both servers in the wild:
 * dbus-broker takes the identity from the socket credentials and rejects
 * a supplied uid, so the first form sends none (bare AUTH, then empty
 * DATA, as sd-bus does); dbus-daemon takes the uid as the initial
 * response or the DATA answer, which the second form sends. Unix fd
 * passing is negotiated after: the portal answers OpenPipeWireRemote
 * with a descriptor, so a server without it cannot serve a recording. */
static int bus_auth(int fd) {
  char uid[32];
  (void)snprintf(uid, sizeof(uid), "%x", (unsigned)geteuid());
  static const char bare[] = "\0AUTH EXTERNAL\r\n";
  if (write_all(fd, bare, sizeof(bare) - 1) != 0) return -1;
  char *answer = auth_read_line(fd);
  if (answer == NULL) return -1;
  int done = auth_is_ok(answer);
  int wants_data = !done && auth_is_data(answer);
  free(answer);
  if (wants_data) {
    if (auth_write(fd, "DATA\r\n") != 0) return -1;
    answer = auth_read_line(fd);
    if (answer == NULL) return -1;
    done = auth_is_ok(answer);
    free(answer);
  }
  if (!done) {
    char initial[128];
    (void)snprintf(initial, sizeof(initial), "AUTH EXTERNAL %s\r\n", uid);
    if (auth_write(fd, initial) != 0) return -1;
    answer = auth_read_line(fd);
    if (answer == NULL) return -1;
    done = auth_is_ok(answer);
    wants_data = !done && auth_is_data(answer);
    free(answer);
    if (wants_data) {
      char data[128];
      (void)snprintf(data, sizeof(data), "DATA %s\r\n", uid);
      if (auth_write(fd, data) != 0) return -1;
      answer = auth_read_line(fd);
      if (answer == NULL) return -1;
      done = auth_is_ok(answer);
      free(answer);
    }
  }
  if (!done) return -1;
  if (auth_write(fd, "NEGOTIATE_UNIX_FD\r\n") != 0) return -1;
  char *negotiated = auth_read_line(fd);
  if (negotiated == NULL) return -1;
  int agreed = strcmp(negotiated, "AGREE_UNIX_FD") == 0;
  free(negotiated);
  if (!agreed) return -1;
  return auth_write(fd, "BEGIN\r\n");
}

/* ------------------------------------------------------------------ */
/* Bus stream: bytes plus passed descriptors                            */
/* ------------------------------------------------------------------ */

/* A Response signal that arrived while a method reply was awaited: the
 * portal may answer a request before the caller reads the handle, so the
 * signal is kept (one slot: a single request is outstanding at a time). */
typedef struct {
  char *path;
  int parsed;
  uint32_t response;
  uint32_t node;
  int has_node;
} EarlyResponse;

typedef struct {
  int fd;
  ByteBuffer bytes;
  int *fds;
  size_t fds_length;
  size_t fds_capacity;
  char *unique_name;
  char *sender_token;
  EarlyResponse early;
} Bus;

static void bus_init(Bus *bus, int fd) {
  bus->fd = fd;
  buffer_init(&bus->bytes);
  bus->fds = NULL;
  bus->fds_length = 0;
  bus->fds_capacity = 0;
  bus->unique_name = NULL;
  bus->sender_token = NULL;
  memset(&bus->early, 0, sizeof(bus->early));
}

static void bus_free(Bus *bus) {
  for (size_t i = 0; i < bus->fds_length; i++) close(bus->fds[i]);
  free(bus->fds);
  buffer_free(&bus->bytes);
  free(bus->unique_name);
  free(bus->sender_token);
  free(bus->early.path);
  if (bus->fd >= 0) close(bus->fd);
  memset(bus, 0, sizeof(*bus));
  bus->fd = -1;
}

/* Reads one datagram, appending bytes and collecting passed descriptors. */
static ssize_t bus_fill(Bus *bus) {
  char chunk[65536];
  char control[CMSG_SPACE(sizeof(int) * 8)];
  struct iovec vector;
  vector.iov_base = chunk;
  vector.iov_len = sizeof(chunk);
  struct msghdr message;
  memset(&message, 0, sizeof(message));
  message.msg_iov = &vector;
  message.msg_iovlen = 1;
  message.msg_control = control;
  message.msg_controllen = sizeof(control);
  ssize_t done;
  for (;;) {
    done = recvmsg(bus->fd, &message, 0);
    if (done < 0 && errno == EINTR) continue;
    break;
  }
  if (done <= 0) return done;
  if (bus->bytes.length + (size_t)done > MESSAGE_MAX_BYTES) return -1;
  buffer_put(&bus->bytes, chunk, (size_t)done);
  for (struct cmsghdr *header = CMSG_FIRSTHDR(&message); header != NULL;
       header = CMSG_NXTHDR(&message, header)) {
    if (header->cmsg_level != SOL_SOCKET || header->cmsg_type != SCM_RIGHTS) continue;
    size_t count =
        (header->cmsg_len - CMSG_LEN(0)) / sizeof(int);
    const int *received = (const int *)CMSG_DATA(header);
    for (size_t i = 0; i < count; i++) {
      if (bus->fds_length >= bus->fds_capacity) {
        bus->fds_capacity = bus->fds_capacity == 0 ? 4 : bus->fds_capacity * 2;
        bus->fds = (int *)checked_realloc(bus->fds, bus->fds_capacity * sizeof(int));
      }
      int taken = fcntl(received[i], F_DUPFD_CLOEXEC, 0);
      if (taken < 0) {
        /* The sender's descriptor stays valid; ours just failed to dup. */
        close(received[i]);
        continue;
      }
      close(received[i]);
      bus->fds[bus->fds_length++] = taken;
    }
  }
  return done;
}

/* Extracts the first complete message, with its descriptors. Returns 1
 * when a message is ready, 0 when more bytes are needed, -1 on error. */
static int bus_next(
    Bus *bus,
    Header *header,
    Cursor *body,
    int **message_fds,
    size_t *message_fds_length) {
  *message_fds = NULL;
  *message_fds_length = 0;
  if (bus->bytes.length < 16) return 0;
  Cursor probe;
  probe.data = (const unsigned char *)bus->bytes.data;
  probe.length = bus->bytes.length;
  probe.offset = 0;
  probe.failed = 0;
  uint32_t body_length = 0;
  if (parse_header(&probe, header, &body_length) != 0) {
    /* A short buffer reads as a parse failure too: tell them apart by
     * asking whether the fixed header plus fields fit. */
    header_free(header);
    Cursor fields;
    fields.data = probe.data;
    fields.length = bus->bytes.length;
    fields.offset = 12;
    fields.failed = 0;
    uint32_t fields_length = cursor_u32(&fields);
    if (fields.failed) return -1;
    size_t fields_end = 16 + fields_length;
    size_t aligned = (fields_end + 7) & ~(size_t)7;
    if (bus->bytes.length < aligned) return 0;
    return -1;
  }
  size_t total = probe.offset + body_length;
  if (bus->bytes.length < total) {
    header_free(header);
    return 0;
  }
  if (bus->fds_length < header->unix_fds) {
    /* The descriptors travel with the message but may land later. */
    header_free(header);
    return 0;
  }
  /* The message leaves the stream buffer, so the body it yields is a
   * copy the caller frees with body_free. */
  size_t body_offset = probe.offset;
  unsigned char *owned = (unsigned char *)checked_malloc(total);
  memcpy(owned, bus->bytes.data, total);
  if (header->unix_fds > 0) {
    *message_fds = (int *)checked_malloc(header->unix_fds * sizeof(int));
    for (uint32_t i = 0; i < header->unix_fds; i++) (*message_fds)[i] = bus->fds[i];
    *message_fds_length = header->unix_fds;
    memmove(
        bus->fds,
        bus->fds + header->unix_fds,
        (bus->fds_length - header->unix_fds) * sizeof(int));
    bus->fds_length -= header->unix_fds;
  }
  memmove(bus->bytes.data, bus->bytes.data + total, bus->bytes.length - total);
  bus->bytes.length -= total;
  body->data = owned;
  body->length = total;
  body->offset = body_offset;
  body->failed = 0;
  return 1;
}

static void body_free(Cursor *body) {
  free((void *)body->data);
  body->data = NULL;
  body->length = 0;
  body->offset = 0;
}

/* ------------------------------------------------------------------ */
/* Skipping values the flow does not read                               */
/* ------------------------------------------------------------------ */

/* Skips one value of the signature's next complete type, advancing past
 * it. Backends add keys to results; unknown ones are skipped, never fatal. */
static int skip_type(Cursor *cursor, const char **signature);

/* The end of the complete type that starts at signature. */
static const char *type_end(const char *signature) {
  char lead = *signature;
  if (lead == '\0') return signature;
  if (lead == 'a') return type_end(signature + 1);
  if (lead != '(' && lead != '{') return signature + 1;
  int depth = 0;
  for (; *signature != '\0'; signature++) {
    if (*signature == '(' || *signature == '{') {
      depth++;
    } else if (*signature == ')' || *signature == '}') {
      depth--;
      if (depth == 0) return signature + 1;
    }
  }
  return signature;
}

/* The wire alignment of a value of the type that starts with lead. */
static size_t type_alignment(char lead) {
  switch (lead) {
    case 'y':
    case 'g':
    case 'v':
      return 1;
    case 'n':
    case 'q':
      return 2;
    case 'x':
    case 't':
    case 'd':
    case '(':
    case '{':
      return 8;
    default:
      return 4;
  }
}

static int skip_array(Cursor *cursor, const char **signature) {
  /* signature[0] is 'a': the element type follows it. */
  (*signature)++;
  uint32_t length = cursor_u32(cursor);
  if (cursor->failed) return -1;
  const char *element = *signature;
  *signature = type_end(element);
  /* The padding to the element's alignment follows the length even when
   * the array is empty. */
  cursor_align(cursor, type_alignment(element[0]));
  if (cursor->failed) return -1;
  size_t end = cursor->offset + length;
  if (end > cursor->length) {
    cursor->failed = 1;
    return -1;
  }
  while (cursor->offset < end) {
    const char *one = element;
    if (element[0] == '{') {
      /* Dict entry: align, key, value. */
      cursor_align(cursor, 8);
      one++;
      if (skip_type(cursor, &one) != 0) return -1;
      if (skip_type(cursor, &one) != 0) return -1;
      if (*one != '}') {
        cursor->failed = 1;
        return -1;
      }
    } else if (skip_type(cursor, &one) != 0) {
      return -1;
    }
    if (cursor->failed) return -1;
  }
  return 0;
}

static int skip_type(Cursor *cursor, const char **signature) {
  char type = **signature;
  if (type == '\0') {
    cursor->failed = 1;
    return -1;
  }
  (*signature)++;
  switch (type) {
    case 'y':
      (void)cursor_byte(cursor);
      return cursor->failed ? -1 : 0;
    case 'b':
    case 'i':
    case 'u':
    case 'h':
      (void)cursor_u32(cursor);
      return cursor->failed ? -1 : 0;
    case 'n':
    case 'q': {
      cursor_align(cursor, 2);
      if (cursor->offset + 2 > cursor->length) {
        cursor->failed = 1;
        return -1;
      }
      cursor->offset += 2;
      return 0;
    }
    case 'x':
    case 't':
    case 'd': {
      cursor_align(cursor, 8);
      if (cursor->offset + 8 > cursor->length) {
        cursor->failed = 1;
        return -1;
      }
      cursor->offset += 8;
      return 0;
    }
    case 's':
    case 'o': {
      char *text = cursor_string(cursor);
      free(text);
      return cursor->failed ? -1 : 0;
    }
    case 'g': {
      char *text = cursor_signature(cursor);
      free(text);
      return cursor->failed ? -1 : 0;
    }
    case 'a':
      (*signature)--;
      return skip_array(cursor, signature);
    case 'v': {
      char *inner = cursor_signature(cursor);
      if (cursor->failed || inner == NULL) {
        free(inner);
        return -1;
      }
      const char *value = inner;
      int status = skip_type(cursor, &value);
      free(inner);
      return status;
    }
    case '(': {
      cursor_align(cursor, 8);
      while (**signature != ')' && **signature != '\0') {
        if (skip_type(cursor, signature) != 0) return -1;
      }
      if (**signature == ')') (*signature)++;
      return cursor->failed ? -1 : 0;
    }
    case '{': {
      cursor_align(cursor, 8);
      if (skip_type(cursor, signature) != 0) return -1;
      if (skip_type(cursor, signature) != 0) return -1;
      if (**signature == '}') (*signature)++;
      return cursor->failed ? -1 : 0;
    }
    default:
      cursor->failed = 1;
      return -1;
  }
}

/* ------------------------------------------------------------------ */
/* Calls, replies, and portal signals                                   */
/* ------------------------------------------------------------------ */

static unsigned token_counter = 0;

/* A request/session token: letters, digits and underscores only. */
static void make_token(char *out, size_t size) {
  (void)snprintf(
      out, size, "muse_spark_%u_%u", (unsigned)getpid(), token_counter++);
}

typedef struct {
  int revoked;
} SignalState;

/* Line-buffered stdin: the host's stop/cancel/launch commands. */
typedef struct {
  ByteBuffer buffered;
  int eof;
  int overlong;
} StdinReader;

static void stdin_init(StdinReader *reader) {
  buffer_init(&reader->buffered);
  reader->eof = 0;
  reader->overlong = 0;
}

static void stdin_free(StdinReader *reader) {
  buffer_free(&reader->buffered);
}

/* Reads what is available; returns 1 when a line (or EOF) is ready. */
static int stdin_fill(StdinReader *reader) {
  char chunk[8192];
  ssize_t done = read(STDIN_FILENO, chunk, sizeof(chunk));
  if (done < 0) {
    if (errno == EINTR) return 0;
    reader->eof = 1;
    return 1;
  }
  if (done == 0) {
    reader->eof = 1;
    return 1;
  }
  if (reader->buffered.length + (size_t)done > LINE_MAX_BYTES) {
    /* Past the protocol bound: latch overlong and stop buffering. */
    reader->overlong = 1;
    return 1;
  }
  buffer_put(&reader->buffered, chunk, (size_t)done);
  return memchr(reader->buffered.data, '\n', reader->buffered.length) != NULL;
}

/* Takes the next complete line (without the newline), or NULL. */
static char *stdin_take_line(StdinReader *reader) {
  void *newline =
      memchr(reader->buffered.data, '\n', reader->buffered.length);
  if (newline == NULL) return NULL;
  size_t length = (size_t)((char *)newline - reader->buffered.data);
  char *line = (char *)checked_malloc(length + 1);
  memcpy(line, reader->buffered.data, length);
  line[length] = '\0';
  if (length > 0 && line[length - 1] == '\r') line[length - 1] = '\0';
  memmove(
      reader->buffered.data,
      reader->buffered.data + length + 1,
      reader->buffered.length - length - 1);
  reader->buffered.length -= length + 1;
  return line;
}

static int parse_response(
    Cursor *body,
    const char *signature,
    uint32_t *response,
    uint32_t *node,
    int *has_node);

/* Keeps a Request Response signal read ahead of its handle. */
static void bus_keep_response(Bus *bus, const Header *header, Cursor *body) {
  free(bus->early.path);
  bus->early.path = checked_strdup(header->path);
  bus->early.response = 2;
  bus->early.node = 0;
  bus->early.has_node = 0;
  bus->early.parsed = parse_response(
      body, header->signature, &bus->early.response, &bus->early.node,
      &bus->early.has_node) == 0;
}

/* Pumps the bus until the call's reply or error arrives. Signals on the
 * way are noted (a Closed session revokes the run) and anything else is
 * ignored: each step awaits its own reply before it listens for more.
 * While a portal run is owed, stdin is watched too: the host speaks only
 * cancel before the launch, so any line (or EOF) cancels the wait. */
static int call_and_await(
    Bus *bus,
    uint32_t serial,
    const char *session_path,
    Header *reply,
    Cursor *body,
    int **message_fds,
    size_t *message_fds_length,
    SignalState *signals,
    StdinReader *commands,
    int *cancelled) {
  if (cancelled != NULL) *cancelled = 0;
  for (;;) {
    Header header;
    Cursor candidate;
    int *fds = NULL;
    size_t fds_length = 0;
    int ready = bus_next(bus, &header, &candidate, &fds, &fds_length);
    if (ready < 0) return -1;
    if (ready == 0) {
      struct pollfd watched[2];
      watched[0].fd = bus->fd;
      watched[0].events = POLLIN;
      watched[0].revents = 0;
      nfds_t count = 1;
      if (commands != NULL && !commands->eof && !commands->overlong) {
        watched[1].fd = STDIN_FILENO;
        watched[1].events = POLLIN;
        watched[1].revents = 0;
        count = 2;
      }
      int waiting = poll(watched, count, -1);
      if (waiting < 0) {
        if (errno == EINTR) continue;
        return -1;
      }
      if (count == 2 &&
          ((watched[1].revents & (POLLIN | POLLHUP | POLLERR | POLLNVAL)) != 0)) {
        int filled = stdin_fill(commands);
        if (commands->eof || commands->overlong) {
          if (cancelled != NULL) *cancelled = 1;
          return -1;
        }
        if (filled) {
          char *line = NULL;
          while ((line = stdin_take_line(commands)) != NULL) free(line);
          if (cancelled != NULL) *cancelled = 1;
          return -1;
        }
      }
      if ((watched[0].revents & (POLLERR | POLLHUP | POLLNVAL)) != 0) return -1;
      if ((watched[0].revents & POLLIN) == 0) continue;
      ssize_t filled = bus_fill(bus);
      if (filled <= 0) return -1;
      continue;
    }
    if (
        (header.type == 2 || header.type == 3) && header.reply_serial == serial) {
      *reply = header;
      *body = candidate;
      *message_fds = fds;
      *message_fds_length = fds_length;
      return 0;
    }
    if (
        header.type == 4 && header.interface != NULL && header.member != NULL &&
        header.path != NULL &&
        strcmp(header.interface, PORTAL_SESSION_IFACE) == 0 &&
        strcmp(header.member, "Closed") == 0 && session_path != NULL &&
        strcmp(header.path, session_path) == 0) {
      signals->revoked = 1;
    }
    if (
        header.type == 4 && header.interface != NULL && header.member != NULL &&
        header.path != NULL &&
        strcmp(header.interface, PORTAL_REQUEST_IFACE) == 0 &&
        strcmp(header.member, "Response") == 0)
      bus_keep_response(bus, &header, &candidate);
    for (size_t i = 0; i < fds_length; i++) close(fds[i]);
    free(fds);
    header_free(&header);
    body_free(&candidate);
  }
}

static void close_message_fds(int *fds, size_t length) {
  for (size_t i = 0; i < length; i++) close(fds[i]);
  free(fds);
}

/* The portal answers Hello with our unique name; the sender token is the
 * name with its colons and dots swapped for underscores. */
static int bus_hello(Bus *bus) {
  CallBuilder call;
  call_begin(&call, "");
  uint32_t serial = bus_call(
      bus->fd, DBUS_BUS_NAME, DBUS_OBJECT_PATH, DBUS_IFACE, "Hello", &call, 0);
  call_free(&call);
  if (serial == 0) return -1;
  Header reply;
  Cursor body;
  int *fds = NULL;
  size_t fds_length = 0;
  SignalState signals;
  memset(&signals, 0, sizeof(signals));
  if (call_and_await(bus, serial, NULL, &reply, &body, &fds, &fds_length, &signals, NULL, NULL) != 0)
    return -1;
  int status = -1;
  if (
      reply.type == 2 && reply.signature != NULL &&
      strcmp(reply.signature, "s") == 0) {
    char *name = cursor_string(&body);
    if (!body.failed && name != NULL) {
      free(bus->unique_name);
      bus->unique_name = name;
      size_t length = strlen(name);
      free(bus->sender_token);
      bus->sender_token = (char *)checked_malloc(length + 1);
      size_t out = 0;
      for (size_t i = 0; i < length; i++) {
        if (name[i] == ':' || name[i] == '.') {
          if (out == 0 && name[i] == ':') continue;
          bus->sender_token[out++] = '_';
        } else {
          bus->sender_token[out++] = name[i];
        }
      }
      bus->sender_token[out] = '\0';
      status = bus->sender_token[0] == '\0' ? -1 : 0;
    }
  }
  close_message_fds(fds, fds_length);
  header_free(&reply);
  body_free(&body);
  return status;
}

static int bus_add_match(Bus *bus, const char *rule) {
  CallBuilder call;
  call_begin(&call, "s");
  buffer_put_string(&call.body, rule);
  uint32_t serial = bus_call(
      bus->fd, DBUS_BUS_NAME, DBUS_OBJECT_PATH, DBUS_IFACE, "AddMatch", &call, 0);
  call_free(&call);
  if (serial == 0) return -1;
  Header reply;
  Cursor body;
  int *fds = NULL;
  size_t fds_length = 0;
  SignalState signals;
  memset(&signals, 0, sizeof(signals));
  if (call_and_await(bus, serial, NULL, &reply, &body, &fds, &fds_length, &signals, NULL, NULL) != 0)
    return -1;
  int status = reply.type == 2 ? 0 : -1;
  close_message_fds(fds, fds_length);
  header_free(&reply);
  body_free(&body);
  return status;
}

/* Reads one Response signal's results: the response code, and for Start
 * the first stream's PipeWire node. Unknown keys are skipped. */
static int parse_response(
    Cursor *body,
    const char *signature,
    uint32_t *response,
    uint32_t *node,
    int *has_node) {
  *has_node = 0;
  if (signature == NULL || strcmp(signature, "ua{sv}") != 0) return -1;
  *response = cursor_u32(body);
  if (body->failed) return -1;
  uint32_t length = cursor_u32(body);
  if (body->failed) return -1;
  cursor_align(body, 8);
  size_t end = body->offset + length;
  if (end > body->length) {
    body->failed = 1;
    return -1;
  }
  while (body->offset < end) {
    cursor_align(body, 8);
    char *key = cursor_string(body);
    if (body->failed || key == NULL) {
      free(key);
      return -1;
    }
    char *value_signature = cursor_signature(body);
    if (body->failed || value_signature == NULL) {
      free(key);
      free(value_signature);
      return -1;
    }
    if (strcmp(key, "streams") == 0 && strcmp(value_signature, "a(ua{sv})") == 0) {
      uint32_t streams_length = cursor_u32(body);
      if (body->failed) {
        free(key);
        free(value_signature);
        return -1;
      }
      cursor_align(body, 8);
      size_t streams_end = body->offset + streams_length;
      if (streams_end > body->length) {
        body->failed = 1;
        free(key);
        free(value_signature);
        return -1;
      }
      if (streams_length > 0) {
        cursor_align(body, 8);
        uint32_t first = cursor_u32(body);
        if (body->failed) {
          free(key);
          free(value_signature);
          return -1;
        }
        /* The stream's properties follow the node; skip them and the
         * remaining streams unread. */
        const char *props = "a{sv}";
        if (skip_type(body, &props) != 0) {
          free(key);
          free(value_signature);
          return -1;
        }
        if (node != NULL) {
          *node = first;
          *has_node = first > 0;
        }
        body->offset = streams_end;
      }
    } else {
      const char *value = value_signature;
      if (skip_type(body, &value) != 0) {
        free(key);
        free(value_signature);
        return -1;
      }
    }
    free(key);
    free(value_signature);
    if (body->failed) return -1;
  }
  return 0;
}

typedef enum {
  RESPONSE_OK = 0,
  RESPONSE_DISMISSED = 1,
  RESPONSE_FAILED = 2,
  RESPONSE_REVOKED = 3,
  RESPONSE_BUS_ERROR = 4,
  RESPONSE_CANCELLED = 5,
} ResponseStatus;

/* The portal's response code: 0 success, 1 the person ended the
 * interaction, 2 it ended some other way. A Start without a stream is no
 * success. */
static ResponseStatus classify_response(
    int parsed, uint32_t response, int has_node, int wants_node) {
  if (!parsed) return RESPONSE_BUS_ERROR;
  if (response == 1) return RESPONSE_DISMISSED;
  if (response != 0) return RESPONSE_FAILED;
  if (wants_node && !has_node) return RESPONSE_FAILED;
  return RESPONSE_OK;
}

/* Waits for the request's Response signal: the person answers the
 * desktop's picker on their own time (D121, no deadline). A signal that
 * already arrived is taken first. A Closed session on the way revokes the
 * run; the host's cancel (or EOF) on stdin ends the wait. */
static ResponseStatus await_response(
    Bus *bus,
    const char *request_path,
    const char *session_path,
    uint32_t *node,
    StdinReader *commands) {
  if (bus->early.path != NULL && strcmp(bus->early.path, request_path) == 0) {
    ResponseStatus kept = classify_response(
        bus->early.parsed, bus->early.response, bus->early.has_node, node != NULL);
    if (node != NULL) *node = bus->early.node;
    free(bus->early.path);
    bus->early.path = NULL;
    return kept;
  }
  for (;;) {
    Header header;
    Cursor body;
    int *fds = NULL;
    size_t fds_length = 0;
    int ready = bus_next(bus, &header, &body, &fds, &fds_length);
    if (ready < 0) return RESPONSE_BUS_ERROR;
    if (ready == 0) {
      struct pollfd watched[2];
      watched[0].fd = bus->fd;
      watched[0].events = POLLIN;
      watched[0].revents = 0;
      watched[1].fd = STDIN_FILENO;
      watched[1].events = POLLIN;
      watched[1].revents = 0;
      int waiting = poll(watched, 2, -1);
      if (waiting < 0) {
        if (errno == EINTR) continue;
        return RESPONSE_BUS_ERROR;
      }
      if ((watched[1].revents & (POLLIN | POLLHUP | POLLERR | POLLNVAL)) != 0) {
        int filled = stdin_fill(commands);
        if (commands->eof || commands->overlong) return RESPONSE_CANCELLED;
        if (filled) {
          char *line = NULL;
          while ((line = stdin_take_line(commands)) != NULL) free(line);
          return RESPONSE_CANCELLED;
        }
      }
      if ((watched[0].revents & (POLLERR | POLLHUP | POLLNVAL)) != 0)
        return RESPONSE_BUS_ERROR;
      if ((watched[0].revents & POLLIN) == 0) continue;
      ssize_t filled = bus_fill(bus);
      if (filled <= 0) return RESPONSE_BUS_ERROR;
      continue;
    }
    ResponseStatus status = RESPONSE_BUS_ERROR;
    int settled = 0;
    if (
        header.type == 4 && header.interface != NULL && header.member != NULL &&
        header.path != NULL) {
      if (
          strcmp(header.interface, PORTAL_REQUEST_IFACE) == 0 &&
          strcmp(header.member, "Response") == 0 &&
          strcmp(header.path, request_path) == 0) {
        uint32_t response = 2;
        uint32_t found = 0;
        int has_node = 0;
        int parsed =
            parse_response(&body, header.signature, &response, &found, &has_node) == 0;
        status = classify_response(parsed, response, has_node, node != NULL);
        if (node != NULL) *node = found;
        settled = 1;
      } else if (
          session_path != NULL &&
          strcmp(header.interface, PORTAL_SESSION_IFACE) == 0 &&
          strcmp(header.member, "Closed") == 0 &&
          strcmp(header.path, session_path) == 0) {
        status = RESPONSE_REVOKED;
        settled = 1;
      }
    }
    close_message_fds(fds, fds_length);
    header_free(&header);
    body_free(&body);
    if (settled) return status;
  }
}

/* ------------------------------------------------------------------ */
/* stdout protocol                                                      */
/* ------------------------------------------------------------------ */

static void print_line(const char *line) {
  (void)fputs(line, stdout);
  (void)fputc('\n', stdout);
  (void)fflush(stdout);
}

static void print_sources(int fd, uint32_t node) {
  char line[128];
  (void)snprintf(
      line, sizeof(line), "{\"type\":\"sources\",\"fd\":%d,\"nodeId\":%u}", fd, node);
  print_line(line);
}

static void print_complete(void) {
  print_line("{\"type\":\"complete\"}");
}

static void print_error(const char *code) {
  (void)fputs("{\"type\":\"error\",\"code\":\"", stdout);
  (void)fputs(code, stdout);
  (void)fputs("\"}\n", stdout);
  (void)fflush(stdout);
}

static void print_closed(void) {
  print_line("{\"type\":\"closed\"}");
}

/* ------------------------------------------------------------------ */
/* Probe: the bus answers and the portal carries ScreenCast             */
/* ------------------------------------------------------------------ */

/* Reads a ScreenCast property that is a uint32 in a variant. Returns 0
 * with *value filled, 1 when the portal answers with a bus error (the
 * property or the interface is not there), and -1 when the bus fails. The
 * call starts the portal when the desktop only activates it. */
static int portal_property_u32(Bus *bus, const char *name, uint32_t *value) {
  CallBuilder call;
  call_begin(&call, "ss");
  buffer_put_string(&call.body, PORTAL_SCREENCAST_IFACE);
  buffer_put_string(&call.body, name);
  uint32_t serial = bus_call(
      bus->fd, PORTAL_BUS_NAME, PORTAL_OBJECT_PATH, DBUS_PROPERTIES_IFACE, "Get",
      &call, 0);
  call_free(&call);
  if (serial == 0) return -1;
  Header reply;
  Cursor body;
  int *fds = NULL;
  size_t fds_length = 0;
  SignalState signals;
  memset(&signals, 0, sizeof(signals));
  if (call_and_await(
          bus, serial, NULL, &reply, &body, &fds, &fds_length, &signals, NULL,
          NULL) != 0)
    return -1;
  int status = 1;
  if (reply.type == 2 && reply.signature != NULL && strcmp(reply.signature, "v") == 0) {
    char *inner = cursor_signature(&body);
    if (inner != NULL && strcmp(inner, "u") == 0) {
      uint32_t read = cursor_u32(&body);
      if (!body.failed) {
        *value = read;
        status = 0;
      } else {
        status = -1;
      }
    }
    free(inner);
  }
  close_message_fds(fds, fds_length);
  header_free(&reply);
  body_free(&body);
  return status;
}

static int run_probe(void) {
  int fd = bus_connect();
  if (fd < 0) {
    diag("no session bus");
    return 1;
  }
  Bus bus;
  bus_init(&bus, fd);
  int status = 1;
  do {
    if (bus_auth(bus.fd) != 0) {
      diag("the bus refused authentication");
      break;
    }
    if (bus_hello(&bus) != 0) {
      diag("the bus answered no Hello");
      break;
    }
    uint32_t version = 0;
    int answer = portal_property_u32(&bus, "version", &version);
    if (answer < 0) {
      diag("the bus answered no ScreenCast probe");
      break;
    }
    if (answer > 0) {
      diag("no xdg-desktop-portal ScreenCast on the bus");
      break;
    }
    print_line("muse-portal-record-ready");
    status = 0;
  } while (0);
  bus_free(&bus);
  return status;
}

/* ------------------------------------------------------------------ */
/* Portal flow: session, sources, the person's pick, the descriptor     */
/* ------------------------------------------------------------------ */

/* Appends an a{sv} options dict from the entries buffer. The padding to the
 * dict entry's alignment follows the length even when the array is empty. */
static void put_options(ByteBuffer *body, const ByteBuffer *entries) {
  buffer_put_u32(body, (uint32_t)entries->length);
  buffer_align(body, 8);
  if (entries->length > 0) buffer_put(body, entries->data, entries->length);
}

static void put_session_token_option(ByteBuffer *entries, const char *token) {
  buffer_put_dict_entry(entries, "session_handle_token");
  buffer_put_variant_string(entries, token);
}

static void put_handle_token_option(ByteBuffer *entries, const char *token) {
  buffer_put_dict_entry(entries, "handle_token");
  buffer_put_variant_string(entries, token);
}

/* How a portal method call ended when it returned no request handle. */
typedef enum {
  CALL_OK = 0,
  CALL_REFUSED,
  CALL_UNAVAILABLE,
  CALL_FAILED,
} CallVerdict;

static int error_is(const Header *reply, const char *name) {
  return reply->error_name != NULL && strcmp(reply->error_name, name) == 0;
}

/* Calls a portal method and parses its single object-path reply. A bus
 * error names its verdict: the desktop refused the caller, the portal is
 * not there, or the call failed some other way. */
static char *portal_call_path(
    Bus *bus,
    const char *member,
    CallBuilder *call,
    const char *session_path,
    StdinReader *commands,
    int *cancelled,
    CallVerdict *verdict) {
  *verdict = CALL_FAILED;
  uint32_t serial = bus_call(
      bus->fd, PORTAL_BUS_NAME, PORTAL_OBJECT_PATH, PORTAL_SCREENCAST_IFACE,
      member, call, 0);
  if (serial == 0) return NULL;
  Header reply;
  Cursor body;
  int *fds = NULL;
  size_t fds_length = 0;
  SignalState signals;
  memset(&signals, 0, sizeof(signals));
  if (call_and_await(
          bus, serial, session_path, &reply, &body, &fds, &fds_length, &signals,
          commands, cancelled) != 0)
    return NULL;
  char *path = NULL;
  if (
      reply.type == 2 && reply.signature != NULL &&
      strcmp(reply.signature, "o") == 0)
    path = cursor_string(&body);
  if (body.failed) {
    free(path);
    path = NULL;
  }
  if (reply.type == 3) {
    if (error_is(&reply, "org.freedesktop.DBus.Error.AccessDenied") ||
        error_is(&reply, "org.freedesktop.portal.Error.NotAllowed"))
      *verdict = CALL_REFUSED;
    else if (
        error_is(&reply, "org.freedesktop.DBus.Error.ServiceUnknown") ||
        error_is(&reply, "org.freedesktop.DBus.Error.NameHasNoOwner") ||
        error_is(&reply, "org.freedesktop.DBus.Error.UnknownObject") ||
        error_is(&reply, "org.freedesktop.DBus.Error.UnknownInterface") ||
        error_is(&reply, "org.freedesktop.DBus.Error.UnknownMethod") ||
        error_is(&reply, "org.freedesktop.DBus.Error.NoReply"))
      *verdict = CALL_UNAVAILABLE;
  }
  close_message_fds(fds, fds_length);
  header_free(&reply);
  body_free(&body);
  if (signals.revoked) {
    free(path);
    return NULL;
  }
  return path;
}

typedef struct {
  int fd;
  uint32_t node;
  int created;
  char session_path[512];
} PortalSession;

/* Best-effort session close: no reply is owed or awaited. */
static void portal_close_session(Bus *bus, const char *session_path) {
  CallBuilder call;
  call_begin(&call, "");
  (void)bus_call(
      bus->fd, PORTAL_BUS_NAME, session_path, PORTAL_SESSION_IFACE, "Close",
      &call, 1);
  call_free(&call);
}

/* The four method bodies of the ScreenCast flow, as the interface
 * documents them (org.freedesktop.portal.ScreenCast): CreateSession a{sv},
 * SelectSources oa{sv}, Start osa{sv}, OpenPipeWireRemote oa{sv}. */
static void build_create_session(
    CallBuilder *call, const char *request_token, const char *session_token) {
  call_begin(call, "a{sv}");
  ByteBuffer options;
  buffer_init(&options);
  put_handle_token_option(&options, request_token);
  put_session_token_option(&options, session_token);
  put_options(&call->body, &options);
  buffer_free(&options);
}

static void build_select_sources(
    CallBuilder *call,
    const char *session_path,
    const char *request_token,
    uint32_t cursor_modes) {
  call_begin(call, "oa{sv}");
  buffer_put_path(&call->body, session_path);
  ByteBuffer options;
  buffer_init(&options);
  put_handle_token_option(&options, request_token);
  buffer_put_dict_entry(&options, "types");
  buffer_put_variant_u32(&options, CAPTURE_MONITOR);
  buffer_put_dict_entry(&options, "multiple");
  buffer_put_variant_bool(&options, 0);
  if ((cursor_modes & CURSOR_EMBEDDED) != 0) {
    buffer_put_dict_entry(&options, "cursor_mode");
    buffer_put_variant_u32(&options, CURSOR_EMBEDDED);
  }
  put_options(&call->body, &options);
  buffer_free(&options);
}

static void build_start(CallBuilder *call, const char *session_path, const char *request_token) {
  call_begin(call, "osa{sv}");
  buffer_put_path(&call->body, session_path);
  buffer_put_string(&call->body, "");
  ByteBuffer options;
  buffer_init(&options);
  put_handle_token_option(&options, request_token);
  put_options(&call->body, &options);
  buffer_free(&options);
}

static void build_open_pipewire_remote(CallBuilder *call, const char *session_path) {
  call_begin(call, "oa{sv}");
  buffer_put_path(&call->body, session_path);
  ByteBuffer options;
  buffer_init(&options);
  put_options(&call->body, &options);
  buffer_free(&options);
}

static const char *verdict_code(CallVerdict verdict) {
  if (verdict == CALL_REFUSED) return "permission";
  return verdict == CALL_UNAVAILABLE ? "unavailable" : "failed";
}

/* What a finished Response wait means for the flow: NULL to go on, else
 * the error code to print. */
static const char *response_code(ResponseStatus status) {
  if (status == RESPONSE_OK) return NULL;
  if (status == RESPONSE_CANCELLED || status == RESPONSE_DISMISSED) return "cancelled";
  return status == RESPONSE_REVOKED ? "revoked" : "failed";
}

/* Runs CreateSession, SelectSources and Start; returns the error code to
 * print, or NULL with the session filled in. */
static const char *run_portal_flow(Bus *bus, StdinReader *commands, PortalSession *out) {
  out->fd = -1;
  out->node = 0;
  out->created = 0;
  out->session_path[0] = '\0';
  char request_token[TOKEN_MAX_BYTES];
  char session_token[TOKEN_MAX_BYTES];
  make_token(request_token, sizeof(request_token));
  make_token(session_token, sizeof(session_token));
  if (
      bus->sender_token == NULL ||
      strlen(bus->sender_token) + strlen(session_token) >= 400)
    return "failed";
  int length = snprintf(
      out->session_path, sizeof(out->session_path),
      "/org/freedesktop/portal/desktop/session/%s/%s", bus->sender_token,
      session_token);
  if (length <= 0 || (size_t)length >= sizeof(out->session_path)) return "failed";

  /* The session lives at the path its token names. */
  CallBuilder create_call;
  build_create_session(&create_call, request_token, session_token);
  int cancelled = 0;
  CallVerdict verdict = CALL_FAILED;
  char *create_request = portal_call_path(
      bus, "CreateSession", &create_call, NULL, commands, &cancelled, &verdict);
  call_free(&create_call);
  if (cancelled) {
    free(create_request);
    return "cancelled";
  }
  if (create_request == NULL) return verdict_code(verdict);
  ResponseStatus create_status =
      await_response(bus, create_request, out->session_path, NULL, commands);
  free(create_request);
  if (response_code(create_status) != NULL) return response_code(create_status);
  out->created = 1;

  /* The cursor is drawn into the picture when the portal can: the mode is
   * offered from version 2 of the interface, so it is asked for only when
   * the property says it is there. */
  uint32_t cursor_modes = 0;
  if (portal_property_u32(bus, "AvailableCursorModes", &cursor_modes) < 0) return "failed";

  /* One monitor, nothing persisted. */
  char select_token[TOKEN_MAX_BYTES];
  make_token(select_token, sizeof(select_token));
  CallBuilder select_call;
  build_select_sources(&select_call, out->session_path, select_token, cursor_modes);
  cancelled = 0;
  char *select_request = portal_call_path(
      bus, "SelectSources", &select_call, out->session_path, commands, &cancelled, &verdict);
  call_free(&select_call);
  if (cancelled) {
    free(select_request);
    return "cancelled";
  }
  if (select_request == NULL) return verdict_code(verdict);
  ResponseStatus select_status =
      await_response(bus, select_request, out->session_path, NULL, commands);
  free(select_request);
  if (response_code(select_status) != NULL) return response_code(select_status);

  /* Start shows the desktop's picker; the person answers on their time. */
  char start_token[TOKEN_MAX_BYTES];
  make_token(start_token, sizeof(start_token));
  CallBuilder start_call;
  build_start(&start_call, out->session_path, start_token);
  cancelled = 0;
  char *start_request = portal_call_path(
      bus, "Start", &start_call, out->session_path, commands, &cancelled, &verdict);
  call_free(&start_call);
  if (cancelled) {
    free(start_request);
    return "cancelled";
  }
  if (start_request == NULL) return verdict_code(verdict);
  uint32_t node = 0;
  ResponseStatus start_status =
      await_response(bus, start_request, out->session_path, &node, commands);
  free(start_request);
  if (response_code(start_status) != NULL) return response_code(start_status);
  if (node == 0) return "failed";
  out->node = node;

  /* OpenPipeWireRemote answers with the descriptor itself. */
  CallBuilder open_call;
  build_open_pipewire_remote(&open_call, out->session_path);
  uint32_t serial = bus_call(
      bus->fd, PORTAL_BUS_NAME, PORTAL_OBJECT_PATH, PORTAL_SCREENCAST_IFACE,
      "OpenPipeWireRemote", &open_call, 0);
  call_free(&open_call);
  if (serial == 0) return "failed";
  Header reply;
  Cursor body;
  int *fds = NULL;
  size_t fds_length = 0;
  SignalState signals;
  memset(&signals, 0, sizeof(signals));
  cancelled = 0;
  if (call_and_await(
          bus, serial, out->session_path, &reply, &body, &fds, &fds_length,
          &signals, commands, &cancelled) != 0)
    return cancelled ? "cancelled" : "failed";
  const char *error = "failed";
  if (
      reply.type == 2 && reply.signature != NULL &&
      strcmp(reply.signature, "h") == 0) {
    /* The body's index names the received descriptor in arrival order. */
    uint32_t index = cursor_u32(&body);
    if (!body.failed && (size_t)index < fds_length && !signals.revoked) {
      out->fd = fds[index];
      fds[index] = -1;
      error = NULL;
    }
  }
  for (size_t i = 0; i < fds_length; i++) {
    if (fds[i] >= 0) close(fds[i]);
  }
  free(fds);
  header_free(&reply);
  body_free(&body);
  if (error == NULL && out->fd < 0) error = "failed";
  return error;
}

/* ------------------------------------------------------------------ */
/* The launch line: strict JSON for one fixed shape                     */
/* ------------------------------------------------------------------ */

typedef struct {
  const char *cursor;
  const char *end;
  int failed;
} Json;

static void json_whitespace(Json *json) {
  while (json->cursor < json->end &&
         (*json->cursor == ' ' || *json->cursor == '\t' || *json->cursor == '\r'))
    json->cursor++;
}

static int json_expect(Json *json, char want) {
  json_whitespace(json);
  if (json->cursor >= json->end || *json->cursor != want) {
    json->failed = 1;
    return -1;
  }
  json->cursor++;
  return 0;
}

static void json_put_utf8(ByteBuffer *out, unsigned code) {
  if (code < 0x80) {
    buffer_put_byte(out, (unsigned char)code);
  } else if (code < 0x800) {
    buffer_put_byte(out, (unsigned char)(0xc0 | (code >> 6)));
    buffer_put_byte(out, (unsigned char)(0x80 | (code & 0x3f)));
  } else if (code < 0x10000) {
    buffer_put_byte(out, (unsigned char)(0xe0 | (code >> 12)));
    buffer_put_byte(out, (unsigned char)(0x80 | ((code >> 6) & 0x3f)));
    buffer_put_byte(out, (unsigned char)(0x80 | (code & 0x3f)));
  } else {
    buffer_put_byte(out, (unsigned char)(0xf0 | (code >> 18)));
    buffer_put_byte(out, (unsigned char)(0x80 | ((code >> 12) & 0x3f)));
    buffer_put_byte(out, (unsigned char)(0x80 | ((code >> 6) & 0x3f)));
    buffer_put_byte(out, (unsigned char)(0x80 | (code & 0x3f)));
  }
}

static unsigned json_hex4(Json *json) {
  unsigned value = 0;
  for (int i = 0; i < 4; i++) {
    if (json->cursor >= json->end) {
      json->failed = 1;
      return 0;
    }
    char digit = *json->cursor++;
    value *= 16;
    if (digit >= '0' && digit <= '9') value += (unsigned)(digit - '0');
    else if (digit >= 'a' && digit <= 'f') value += (unsigned)(digit - 'a' + 10);
    else if (digit >= 'A' && digit <= 'F') value += (unsigned)(digit - 'A' + 10);
    else json->failed = 1;
  }
  return value;
}

/* A JSON string, unescaped to UTF-8. The pipeline quotes the output path
 * with JSON escapes, so every escape lands here. */
static char *json_string(Json *json) {
  if (json_expect(json, '"') != 0) return NULL;
  ByteBuffer out;
  buffer_init(&out);
  while (json->cursor < json->end && *json->cursor != '"') {
    char byte = *json->cursor++;
    if ((unsigned char)byte < 0x20) {
      json->failed = 1;
      break;
    }
    if (byte != '\\') {
      buffer_put_byte(&out, (unsigned char)byte);
      continue;
    }
    if (json->cursor >= json->end) {
      json->failed = 1;
      break;
    }
    char escape = *json->cursor++;
    switch (escape) {
      case '"':
      case '\\':
      case '/':
        buffer_put_byte(&out, (unsigned char)escape);
        break;
      case 'b':
        buffer_put_byte(&out, '\b');
        break;
      case 'f':
        buffer_put_byte(&out, '\f');
        break;
      case 'n':
        buffer_put_byte(&out, '\n');
        break;
      case 'r':
        buffer_put_byte(&out, '\r');
        break;
      case 't':
        buffer_put_byte(&out, '\t');
        break;
      case 'u': {
        unsigned code = json_hex4(json);
        if (json->failed) break;
        if (code >= 0xd800 && code <= 0xdbff && json->cursor + 1 < json->end &&
            json->cursor[0] == '\\' && json->cursor[1] == 'u') {
          json->cursor += 2;
          unsigned low = json_hex4(json);
          if (!json->failed && low >= 0xdc00 && low <= 0xdfff)
            code = 0x10000 + ((code - 0xd800) << 10) + (low - 0xdc00);
          else
            json->failed = 1;
        }
        json_put_utf8(&out, code);
        break;
      }
      default:
        json->failed = 1;
        break;
    }
    if (json->failed) break;
  }
  if (json_expect(json, '"') != 0) {
    buffer_free(&out);
    return NULL;
  }
  if (json->failed || out.length > ARG_MAX_BYTES) {
    json->failed = 1;
    buffer_free(&out);
    return NULL;
  }
  buffer_put_byte(&out, 0);
  return out.data;
}

static int json_skip_value(Json *json);

static int json_skip_composite(Json *json, char open, char close) {
  if (json_expect(json, open) != 0) return -1;
  json_whitespace(json);
  if (json->cursor < json->end && *json->cursor == close) {
    json->cursor++;
    return 0;
  }
  for (;;) {
    if (open == '{') {
      char *key = json_string(json);
      free(key);
      if (json->failed) return -1;
      if (json_expect(json, ':') != 0) return -1;
    }
    if (json_skip_value(json) != 0) return -1;
    json_whitespace(json);
    if (json->cursor < json->end && *json->cursor == ',') {
      json->cursor++;
      continue;
    }
    return json_expect(json, close);
  }
}

static int json_skip_value(Json *json) {
  json_whitespace(json);
  if (json->cursor >= json->end) {
    json->failed = 1;
    return -1;
  }
  char lead = *json->cursor;
  if (lead == '{') return json_skip_composite(json, '{', '}');
  if (lead == '[') return json_skip_composite(json, '[', ']');
  if (lead == '"') {
    char *text = json_string(json);
    free(text);
    return json->failed ? -1 : 0;
  }
  if (lead == 't' || lead == 'f' || lead == 'n') {
    const char *word = lead == 't' ? "true" : lead == 'f' ? "false" : "null";
    size_t length = strlen(word);
    if ((size_t)(json->end - json->cursor) < length ||
        strncmp(json->cursor, word, length) != 0) {
      json->failed = 1;
      return -1;
    }
    json->cursor += length;
    return 0;
  }
  if (lead == '-' || (lead >= '0' && lead <= '9')) {
    while (json->cursor < json->end && strchr("-+0123456789.eE", *json->cursor) != NULL)
      json->cursor++;
    return 0;
  }
  json->failed = 1;
  return -1;
}

typedef struct {
  char *command;
  char **args;
  size_t args_length;
  char *output;
} Launch;

static void launch_free(Launch *launch) {
  free(launch->command);
  for (size_t i = 0; i < launch->args_length; i++) free(launch->args[i]);
  free(launch->args);
  free(launch->output);
  memset(launch, 0, sizeof(*launch));
}

/* Parses {"launch":{"command":C,"args":[...],"output":O}}; keys in any
 * order, unknown keys skipped. Returns 0 with the launch filled in. */
static int parse_launch(const char *line, Launch *launch) {
  memset(launch, 0, sizeof(*launch));
  Json json;
  json.cursor = line;
  json.end = line + strlen(line);
  json.failed = 0;
  if (json_expect(&json, '{') != 0) return -1;
  for (;;) {
    json_whitespace(&json);
    if (json.cursor < json.end && *json.cursor == '}') {
      json.cursor++;
      break;
    }
    char *key = json_string(&json);
    if (json.failed || key == NULL) {
      free(key);
      launch_free(launch);
      return -1;
    }
    int is_launch = strcmp(key, "launch") == 0;
    free(key);
    if (json_expect(&json, ':') != 0) {
      launch_free(launch);
      return -1;
    }
    if (!is_launch) {
      if (json_skip_value(&json) != 0) {
        launch_free(launch);
        return -1;
      }
    } else {
      if (json_expect(&json, '{') != 0) {
        launch_free(launch);
        return -1;
      }
      for (;;) {
        json_whitespace(&json);
        if (json.cursor < json.end && *json.cursor == '}') {
          json.cursor++;
          break;
        }
        char *inner = json_string(&json);
        if (json.failed || inner == NULL) {
          free(inner);
          launch_free(launch);
          return -1;
        }
        int is_command = strcmp(inner, "command") == 0;
        int is_args = strcmp(inner, "args") == 0;
        int is_output = strcmp(inner, "output") == 0;
        free(inner);
        if (json_expect(&json, ':') != 0) {
          launch_free(launch);
          return -1;
        }
        if (is_command && launch->command == NULL) {
          launch->command = json_string(&json);
          if (json.failed) {
            launch_free(launch);
            return -1;
          }
        } else if (is_output && launch->output == NULL) {
          launch->output = json_string(&json);
          if (json.failed) {
            launch_free(launch);
            return -1;
          }
        } else if (is_args && launch->args == NULL) {
          if (json_expect(&json, '[') != 0) {
            launch_free(launch);
            return -1;
          }
          size_t capacity = 0;
          for (;;) {
            json_whitespace(&json);
            if (json.cursor < json.end && *json.cursor == ']') {
              json.cursor++;
              break;
            }
            if (launch->args_length >= ARGS_MAX) {
              json.failed = 1;
              launch_free(launch);
              return -1;
            }
            char *arg = json_string(&json);
            if (json.failed || arg == NULL) {
              free(arg);
              launch_free(launch);
              return -1;
            }
            if (launch->args_length >= capacity) {
              capacity = capacity == 0 ? 16 : capacity * 2;
              launch->args =
                  (char **)checked_realloc(launch->args, capacity * sizeof(char *));
            }
            launch->args[launch->args_length++] = arg;
            json_whitespace(&json);
            if (json.cursor < json.end && *json.cursor == ',') {
              json.cursor++;
              continue;
            }
            if (json_expect(&json, ']') != 0) {
              launch_free(launch);
              return -1;
            }
            break;
          }
        } else {
          if (json_skip_value(&json) != 0) {
            launch_free(launch);
            return -1;
          }
        }
        json_whitespace(&json);
        if (json.cursor < json.end && *json.cursor == ',') {
          json.cursor++;
          continue;
        }
        if (json_expect(&json, '}') != 0) {
          launch_free(launch);
          return -1;
        }
        break;
      }
    }
    json_whitespace(&json);
    if (json.cursor < json.end && *json.cursor == ',') {
      json.cursor++;
      continue;
    }
    if (json_expect(&json, '}') != 0) {
      launch_free(launch);
      return -1;
    }
    break;
  }
  json_whitespace(&json);
  if (json.failed || json.cursor != json.end || launch->command == NULL ||
      launch->output == NULL || launch->args == NULL) {
    launch_free(launch);
    return -1;
  }
  return 0;
}

/* True for {"stop":true} / {"cancel":true} modulo whitespace. */
static int is_command_line(const char *line, const char *command) {
  Json json;
  json.cursor = line;
  json.end = line + strlen(line);
  json.failed = 0;
  if (json_expect(&json, '{') != 0) return 0;
  char *key = json_string(&json);
  if (json.failed || key == NULL) {
    free(key);
    return 0;
  }
  int matches = strcmp(key, command) == 0;
  free(key);
  if (!matches || json_expect(&json, ':') != 0) return 0;
  json_whitespace(&json);
  if ((size_t)(json.end - json.cursor) < 4 || strncmp(json.cursor, "true", 4) != 0)
    return 0;
  json.cursor += 4;
  if (json_expect(&json, '}') != 0) return 0;
  json_whitespace(&json);
  return !json.failed && json.cursor == json.end;
}

/* ------------------------------------------------------------------ */
/* Encoder supervision                                                  */
/* ------------------------------------------------------------------ */

typedef struct {
  const char *encoder;
  unsigned long long max_bytes;
  unsigned long long max_seconds;
  PortalSession portal;
  pid_t child;
  int stop_sent;
  struct timespec launched_at;
  pid_t parent;
  char *output;
} Run;

static unsigned long long monotonic_ms(void) {
  struct timespec now;
  (void)clock_gettime(CLOCK_MONOTONIC, &now);
  return (unsigned long long)now.tv_sec * 1000u +
      (unsigned long long)now.tv_nsec / 1000000u;
}

/* Asks the encoder to finish: SIGINT under -e writes the trailer (EOS)
 * and exits. Only the person's cancel ends it at once (SIGKILL). */
static void stop_child(Run *run) {
  if (run->child < 0 || run->stop_sent) return;
  run->stop_sent = 1;
  (void)kill(run->child, SIGINT);
}

static void kill_child(Run *run) {
  if (run->child < 0) return;
  (void)kill(run->child, SIGKILL);
}

/* Spawns the bound encoder with the portal descriptor inherited and
 * nothing else of ours: stdio is redirected, every other descriptor of
 * ours stays close-on-exec. Returns 0 with run->child set. */
static int spawn_encoder(Run *run, const Launch *launch) {
  if (fcntl(run->portal.fd, F_SETFD, 0) != 0) return -1;
  size_t argc = launch->args_length + 3;
  char **argv = (char **)checked_malloc(argc * sizeof(char *));
  argv[0] = (char *)run->encoder;
  argv[1] = (char *)"-e";
  for (size_t i = 0; i < launch->args_length; i++) argv[i + 2] = launch->args[i];
  argv[argc - 1] = NULL;
  /* Our own pid, so the child can tell a live parent from a reparent. */
  pid_t self = getpid();
  pid_t child = fork();
  if (child < 0) {
    free(argv);
    return -1;
  }
  if (child == 0) {
    /* The child: die with the parent, then become the encoder. */
    if (prctl(PR_SET_PDEATHSIG, SIGKILL) != 0) _exit(127);
    if (getppid() != self) _exit(127);
    int devnull = open("/dev/null", O_RDWR | O_CLOEXEC);
    if (devnull < 0) _exit(127);
    if (dup2(devnull, STDIN_FILENO) < 0) _exit(127);
    if (dup2(devnull, STDOUT_FILENO) < 0) _exit(127);
    if (devnull != STDIN_FILENO && devnull != STDOUT_FILENO) close(devnull);
    /* stderr stays inherited: a hand run shows the encoder's own words. */
    execv(run->encoder, argv);
    _exit(127);
  }
  free(argv);
  run->child = child;
  (void)clock_gettime(CLOCK_MONOTONIC, &run->launched_at);
  return 0;
}

/* Reaps the encoder without blocking: 1 and the exit status when it is
 * gone, 0 while it runs, -1 on error. */
static int reap_child(Run *run, int *exit_code) {
  int status = 0;
  pid_t done = waitpid(run->child, &status, WNOHANG);
  if (done < 0) {
    if (errno == EINTR) return 0;
    return -1;
  }
  if (done == 0) return 0;
  run->child = -1;
  if (WIFEXITED(status)) {
    *exit_code = WEXITSTATUS(status);
    return 1;
  }
  *exit_code = 128;
  return 1;
}

/* The supervision tick: the launch line's size and lifetime, the
 * parent's life. Reaching a bound asks the encoder to finish, exactly
 * like the person's stop; only a dead parent ends it outright. Returns 1
 * when the parent is gone. */
static int supervise_tick(Run *run) {
  if (getppid() != run->parent) return 1;
  if (run->child < 0) return 0;
  if (run->max_seconds > 0) {
    unsigned long long launched_ms =
        (unsigned long long)run->launched_at.tv_sec * 1000u +
        (unsigned long long)run->launched_at.tv_nsec / 1000000u;
    /* Compared in seconds: the launch line's bound never overflows. */
    if ((monotonic_ms() - launched_ms) / 1000u >= run->max_seconds) stop_child(run);
  }
  if (run->max_bytes > 0 && run->output != NULL) {
    struct stat info;
    if (stat(run->output, &info) == 0 && (unsigned long long)info.st_size >= run->max_bytes)
      stop_child(run);
  }
  return 0;
}

/* Drains one bus datagram's signals: a Closed session ends the run. The
 * bus carries nothing else this phase reads. */
static int pump_revocation(Bus *bus, const char *session_path, int *revoked) {
  *revoked = 0;
  for (;;) {
    Header header;
    Cursor body;
    int *fds = NULL;
    size_t fds_length = 0;
    int ready = bus_next(bus, &header, &body, &fds, &fds_length);
    if (ready < 0) return -1;
    if (ready == 0) return 0;
    if (
        header.type == 4 && header.interface != NULL && header.member != NULL &&
        header.path != NULL &&
        strcmp(header.interface, PORTAL_SESSION_IFACE) == 0 &&
        strcmp(header.member, "Closed") == 0 &&
        strcmp(header.path, session_path) == 0)
      *revoked = 1;
    close_message_fds(fds, fds_length);
    header_free(&header);
    body_free(&body);
    if (*revoked) return 0;
  }
}

static int run_record_loop(Bus *bus, Run *run, StdinReader *commands) {
  for (;;) {
    struct pollfd watched[2];
    watched[0].fd = bus->fd;
    watched[0].events = POLLIN;
    watched[0].revents = 0;
    watched[1].fd = STDIN_FILENO;
    watched[1].events = POLLIN;
    watched[1].revents = 0;
    int waiting = poll(watched, 2, 100);
    if (waiting < 0) {
      if (errno == EINTR) continue;
      return -1;
    }
    if ((watched[0].revents & (POLLIN | POLLHUP | POLLERR | POLLNVAL)) != 0) {
      if (bus_fill(bus) <= 0) {
        diag("the bus went away");
        return -1;
      }
      int revoked = 0;
      if (pump_revocation(bus, run->portal.session_path, &revoked) != 0) return -1;
      if (revoked) {
        kill_child(run);
        print_closed();
        return 2;
      }
    }
    if ((watched[1].revents & (POLLIN | POLLHUP | POLLERR | POLLNVAL)) != 0) {
      int filled = stdin_fill(commands);
      if (commands->eof || commands->overlong) {
        kill_child(run);
        return 3;
      }
      if (filled) {
        char *line = NULL;
        int stop = 0;
        int cancel = 0;
        while ((line = stdin_take_line(commands)) != NULL) {
          if (is_command_line(line, "stop")) stop = 1;
          else if (is_command_line(line, "cancel")) cancel = 1;
          else diag("ignoring an unknown command");
          free(line);
        }
        if (cancel) {
          kill_child(run);
          return 3;
        }
        if (stop) stop_child(run);
      }
    }
    if (supervise_tick(run)) {
      kill_child(run);
      return 4;
    }
    if (run->child >= 0) {
      int exit_code = 0;
      int reaped = reap_child(run, &exit_code);
      if (reaped < 0) return -1;
      if (reaped > 0) return exit_code == 0 ? 0 : 1;
    }
  }
}

/* ------------------------------------------------------------------ */
/* Portal mode                                                          */
/* ------------------------------------------------------------------ */

static int parse_number(const char *text, unsigned long long *out) {
  if (text[0] == '\0') return -1;
  for (const char *at = text; *at != '\0'; at++) {
    if (!isdigit((unsigned char)*at)) return -1;
  }
  errno = 0;
  char *end = NULL;
  unsigned long long value = strtoull(text, &end, 10);
  if (errno != 0 || end == text || *end != '\0') return -1;
  *out = value;
  return 0;
}

static int run_portal_mode(
    const char *encoder,
    unsigned long long max_bytes,
    unsigned long long max_seconds) {
  Run run;
  memset(&run, 0, sizeof(run));
  run.encoder = encoder;
  run.max_bytes = max_bytes;
  run.max_seconds = max_seconds;
  run.child = -1;
  run.parent = getppid();
  StdinReader commands;
  stdin_init(&commands);

  int fd = bus_connect();
  if (fd < 0) {
    print_error("unavailable");
    stdin_free(&commands);
    return 1;
  }
  Bus bus;
  bus_init(&bus, fd);
  int status = 1;
  const char *error = NULL;
  do {
    if (bus_auth(bus.fd) != 0 || bus_hello(&bus) != 0) {
      error = "unavailable";
      break;
    }
    char rule[256];
    (void)snprintf(
        rule, sizeof(rule), "type='signal',sender='%s'", PORTAL_BUS_NAME);
    if (bus_add_match(&bus, rule) != 0) {
      error = "unavailable";
      break;
    }
    error = run_portal_flow(&bus, &commands, &run.portal);
    if (error != NULL) break;
    print_sources(run.portal.fd, run.portal.node);
    /* The launch line follows the sources; anything else this early is
     * the host disagreeing with itself. */
    Launch launch;
    memset(&launch, 0, sizeof(launch));
    int launched = 0;
    int parent_quiet = 0;
    for (;;) {
      struct pollfd watched[2];
      watched[0].fd = bus.fd;
      watched[0].events = POLLIN;
      watched[0].revents = 0;
      watched[1].fd = STDIN_FILENO;
      watched[1].events = POLLIN;
      watched[1].revents = 0;
      int waiting = poll(watched, 2, 100);
      if (waiting < 0) {
        if (errno == EINTR) continue;
        error = "failed";
        break;
      }
      if (getppid() != run.parent) {
        /* Nobody is listening: close the session and exit quietly. */
        parent_quiet = 1;
        break;
      }
      if ((watched[0].revents & (POLLIN | POLLHUP | POLLERR | POLLNVAL)) != 0) {
        if (bus_fill(&bus) <= 0) {
          error = "failed";
          break;
        }
        int revoked = 0;
        if (pump_revocation(&bus, run.portal.session_path, &revoked) != 0) {
          error = "failed";
          break;
        }
        if (revoked) {
          print_closed();
          error = "revoked";
          break;
        }
      }
      if ((watched[1].revents & (POLLIN | POLLHUP | POLLERR | POLLNVAL)) != 0) {
        int filled = stdin_fill(&commands);
        if (commands.eof || commands.overlong) {
          error = "cancelled";
          break;
        }
        if (!filled) continue;
        char *line = stdin_take_line(&commands);
        if (line == NULL) continue;
        if (is_command_line(line, "cancel")) {
          free(line);
          error = "cancelled";
          break;
        }
        if (parse_launch(line, &launch) != 0) {
          diag("the launch line refused to parse");
          free(line);
          error = "failed";
          break;
        }
        free(line);
        if (strcmp(launch.command, run.encoder) != 0 || launch.output[0] != '/') {
          diag("the launch names another encoder or a relative output");
          launch_free(&launch);
          error = "failed";
          break;
        }
        /* The output path outlives the launch: the supervisor stats it. */
        run.output = launch.output;
        launch.output = NULL;
        int spawned = spawn_encoder(&run, &launch);
        launch_free(&launch);
        if (spawned != 0) {
          diag("the encoder would not start");
          error = "failed";
          break;
        }
        launched = 1;
        break;
      }
    }
    if (error != NULL) break;
    if (parent_quiet) {
      status = 1;
      error = NULL;
      break;
    }
    if (!launched) {
      error = "failed";
      break;
    }
    int outcome = run_record_loop(&bus, &run, &commands);
    portal_close_session(&bus, run.portal.session_path);
    if (outcome == 0) {
      print_complete();
      status = 0;
    } else if (outcome == 2) {
      error = "revoked";
    } else if (outcome == 3) {
      error = "cancelled";
    } else if (outcome == 4) {
      /* Our parent is gone: nothing is listening, so exit quietly. */
      status = 1;
      error = NULL;
      break;
    } else {
      error = "failed";
    }
  } while (0);
  if (error != NULL) print_error(error);
  if (run.child >= 0) {
    kill_child(&run);
    int exit_code = 0;
    (void)reap_child(&run, &exit_code);
  }
  if (run.portal.created) portal_close_session(&bus, run.portal.session_path);
  if (run.portal.fd >= 0) close(run.portal.fd);
  free(run.output);
  bus_free(&bus);
  stdin_free(&commands);
  return status;
}

/* ------------------------------------------------------------------ */

static void usage(void) {
  (void)fprintf(
      stderr,
      "usage: %s --self-test | --probe | --portal "
      "--encoder <path> --max-bytes <n> --max-seconds <n>\n",
      program_name);
}

int main(int argc, char **argv) {
  if (argc > 0 && argv[0] != NULL) {
    const char *slash = strrchr(argv[0], '/');
    program_name = slash == NULL ? argv[0] : slash + 1;
  }
  /* A dead host must not kill the helper with SIGPIPE: EOF on stdin
   * ends the run instead. Files the encoder writes stay owner-only. */
  (void)signal(SIGPIPE, SIG_IGN);
  (void)umask(0077);
  if (argc == 2 && strcmp(argv[1], "--self-test") == 0) {
    print_line("muse-portal-record-ready");
    return 0;
  }
  if (argc == 2 && strcmp(argv[1], "--probe") == 0) return run_probe();
  if (argc == 8 && strcmp(argv[1], "--portal") == 0) {
    const char *encoder = NULL;
    unsigned long long max_bytes = 0;
    unsigned long long max_seconds = 0;
    int has_bytes = 0;
    int has_seconds = 0;
    for (int i = 2; i < argc; i += 2) {
      if (strcmp(argv[i], "--encoder") == 0) encoder = argv[i + 1];
      else if (strcmp(argv[i], "--max-bytes") == 0)
        has_bytes = parse_number(argv[i + 1], &max_bytes) == 0;
      else if (strcmp(argv[i], "--max-seconds") == 0)
        has_seconds = parse_number(argv[i + 1], &max_seconds) == 0;
      else {
        usage();
        return 2;
      }
    }
    if (encoder == NULL || encoder[0] != '/' || !has_bytes || !has_seconds) {
      usage();
      return 2;
    }
    return run_portal_mode(encoder, max_bytes, max_seconds);
  }
  usage();
  return 2;
}
