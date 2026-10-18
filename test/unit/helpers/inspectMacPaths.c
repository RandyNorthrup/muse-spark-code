// Property fixture uses the production macOS canonicalizer and component policy verbatim.
#define main inspect_main
#include "../../../native/confine/MuseSparkConfineMac.c"
#undef main
int main(int argc, char **argv) {
  for (int i = 1; i < argc; i++) {
    char canonical[PATH_MAX];
    if (!canonical_path(argv[i], canonical)) return JUDGE_FAST_B1_REFUSED_EXIT;
    printf("%s\t%d\t%d\n", canonical, private_path(argv[i]), private_path(canonical));
  }
  return 0;
}
