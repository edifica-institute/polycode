/*package io.polycode;

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
    Method m = c.getDeclaredMethod("main", String[].class);

    // allow reflective access across packages
    m.setAccessible(true);

    m.invoke(null, (Object) userArgs);
  }
}*/


package io.polycode;

import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;

public class Launch {

  // args[0] = user's main class (e.g., Main); the rest are user args
  public static void main(String[] args) {
    if (args.length == 0) {
      System.err.println("Usage: Launch <MainClass> [args...]");
      System.exit(2);
    }

    // Wrap System.in so any blocking read notifies via STDERR with the marker [[CTRL]]:stdin_req
    System.setIn(new NotifyingInputStream(System.in, System.err));

    final String mainClass = args[0];
    final String[] userArgs = new String[Math.max(0, args.length - 1)];
    if (args.length > 1) System.arraycopy(args, 1, userArgs, 0, userArgs.length);

    try {
      // Load class & find main(String[])
      Class<?> c = Class.forName(mainClass);
      Thread.currentThread().setContextClassLoader(c.getClassLoader());

      Method m = c.getDeclaredMethod("main", String[].class);
      if (!Modifier.isStatic(m.getModifiers())) {
        System.err.println("Error: " + mainClass + ".main(String[]) must be static.");
        System.exit(2);
      }

      // Allow reflective access across packages on JDK 17+
      m.setAccessible(true);

      try {
        m.invoke(null, (Object) userArgs);
      } catch (InvocationTargetException ite) {
        Throwable cause = ite.getCause();
        if (cause != null) {
          cause.printStackTrace(System.err);
        } else {
          ite.printStackTrace(System.err);
        }
        System.err.flush();
        System.out.flush();
        System.exit(1);
      } catch (IllegalAccessException iae) {
        System.err.println("Unable to call main(String[]) on " + mainClass + ": " + iae);
        iae.printStackTrace(System.err);
        System.err.flush();
        System.out.flush();
        System.exit(1);
      }

    } catch (ClassNotFoundException e) {
      System.err.println("Error: Could not find class '" + mainClass + "'.");
      e.printStackTrace(System.err);
      System.exit(2);
    } catch (NoSuchMethodException e) {
      System.err.println("Error: '" + mainClass + "' does not declare a method:");
      System.err.println("  public static void main(String[] args)");
      e.printStackTrace(System.err);
      System.exit(2);
    } catch (Throwable t) {
      System.err.println("Unexpected error while launching " + mainClass + ":");
      t.printStackTrace(System.err);
      System.exit(1);
    }
  }
}

