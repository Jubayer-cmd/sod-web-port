package javax.microedition.midlet;

import java.util.Hashtable;
import sodweb.Host;

public abstract class MIDlet {
    private static final Hashtable PROPS = new Hashtable();

    static {
        // Values from the original .jad. The URL-* entries pointed at a third-party mirror,
        // so they are blanked: platformRequest() never leaves the page anyway.
        PROPS.put("MIDlet-Name", "Soul Of Darkness");
        PROPS.put("MIDlet-Vendor", "Gameloft SA");
        PROPS.put("MIDlet-Version", "1.0.1");
        PROPS.put("MIDlet-Data-Size", "2046");
        PROPS.put("URL-GLIVE", "0");
        PROPS.put("URL-PT", "0");
        PROPS.put("IGP-PROMOS", "RF08=RF08;ASCR=ASCR;NYN2=NYN2;");
        PROPS.put("IGP-WN", "BLB2=BLB2_WN;MIDP=MIDP_WN;LNUR=LNUR_WN;DITW=DITW_WN;");
        PROPS.put("IGP-BS", "MBRC=MBRC_BS;MPL2=MPL2_BS;CSIM=CSIM_BS;BUBA=BUBA_BS;");
        PROPS.put("IGP-CATEGORIES", "WN=WN;BS=BS;PROMO=PROMO;OP=OP;");
        PROPS.put("IGP-VERSION", "1.8");
    }

    protected MIDlet() {
    }

    protected abstract void startApp() throws MIDletStateChangeException;

    protected abstract void pauseApp();

    protected abstract void destroyApp(boolean unconditional) throws MIDletStateChangeException;

    public final String getAppProperty(String key) {
        return (String) PROPS.get(key);
    }

    public final void notifyDestroyed() {
        Host.exit();
    }

    public final void notifyPaused() {
    }

    public final void resumeRequest() {
    }

    public final boolean platformRequest(String url) {
        Host.log("platformRequest ignored: " + url);
        return false;
    }

    /** Entry used by the launcher; startApp is protected in MIDP. */
    public final void launch() throws MIDletStateChangeException {
        startApp();
    }
}
