package io.polycode;

import java.io.*;

public class NotifyingInputStream extends FilterInputStream {
  private final PrintStream control;
  private long lastPingNanos = 0L;

  public NotifyingInputStream(InputStream in, PrintStream control) {
    super(in);
    this.control = control;
  }

  private void ping() {
    long now = System.nanoTime();
    // Limit to ~100ms between pings to avoid spam
    if (now - lastPingNanos > 100_000_000L) {
      control.print("[[CTRL]]:stdin_req\n");
      control.flush();
      lastPingNanos = now;
    }
  }

  @Override public int read() throws IOException { ping(); return super.read(); }
  @Override public int read(byte[] b, int off, int len) throws IOException { ping(); return super.read(b, off, len); }
  @Override public int read(byte[] b) throws IOException { ping(); return super.read(b); }
}
