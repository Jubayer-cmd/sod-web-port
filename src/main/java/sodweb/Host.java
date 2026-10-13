package sodweb;

import org.teavm.jso.JSBody;
import org.teavm.jso.JSByRef;
import org.teavm.jso.JSObject;

/**
 * The only bridge between the Java side and the browser. Every call lands in the global
 * SODHost object defined in static/host.js, so all DOM / WebAudio / storage code lives in
 * one hand-written JS file instead of being scattered through the MIDP classes.
 */
public final class Host {
    public static final int SCREEN_W = 240;
    public static final int SCREEN_H = 320;

    // Event types produced by SODHost.pollEvent()
    public static final int EV_NONE = 0;
    public static final int EV_KEY_DOWN = 1;
    public static final int EV_KEY_UP = 2;
    public static final int EV_POINTER_DOWN = 3;
    public static final int EV_POINTER_UP = 4;
    public static final int EV_POINTER_DRAG = 5;
    public static final int EV_HIDE = 6;
    public static final int EV_SHOW = 7;

    private Host() {
    }

    // ---- video ----
    @JSBody(params = { "px", "w", "h" }, script = "SODHost.present(px, w, h);")
    public static native void present(@JSByRef int[] px, int w, int h);

    // ---- input ----
    @JSBody(script = "return SODHost.pollEvent();")
    public static native int pollEvent();

    /** Show/hide events, kept apart from input so they arrive even while the game is paused. */
    @JSBody(script = "return SODHost.pollLifecycle();")
    public static native int pollLifecycle();

    @JSBody(script = "return SODHost.eventA;")
    public static native int eventA();

    @JSBody(script = "return SODHost.eventB;")
    public static native int eventB();

    // ---- text (rasterised by the browser, blended by Graphics) ----
    @JSBody(params = { "text", "font" }, script = "return SODHost.rasterText(text, font);")
    public static native TextRaster rasterText(String text, String font);

    @JSBody(params = { "text", "font" }, script = "return SODHost.measureText(text, font);")
    public static native int measureText(String text, String font);

    // ---- audio ----
    @JSBody(params = { "data", "type" }, script = "return SODHost.audioCreate(data, type);")
    public static native int audioCreate(@JSByRef byte[] data, String type);

    @JSBody(params = { "id", "loops" }, script = "SODHost.audioStart(id, loops);")
    public static native void audioStart(int id, int loops);

    @JSBody(params = { "id" }, script = "SODHost.audioStop(id);")
    public static native void audioStop(int id);

    @JSBody(params = { "id" }, script = "SODHost.audioClose(id);")
    public static native void audioClose(int id);

    @JSBody(params = { "id" }, script = "return SODHost.audioPlaying(id);")
    public static native boolean audioPlaying(int id);

    // ---- persistent storage (RecordStore) ----
    @JSBody(params = { "key" }, script = "var v = localStorage.getItem(key); return v === null ? null : v;")
    public static native String storageGet(String key);

    @JSBody(params = { "key", "value" }, script = "localStorage.setItem(key, value);")
    public static native void storageSet(String key, String value);

    @JSBody(params = { "key" }, script = "localStorage.removeItem(key);")
    public static native void storageRemove(String key);

    // ---- lifecycle ----
    @JSBody(script = "SODHost.exit();")
    public static native void exit();

    @JSBody(params = { "msg" }, script = "console.log(msg);")
    public static native void log(String msg);

    /** Alpha-coverage bitmap of a rendered string. */
    public interface TextRaster extends JSObject {
        @org.teavm.jso.JSProperty
        int getWidth();

        @org.teavm.jso.JSProperty
        int getHeight();

        @org.teavm.jso.JSProperty
        int getAscent();
    }

    @JSBody(params = { "r", "i" }, script = "return r.alpha[i];")
    public static native int alphaAt(TextRaster r, int i);
}
