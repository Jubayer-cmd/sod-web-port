package javax.microedition.lcdui;

import java.util.Vector;
import sodweb.Host;

public abstract class Displayable {
    final Vector commands = new Vector();
    CommandListener listener;

    public void addCommand(Command c) {
        if (!commands.contains(c)) {
            commands.addElement(c);
        }
    }

    public void removeCommand(Command c) {
        commands.removeElement(c);
    }

    public void setCommandListener(CommandListener l) {
        listener = l;
    }

    public int getWidth() {
        return Host.SCREEN_W;
    }

    public int getHeight() {
        return Host.SCREEN_H;
    }

    public boolean isShown() {
        return Display.current == this;
    }

    void shown() {
    }

    void hidden() {
    }
}
