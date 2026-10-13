package javax.microedition.lcdui;

import javax.microedition.midlet.MIDlet;

public class Display {
    private static final Display INSTANCE = new Display();
    static Displayable current;

    private Display() {
    }

    public static Display getDisplay(MIDlet m) {
        SystemEvents.start();
        return INSTANCE;
    }

    public Displayable getCurrent() {
        return current;
    }

    public void setCurrent(Displayable next) {
        if (next == current) {
            return;
        }
        Displayable prev = current;
        current = next;
        if (prev != null) {
            prev.hidden();
        }
        if (next != null) {
            next.shown();
        }
    }

    public boolean vibrate(int ms) {
        return false;
    }

    public boolean flashBacklight(int ms) {
        return false;
    }

    public boolean isColor() {
        return true;
    }

    public int numColors() {
        return 1 << 16;
    }
}
