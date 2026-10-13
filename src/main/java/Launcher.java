import sodweb.Input;

/**
 * Browser entry point: boots the original GloftSOFD MIDlet exactly as a handset's AMS would.
 * Lives in the default package because the game's classes do, which also lets it read the
 * game's public screen-state field e.F.
 */
public class Launcher {
    /** e.F value while the weapon-upgrade screen (e.ak) is showing. */
    private static final int SCREEN_UPGRADE = 31;

    public static void main(String[] args) throws Exception {
        // The upgrade screen charges its bar while Fire/5 is *held* and ignores the left soft
        // key, so the web "OK" key (Enter / on-screen OK) acts as Fire there.
        Input.setResolver(() -> e.F == SCREEN_UPGRADE ? -5 : -6);
        new GloftSOFD().launch();
    }
}
