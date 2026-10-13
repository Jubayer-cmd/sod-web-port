package javax.microedition.lcdui;

import sodweb.Host;
import sodweb.Input;

/**
 * MIDP Canvas. repaint() is synchronous here: it drains queued browser input, runs paint()
 * on the game thread and presents the frame. Real handsets serialise input and paint on one
 * event thread too, so the game never sees input arrive in the middle of a frame.
 */
public abstract class Canvas extends Displayable {
    public static final int UP = 1;
    public static final int DOWN = 6;
    public static final int LEFT = 2;
    public static final int RIGHT = 5;
    public static final int FIRE = 8;
    public static final int GAME_A = 9;
    public static final int GAME_B = 10;
    public static final int GAME_C = 11;
    public static final int GAME_D = 12;
    public static final int KEY_NUM0 = 48;
    public static final int KEY_NUM1 = 49;
    public static final int KEY_NUM2 = 50;
    public static final int KEY_NUM3 = 51;
    public static final int KEY_NUM4 = 52;
    public static final int KEY_NUM5 = 53;
    public static final int KEY_NUM6 = 54;
    public static final int KEY_NUM7 = 55;
    public static final int KEY_NUM8 = 56;
    public static final int KEY_NUM9 = 57;
    public static final int KEY_STAR = 42;
    public static final int KEY_POUND = 35;

    private static int[] screen;
    private static int okHeldAs; // real key code the virtual OK key was pressed as
    private static Graphics screenGraphics;

    protected Canvas() {
        if (screen == null) {
            screen = new int[Host.SCREEN_W * Host.SCREEN_H];
            screenGraphics = new Graphics(screen, Host.SCREEN_W, Host.SCREEN_H);
        }
    }

    public void setFullScreenMode(boolean mode) {
    }

    public boolean isDoubleBuffered() {
        return true;
    }

    public boolean hasPointerEvents() {
        return true;
    }

    public boolean hasPointerMotionEvents() {
        return true;
    }

    public boolean hasRepeatEvents() {
        return false;
    }

    public int getGameAction(int keyCode) {
        switch (keyCode) {
            case -1: case KEY_NUM2: return UP;
            case -2: case KEY_NUM8: return DOWN;
            case -3: case KEY_NUM4: return LEFT;
            case -4: case KEY_NUM6: return RIGHT;
            case -5: case KEY_NUM5: return FIRE;
            case KEY_NUM7: return GAME_A;
            case KEY_NUM9: return GAME_B;
            case KEY_STAR: return GAME_C;
            case KEY_POUND: return GAME_D;
            default: return 0;
        }
    }

    public int getKeyCode(int gameAction) {
        switch (gameAction) {
            case UP: return -1;
            case DOWN: return -2;
            case LEFT: return -3;
            case RIGHT: return -4;
            case FIRE: return -5;
            default: return 0;
        }
    }

    public String getKeyName(int keyCode) {
        return String.valueOf(keyCode);
    }

    public final void repaint() {
        if (Display.current != this) {
            return;
        }
        dispatchEvents();
        screenGraphics.reset();
        paint(screenGraphics);
        Host.present(screen, Host.SCREEN_W, Host.SCREEN_H);
    }

    public final void repaint(int x, int y, int w, int h) {
        repaint();
    }

    public final void serviceRepaints() {
    }

    private void dispatchEvents() {
        int type;
        while ((type = Host.pollEvent()) != Host.EV_NONE) {
            int a = Host.eventA();
            int b = Host.eventB();
            try {
                switch (type) {
                    case Host.EV_KEY_DOWN:
                        if (a == Input.VK_OK) {
                            okHeldAs = Input.resolveOk();
                            a = okHeldAs;
                        }
                        keyPressed(a);
                        break;
                    case Host.EV_KEY_UP:
                        // Release what was pressed, even if the screen changed meanwhile.
                        keyReleased(a == Input.VK_OK ? okHeldAs : a);
                        break;
                    case Host.EV_POINTER_DOWN: pointerPressed(a, b); break;
                    case Host.EV_POINTER_UP: pointerReleased(a, b); break;
                    case Host.EV_POINTER_DRAG: pointerDragged(a, b); break;
                    default: break;
                }
            } catch (RuntimeException e) {
                Host.log("input handler threw: " + e);
            }
            // The game polls touch/key state once per frame, so a press must survive at least
            // one paint() before its release is delivered, as it would under a real finger.
            if (type == Host.EV_KEY_DOWN || type == Host.EV_POINTER_DOWN) {
                break;
            }
        }
    }

    @Override
    void shown() {
        showNotify();
    }

    @Override
    void hidden() {
        hideNotify();
    }

    protected abstract void paint(Graphics g);

    protected void keyPressed(int keyCode) {
    }

    protected void keyReleased(int keyCode) {
    }

    protected void keyRepeated(int keyCode) {
    }

    protected void pointerPressed(int x, int y) {
    }

    protected void pointerReleased(int x, int y) {
    }

    protected void pointerDragged(int x, int y) {
    }

    protected void showNotify() {
    }

    protected void hideNotify() {
    }

    protected void sizeChanged(int w, int h) {
    }
}
