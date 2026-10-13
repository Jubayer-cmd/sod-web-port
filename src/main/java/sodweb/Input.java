package sodweb;

/**
 * Virtual keys the browser can send that resolve to a real MIDP key code only when
 * delivered, based on what the game is showing at that moment.
 */
public final class Input {
    /** "OK": the left soft key on most screens, Fire on screens that act on a held Fire/5. */
    public static final int VK_OK = 1000;

    public interface Resolver {
        int resolveOk();
    }

    private static Resolver resolver;

    private Input() {
    }

    public static void setResolver(Resolver r) {
        resolver = r;
    }

    public static int resolveOk() {
        return resolver != null ? resolver.resolveOk() : -6;
    }
}
