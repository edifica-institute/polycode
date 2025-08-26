// java-runner/stdin_notify.c
#define _GNU_SOURCE
#include <dlfcn.h>
#include <unistd.h>
#include <sys/types.h>
#include <sys/uio.h>
#include <stddef.h>
#include <string.h>
#include <stdatomic.h>

typedef ssize_t (*read_fn)(int, void*, size_t);

static read_fn real_read = NULL;
static _Atomic int notified = 0;

__attribute__((constructor))
static void init(void) {
  real_read = (read_fn)dlsym(RTLD_NEXT, "read");
}

ssize_t read(int fd, void *buf, size_t count) {
  if (!real_read) {
    real_read = (read_fn)dlsym(RTLD_NEXT, "read");
  }
  // Only announce when reading from STDIN (fd 0)
  if (fd == 0 && atomic_load(&notified) == 0) {
    static const char *msg = "[[CTRL]]:stdin_req\n";
    (void)write(2, msg, strlen(msg));   // to stderr
    atomic_store(&notified, 1);
  }
  ssize_t r = real_read(fd, buf, count);
  // Once some bytes are read, allow future notifications
  if (fd == 0 && r > 0) {
    atomic_store(&notified, 0);
  }
  return r;
}
