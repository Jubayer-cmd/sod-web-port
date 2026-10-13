package javax.microedition.lcdui;

import sodweb.Host;

/**
 * Delivers showNotify/hideNotify independently of the game loop, as a handset's system
 * event thread does. These can't go through Canvas.repaint(): the game stops repainting
 * while hidden, so a "shown" event queued there would never be delivered and the game
 * would stay paused forever after the tab is hidden once.
 */
final class SystemEvents implements Runnable {
    private static boolean started;

    private SystemEvents() {
    }

    static void start() {
        if (!started) {
            started = true;
            new Thread(new SystemEvents()).start();
        }
    }

    @Override
    public void run() {
        while (true) {
            int ev;
            while ((ev = Host.pollLifecycle()) != Host.EV_NONE) {
                Displayable d = Display.current;
                if (d == null) {
                    continue;
                }
                try {
                    if (ev == Host.EV_HIDE) {
                        d.hidden();
                    } else if (ev == Host.EV_SHOW) {
                        d.shown();
                    }
                } catch (RuntimeException e) {
                    Host.log("lifecycle handler threw: " + e);
                }
            }
            try {
                Thread.sleep(100);
            } catch (InterruptedException e) {
                return;
            }
        }
    }
}
