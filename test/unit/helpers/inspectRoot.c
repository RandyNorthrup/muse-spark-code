#define getuid root_uid
#include "../../../native/confine/MuseSparkConfine.c"
uid_t root_uid(void) { return 0; }
