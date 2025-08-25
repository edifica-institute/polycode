package io.polycode;

import java.lang.reflect.Method;

public class Launch {
  // args[0] = user's main class (e.g., Main / aaa)
  public static void main(String[] args) throws Exception {
    if (args.length == 0) {
      System.err.println("Usage: Launch <MainClass> [args...]");
      System.exit(2);
    }

    // Wrap System.in so any blocking read notifies via STDERR
    System.setIn(new NotifyingInputStream(System.in, System.err));

    String mainClass = args[0];
    String[] userArgs = new String[Math.max(0, args.length - 1)];
    if (args.length > 1) System.arraycopy(args, 1, userArgs, 0, userArgs.length);

    Class<?> c = Class.forName(mainClass);
    Method m = c.getMethod("main", String[].class);
    m.invoke(null, (Object) userArgs);
  }
}
