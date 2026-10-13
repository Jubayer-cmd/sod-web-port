package javax.microedition.media;

import java.io.IOException;
import java.io.InputStream;
import sodweb.WebPlayer;

public final class Manager {
    private Manager() {
    }

    public static Player createPlayer(InputStream in, String type) throws IOException, MediaException {
        byte[] buf = new byte[8192];
        int n = 0;
        int r;
        while ((r = in.read(buf, n, buf.length - n)) > 0) {
            n += r;
            if (n == buf.length) {
                byte[] g = new byte[buf.length * 2];
                System.arraycopy(buf, 0, g, 0, n);
                buf = g;
            }
        }
        byte[] data = new byte[n];
        System.arraycopy(buf, 0, data, 0, n);
        return new WebPlayer(data, type);
    }

    public static String[] getSupportedContentTypes(String protocol) {
        return new String[] { "audio/midi", "audio/x-wav" };
    }

    public static void playTone(int note, int duration, int volume) {
    }
}
