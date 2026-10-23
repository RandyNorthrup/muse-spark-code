// Answers ready five seconds late, so the hold test can prove a late
// respawn is refused. Production builds never define the delay.
#define BLOBHOLD_READY_DELAY_MS 5000
#define main blobhold_main
#include "../../../native/blobhold/MuseSparkBlobHold.c"
#undef main
int main(int argc, char **argv) { return blobhold_main(argc, argv); }
