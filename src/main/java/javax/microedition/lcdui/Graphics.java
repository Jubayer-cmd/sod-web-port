package javax.microedition.lcdui;

import sodweb.Host;

/**
 * Software implementation of MIDP Graphics over an ARGB int[] surface.
 *
 * Canvas2D would anti-alias lines and scaled blits; MIDP semantics (hard clip rect, 8
 * drawRegion transforms, alpha-tested sprites) are easier to honour exactly in software,
 * and a 240x320 surface is tiny for a modern JS engine.
 */
public class Graphics {
    public static final int HCENTER = 1;
    public static final int VCENTER = 2;
    public static final int LEFT = 4;
    public static final int RIGHT = 8;
    public static final int TOP = 16;
    public static final int BOTTOM = 32;
    public static final int BASELINE = 64;
    public static final int SOLID = 0;
    public static final int DOTTED = 1;

    private final int[] buf;
    private final int bw;
    private final int bh;

    private int color = 0xFF000000;
    private int tx;
    private int ty;
    // Clip in surface coordinates, [x0, x1) x [y0, y1)
    private int cx0;
    private int cy0;
    private int cx1;
    private int cy1;
    private Font font = Font.getDefaultFont();
    private int strokeStyle = SOLID;

    Graphics(int[] buf, int bw, int bh) {
        this.buf = buf;
        this.bw = bw;
        this.bh = bh;
        reset();
    }

    /** Restores the state MIDP guarantees at the start of every paint(). */
    void reset() {
        color = 0xFF000000;
        tx = 0;
        ty = 0;
        cx0 = 0;
        cy0 = 0;
        cx1 = bw;
        cy1 = bh;
        font = Font.getDefaultFont();
        strokeStyle = SOLID;
    }

    // ------------------------------------------------------------------ state

    public void translate(int x, int y) {
        tx += x;
        ty += y;
    }

    public int getTranslateX() {
        return tx;
    }

    public int getTranslateY() {
        return ty;
    }

    public void setColor(int rgb) {
        color = 0xFF000000 | (rgb & 0xFFFFFF);
    }

    public void setColor(int r, int g, int b) {
        setColor(((r & 0xff) << 16) | ((g & 0xff) << 8) | (b & 0xff));
    }

    public int getColor() {
        return color & 0xFFFFFF;
    }

    public int getRedComponent() {
        return (color >> 16) & 0xff;
    }

    public int getGreenComponent() {
        return (color >> 8) & 0xff;
    }

    public int getBlueComponent() {
        return color & 0xff;
    }

    public void setGrayScale(int v) {
        setColor(v, v, v);
    }

    public void setFont(Font f) {
        font = f == null ? Font.getDefaultFont() : f;
    }

    public Font getFont() {
        return font;
    }

    public void setStrokeStyle(int style) {
        strokeStyle = style;
    }

    public int getStrokeStyle() {
        return strokeStyle;
    }

    public void setClip(int x, int y, int w, int h) {
        x += tx;
        y += ty;
        cx0 = Math.max(0, x);
        cy0 = Math.max(0, y);
        cx1 = Math.min(bw, x + w);
        cy1 = Math.min(bh, y + h);
    }

    public void clipRect(int x, int y, int w, int h) {
        x += tx;
        y += ty;
        cx0 = Math.max(cx0, x);
        cy0 = Math.max(cy0, y);
        cx1 = Math.min(cx1, x + w);
        cy1 = Math.min(cy1, y + h);
    }

    public int getClipX() {
        return cx0 - tx;
    }

    public int getClipY() {
        return cy0 - ty;
    }

    public int getClipWidth() {
        return Math.max(0, cx1 - cx0);
    }

    public int getClipHeight() {
        return Math.max(0, cy1 - cy0);
    }

    // ------------------------------------------------------------ primitives

    private void plot(int x, int y) {
        if (x >= cx0 && x < cx1 && y >= cy0 && y < cy1) {
            buf[y * bw + x] = color;
        }
    }

    private void hspan(int x0, int x1, int y) {
        if (y < cy0 || y >= cy1) {
            return;
        }
        if (x0 < cx0) {
            x0 = cx0;
        }
        if (x1 > cx1) {
            x1 = cx1;
        }
        int row = y * bw;
        for (int x = x0; x < x1; x++) {
            buf[row + x] = color;
        }
    }

    public void fillRect(int x, int y, int w, int h) {
        if (w <= 0 || h <= 0) {
            return;
        }
        x += tx;
        y += ty;
        int y1 = Math.min(cy1, y + h);
        for (int yy = Math.max(cy0, y); yy < y1; yy++) {
            hspan(x, x + w, yy);
        }
    }

    public void drawRect(int x, int y, int w, int h) {
        if (w < 0 || h < 0) {
            return;
        }
        drawLine(x, y, x + w, y);
        drawLine(x, y + h, x + w, y + h);
        drawLine(x, y, x, y + h);
        drawLine(x + w, y, x + w, y + h);
    }

    public void fillRoundRect(int x, int y, int w, int h, int aw, int ah) {
        fillRect(x, y, w, h);
    }

    public void drawRoundRect(int x, int y, int w, int h, int aw, int ah) {
        drawRect(x, y, w, h);
    }

    public void drawLine(int x0, int y0, int x1, int y1) {
        x0 += tx;
        y0 += ty;
        x1 += tx;
        y1 += ty;
        int dx = Math.abs(x1 - x0);
        int dy = -Math.abs(y1 - y0);
        int sx = x0 < x1 ? 1 : -1;
        int sy = y0 < y1 ? 1 : -1;
        int err = dx + dy;
        int n = 0;
        while (true) {
            if (strokeStyle == SOLID || (n & 2) == 0) {
                plot(x0, y0);
            }
            n++;
            if (x0 == x1 && y0 == y1) {
                break;
            }
            int e2 = 2 * err;
            if (e2 >= dy) {
                err += dy;
                x0 += sx;
            }
            if (e2 <= dx) {
                err += dx;
                y0 += sy;
            }
        }
    }

    public void fillTriangle(int x1, int y1, int x2, int y2, int x3, int y3) {
        x1 += tx; y1 += ty; x2 += tx; y2 += ty; x3 += tx; y3 += ty;
        // sort by y
        if (y1 > y2) { int t = y1; y1 = y2; y2 = t; t = x1; x1 = x2; x2 = t; }
        if (y2 > y3) { int t = y2; y2 = y3; y3 = t; t = x2; x2 = x3; x3 = t; }
        if (y1 > y2) { int t = y1; y1 = y2; y2 = t; t = x1; x1 = x2; x2 = t; }
        for (int y = y1; y <= y3; y++) {
            int xa = edgeX(x1, y1, x3, y3, y);
            int xb = y < y2 ? edgeX(x1, y1, x2, y2, y) : edgeX(x2, y2, x3, y3, y);
            if (xa > xb) { int t = xa; xa = xb; xb = t; }
            hspan(xa, xb + 1, y);
        }
    }

    private static int edgeX(int xa, int ya, int xb, int yb, int y) {
        if (yb == ya) {
            return xa;
        }
        return xa + (xb - xa) * (y - ya) / (yb - ya);
    }

    public void fillArc(int x, int y, int w, int h, int startAngle, int arcAngle) {
        arc(x, y, w, h, startAngle, arcAngle, true);
    }

    public void drawArc(int x, int y, int w, int h, int startAngle, int arcAngle) {
        arc(x, y, w, h, startAngle, arcAngle, false);
    }

    private void arc(int x, int y, int w, int h, int start, int sweep, boolean fill) {
        if (w <= 0 || h <= 0) {
            return;
        }
        x += tx;
        y += ty;
        if (sweep < 0) {
            start += sweep;
            sweep = -sweep;
        }
        boolean full = sweep >= 360;
        start = ((start % 360) + 360) % 360;
        double rx = w / 2.0;
        double ry = h / 2.0;
        double ccx = x + rx;
        double ccy = y + ry;
        for (int py = y; py <= y + h; py++) {
            for (int px = x; px <= x + w; px++) {
                double nx = (px + 0.5 - ccx) / (rx + 0.5);
                double ny = (py + 0.5 - ccy) / (ry + 0.5);
                double d = nx * nx + ny * ny;
                if (d > 1.0) {
                    continue;
                }
                if (!fill) {
                    double inx = (px + 0.5 - ccx) / (rx - 0.5);
                    double iny = (py + 0.5 - ccy) / (ry - 0.5);
                    if (rx > 1 && ry > 1 && inx * inx + iny * iny < 1.0) {
                        continue;
                    }
                }
                if (!full) {
                    // MIDP angles: 0 = 3 o'clock, counter-clockwise positive, screen y grows down
                    int a = (int) Math.round(Math.toDegrees(Math.atan2(-ny, nx)));
                    a = ((a - start) % 360 + 360) % 360;
                    if (a > sweep) {
                        continue;
                    }
                }
                plot(px, py);
            }
        }
    }

    // ---------------------------------------------------------------- images

    public void drawImage(Image img, int x, int y, int anchor) {
        drawRegion(img, 0, 0, img.width, img.height, 0, x, y, anchor);
    }

    public void drawRegion(Image src, int sx, int sy, int sw, int sh, int transform, int x, int y,
            int anchor) {
        if (sw <= 0 || sh <= 0) {
            return;
        }
        boolean swap = transform >= 4;
        int dw = swap ? sh : sw;
        int dh = swap ? sw : sh;
        x += tx;
        y += ty;
        if ((anchor & HCENTER) != 0) {
            x -= dw / 2;
        } else if ((anchor & RIGHT) != 0) {
            x -= dw;
        }
        if ((anchor & VCENTER) != 0) {
            y -= dh / 2;
        } else if ((anchor & (BOTTOM | BASELINE)) != 0) {
            y -= dh;
        }

        // Walk destination pixels; for each, step through the source with per-transform strides.
        int iw = src.width;
        int start;
        int stepX;
        int stepY;
        int last = sh - 1;
        int right = sw - 1;
        switch (transform) {
            case 0: start = sy * iw + sx; stepX = 1; stepY = iw; break;                        // NONE
            case 5: start = (sy + last) * iw + sx; stepX = -iw; stepY = 1; break;             // ROT90
            case 3: start = (sy + last) * iw + sx + right; stepX = -1; stepY = -iw; break;    // ROT180
            case 6: start = sy * iw + sx + right; stepX = iw; stepY = -1; break;              // ROT270
            case 2: start = sy * iw + sx + right; stepX = -1; stepY = iw; break;              // MIRROR
            case 7: start = (sy + last) * iw + sx + right; stepX = -iw; stepY = -1; break;    // MIRROR_ROT90
            case 1: start = (sy + last) * iw + sx; stepX = 1; stepY = -iw; break;             // MIRROR_ROT180
            case 4: start = sy * iw + sx; stepX = iw; stepY = 1; break;                       // MIRROR_ROT270
            default: throw new IllegalArgumentException("transform " + transform);
        }

        int x0 = Math.max(cx0, x);
        int y0 = Math.max(cy0, y);
        int x1 = Math.min(cx1, x + dw);
        int y1 = Math.min(cy1, y + dh);
        if (x0 >= x1 || y0 >= y1) {
            return;
        }
        int[] s = src.pixels;
        for (int yy = y0; yy < y1; yy++) {
            int si = start + (yy - y) * stepY + (x0 - x) * stepX;
            int di = yy * bw + x0;
            for (int xx = x0; xx < x1; xx++, si += stepX, di++) {
                blend(di, s[si]);
            }
        }
    }

    public void drawRGB(int[] rgb, int offset, int scanlength, int x, int y, int w, int h,
            boolean processAlpha) {
        x += tx;
        y += ty;
        int x0 = Math.max(cx0, x);
        int y0 = Math.max(cy0, y);
        int x1 = Math.min(cx1, x + w);
        int y1 = Math.min(cy1, y + h);
        for (int yy = y0; yy < y1; yy++) {
            int si = offset + (yy - y) * scanlength + (x0 - x);
            int di = yy * bw + x0;
            for (int xx = x0; xx < x1; xx++, si++, di++) {
                if (processAlpha) {
                    blend(di, rgb[si]);
                } else {
                    buf[di] = rgb[si] | 0xFF000000;
                }
            }
        }
    }

    public void copyArea(int sx, int sy, int w, int h, int dx, int dy, int anchor) {
        Image tmp = new Image(w, h, new int[w * h], false);
        for (int r = 0; r < h; r++) {
            System.arraycopy(buf, (sy + ty + r) * bw + sx + tx, tmp.pixels, r * w, w);
        }
        drawImage(tmp, dx, dy, anchor);
    }

    private void blend(int di, int argb) {
        int a = argb >>> 24;
        if (a == 0xff) {
            buf[di] = argb;
        } else if (a != 0) {
            int d = buf[di];
            int ia = 255 - a;
            int r = (((argb >> 16) & 0xff) * a + ((d >> 16) & 0xff) * ia) / 255;
            int g = (((argb >> 8) & 0xff) * a + ((d >> 8) & 0xff) * ia) / 255;
            int b = ((argb & 0xff) * a + (d & 0xff) * ia) / 255;
            buf[di] = 0xFF000000 | (r << 16) | (g << 8) | b;
        }
    }

    // ------------------------------------------------------------------ text

    public void drawString(String str, int x, int y, int anchor) {
        if (str == null || str.length() == 0) {
            return;
        }
        Host.TextRaster t = Host.rasterText(str, font.css());
        int w = t.getWidth();
        int h = t.getHeight();
        x += tx;
        y += ty;
        if ((anchor & HCENTER) != 0) {
            x -= w / 2;
        } else if ((anchor & RIGHT) != 0) {
            x -= w;
        }
        if ((anchor & BASELINE) != 0) {
            y -= t.getAscent();
        } else if ((anchor & BOTTOM) != 0) {
            y -= h;
        }
        int rgb = color & 0xFFFFFF;
        for (int r = 0; r < h; r++) {
            int yy = y + r;
            if (yy < cy0 || yy >= cy1) {
                continue;
            }
            for (int c = 0; c < w; c++) {
                int xx = x + c;
                if (xx < cx0 || xx >= cx1) {
                    continue;
                }
                // Threshold coverage to keep the hard-edged look of a 2008 handset font.
                if (Host.alphaAt(t, r * w + c) >= 112) {
                    buf[yy * bw + xx] = 0xFF000000 | rgb;
                }
            }
        }
    }

    public void drawChars(char[] data, int offset, int length, int x, int y, int anchor) {
        drawString(new String(data, offset, length), x, y, anchor);
    }

    public void drawChar(char ch, int x, int y, int anchor) {
        drawString(String.valueOf(ch), x, y, anchor);
    }

    public void drawSubstring(String str, int offset, int len, int x, int y, int anchor) {
        drawString(str.substring(offset, offset + len), x, y, anchor);
    }
}
