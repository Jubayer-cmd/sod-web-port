package sodweb;

import java.util.zip.DataFormatException;
import java.util.zip.Inflater;

/**
 * Synchronous PNG decoder producing ARGB pixels.
 *
 * MIDP's Image.createImage(byte[]) must return a decoded image immediately, while browser
 * image decoding is always asynchronous, so the port decodes PNGs itself. Gameloft titles
 * also rewrite PLTE/tRNS chunks in memory to recolour sprites, so the bytes are not known
 * ahead of time and cannot be pre-decoded.
 *
 * Supports all standard colour types and bit depths up to 8; no interlacing (J2ME
 * toolchains never emitted it).
 */
public final class PngDecoder {
    private PngDecoder() {
    }

    public static final class Result {
        public final int width;
        public final int height;
        public final int[] argb;

        Result(int width, int height, int[] argb) {
            this.width = width;
            this.height = height;
            this.argb = argb;
        }
    }

    public static Result decode(byte[] d, int off, int len) {
        int end = off + len;
        int p = off + 8; // skip signature
        int width = 0;
        int height = 0;
        int bitDepth = 0;
        int colorType = 0;
        int interlace = 0;
        int[] palette = null;
        int[] paletteAlpha = null;
        int trnsGray = -1;
        int trnsR = -1;
        int trnsG = -1;
        int trnsB = -1;
        byte[] idat = new byte[Math.max(len, 64)];
        int idatLen = 0;

        while (p + 8 <= end) {
            int clen = be32(d, p);
            int type = be32(d, p + 4);
            int c = p + 8;
            if (type == 0x49484452) { // IHDR
                width = be32(d, c);
                height = be32(d, c + 4);
                bitDepth = d[c + 8] & 0xff;
                colorType = d[c + 9] & 0xff;
                interlace = d[c + 12] & 0xff;
            } else if (type == 0x504c5445) { // PLTE
                int n = clen / 3;
                palette = new int[256];
                for (int i = 0; i < n; i++) {
                    palette[i] = ((d[c + i * 3] & 0xff) << 16) | ((d[c + i * 3 + 1] & 0xff) << 8)
                            | (d[c + i * 3 + 2] & 0xff);
                }
            } else if (type == 0x74524e53) { // tRNS
                if (colorType == 3) {
                    paletteAlpha = new int[256];
                    for (int i = 0; i < 256; i++) {
                        paletteAlpha[i] = i < clen ? d[c + i] & 0xff : 255;
                    }
                } else if (colorType == 0) {
                    trnsGray = be16(d, c);
                } else if (colorType == 2) {
                    trnsR = be16(d, c);
                    trnsG = be16(d, c + 2);
                    trnsB = be16(d, c + 4);
                }
            } else if (type == 0x49444154) { // IDAT
                if (idatLen + clen > idat.length) {
                    byte[] grown = new byte[(idatLen + clen) * 2];
                    System.arraycopy(idat, 0, grown, 0, idatLen);
                    idat = grown;
                }
                System.arraycopy(d, c, idat, idatLen, clen);
                idatLen += clen;
            } else if (type == 0x49454e44) { // IEND
                break;
            }
            p = c + clen + 4; // data + CRC
        }
        if (width <= 0 || height <= 0) {
            throw new IllegalArgumentException("PNG: missing IHDR");
        }
        if (interlace != 0) {
            throw new IllegalArgumentException("PNG: interlaced images unsupported");
        }

        int channels;
        switch (colorType) {
            case 0: channels = 1; break;
            case 2: channels = 3; break;
            case 3: channels = 1; break;
            case 4: channels = 2; break;
            case 6: channels = 4; break;
            default: throw new IllegalArgumentException("PNG: bad colour type " + colorType);
        }
        int bitsPerPixel = channels * bitDepth;
        int stride = (width * bitsPerPixel + 7) >> 3;
        int bpp = Math.max(1, bitsPerPixel >> 3);

        byte[] raw = new byte[(stride + 1) * height];
        Inflater inf = new Inflater();
        inf.setInput(idat, 0, idatLen);
        try {
            int got = 0;
            while (got < raw.length && !inf.finished()) {
                int n = inf.inflate(raw, got, raw.length - got);
                if (n == 0 && (inf.needsInput() || inf.needsDictionary())) {
                    break;
                }
                got += n;
            }
        } catch (DataFormatException e) {
            throw new IllegalArgumentException("PNG: corrupt IDAT");
        } finally {
            inf.end();
        }

        // Undo per-scanline filters in place.
        byte[] prev = new byte[stride];
        byte[] cur = new byte[stride];
        int[] out = new int[width * height];
        for (int y = 0; y < height; y++) {
            int rp = y * (stride + 1);
            int filter = raw[rp] & 0xff;
            System.arraycopy(raw, rp + 1, cur, 0, stride);
            for (int i = 0; i < stride; i++) {
                int a = i >= bpp ? cur[i - bpp] & 0xff : 0;
                int b = prev[i] & 0xff;
                int cc = i >= bpp ? prev[i - bpp] & 0xff : 0;
                int x = cur[i] & 0xff;
                switch (filter) {
                    case 1: x += a; break;
                    case 2: x += b; break;
                    case 3: x += (a + b) >> 1; break;
                    case 4: {
                        int pa = Math.abs(b - cc);
                        int pb = Math.abs(a - cc);
                        int pc = Math.abs(a + b - 2 * cc);
                        x += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : cc);
                        break;
                    }
                    default: break;
                }
                cur[i] = (byte) x;
            }
            int row = y * width;
            for (int xIdx = 0; xIdx < width; xIdx++) {
                out[row + xIdx] = pixel(cur, xIdx, colorType, bitDepth, palette, paletteAlpha,
                        trnsGray, trnsR, trnsG, trnsB);
            }
            byte[] t = prev;
            prev = cur;
            cur = t;
        }
        return new Result(width, height, out);
    }

    private static int pixel(byte[] row, int x, int colorType, int depth, int[] pal, int[] palA,
            int trnsGray, int trnsR, int trnsG, int trnsB) {
        switch (colorType) {
            case 3: {
                int idx = sample(row, x, depth);
                int rgb = pal != null ? pal[idx] : 0;
                int a = palA != null ? palA[idx] : 255;
                return (a << 24) | rgb;
            }
            case 0: {
                int g = sample(row, x, depth);
                int a = g == trnsGray ? 0 : 255;
                int v = scale(g, depth);
                return (a << 24) | (v << 16) | (v << 8) | v;
            }
            case 2: {
                int r = row[x * 3] & 0xff;
                int g = row[x * 3 + 1] & 0xff;
                int b = row[x * 3 + 2] & 0xff;
                int a = (r == trnsR && g == trnsG && b == trnsB) ? 0 : 255;
                return (a << 24) | (r << 16) | (g << 8) | b;
            }
            case 4: {
                int g = row[x * 2] & 0xff;
                int a = row[x * 2 + 1] & 0xff;
                return (a << 24) | (g << 16) | (g << 8) | g;
            }
            default: { // 6
                int r = row[x * 4] & 0xff;
                int g = row[x * 4 + 1] & 0xff;
                int b = row[x * 4 + 2] & 0xff;
                int a = row[x * 4 + 3] & 0xff;
                return (a << 24) | (r << 16) | (g << 8) | b;
            }
        }
    }

    private static int sample(byte[] row, int x, int depth) {
        if (depth == 8) {
            return row[x] & 0xff;
        }
        int bit = x * depth;
        int v = (row[bit >> 3] & 0xff) >> (8 - depth - (bit & 7));
        return v & ((1 << depth) - 1);
    }

    private static int scale(int v, int depth) {
        switch (depth) {
            case 1: return v * 255;
            case 2: return v * 85;
            case 4: return v * 17;
            default: return v;
        }
    }

    private static int be32(byte[] d, int p) {
        return ((d[p] & 0xff) << 24) | ((d[p + 1] & 0xff) << 16) | ((d[p + 2] & 0xff) << 8) | (d[p + 3] & 0xff);
    }

    private static int be16(byte[] d, int p) {
        return ((d[p] & 0xff) << 8) | (d[p + 1] & 0xff);
    }
}
