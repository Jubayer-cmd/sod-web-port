package javax.microedition.lcdui;

import java.io.IOException;
import java.io.InputStream;
import sodweb.PngDecoder;

/** MIDP Image backed by a plain ARGB int[] so every blit is pixel-exact. */
public class Image {
    final int width;
    final int height;
    final int[] pixels;
    private final boolean mutable;

    Image(int width, int height, int[] pixels, boolean mutable) {
        this.width = width;
        this.height = height;
        this.pixels = pixels;
        this.mutable = mutable;
    }

    public static Image createImage(int width, int height) {
        if (width <= 0 || height <= 0) {
            throw new IllegalArgumentException();
        }
        int[] px = new int[width * height];
        for (int i = 0; i < px.length; i++) {
            px[i] = 0xFFFFFFFF; // MIDP: new mutable images are opaque white
        }
        return new Image(width, height, px, true);
    }

    public static Image createImage(byte[] data, int offset, int length) {
        PngDecoder.Result r = PngDecoder.decode(data, offset, length);
        return new Image(r.width, r.height, r.argb, false);
    }

    public static Image createImage(String name) throws IOException {
        InputStream in = Image.class.getResourceAsStream(name);
        if (in == null) {
            throw new IOException("resource not found: " + name);
        }
        byte[] buf = new byte[4096];
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
        in.close();
        return createImage(buf, 0, n);
    }

    public static Image createImage(Image source) {
        if (!source.mutable) {
            return source;
        }
        return new Image(source.width, source.height, source.pixels.clone(), false);
    }

    public static Image createRGBImage(int[] rgb, int width, int height, boolean processAlpha) {
        int[] px = new int[width * height];
        if (processAlpha) {
            System.arraycopy(rgb, 0, px, 0, px.length);
        } else {
            for (int i = 0; i < px.length; i++) {
                px[i] = rgb[i] | 0xFF000000;
            }
        }
        return new Image(width, height, px, false);
    }

    public Graphics getGraphics() {
        if (!mutable) {
            throw new IllegalStateException();
        }
        return new Graphics(pixels, width, height);
    }

    public int getWidth() {
        return width;
    }

    public int getHeight() {
        return height;
    }

    public boolean isMutable() {
        return mutable;
    }

    public void getRGB(int[] rgbData, int offset, int scanlength, int x, int y, int w, int h) {
        if (x < 0 || y < 0 || x + w > width || y + h > height) {
            throw new IllegalArgumentException();
        }
        for (int row = 0; row < h; row++) {
            System.arraycopy(pixels, (y + row) * width + x, rgbData, offset + row * scanlength, w);
        }
    }
}
