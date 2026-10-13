package javax.microedition.lcdui;

import sodweb.Host;

/** MIDP Font mapped onto a CSS font; text is rasterised by the browser and blended in software. */
public final class Font {
    public static final int STYLE_PLAIN = 0;
    public static final int STYLE_BOLD = 1;
    public static final int STYLE_ITALIC = 2;
    public static final int STYLE_UNDERLINED = 4;
    public static final int SIZE_SMALL = 8;
    public static final int SIZE_MEDIUM = 0;
    public static final int SIZE_LARGE = 16;
    public static final int FACE_SYSTEM = 0;
    public static final int FACE_MONOSPACE = 32;
    public static final int FACE_PROPORTIONAL = 64;
    public static final int FONT_STATIC_TEXT = 0;
    public static final int FONT_INPUT_TEXT = 1;

    private static final Font DEFAULT = new Font(FACE_SYSTEM, STYLE_PLAIN, SIZE_MEDIUM);

    private final int face;
    private final int style;
    private final int size;
    private final int pixelSize;
    private final String css;

    private Font(int face, int style, int size) {
        this.face = face;
        this.style = style;
        this.size = size;
        this.pixelSize = size == SIZE_SMALL ? 11 : size == SIZE_LARGE ? 15 : 13;
        String family = face == FACE_MONOSPACE ? "monospace" : "Arial, Helvetica, sans-serif";
        this.css = ((style & STYLE_ITALIC) != 0 ? "italic " : "")
                + ((style & STYLE_BOLD) != 0 ? "bold " : "") + pixelSize + "px " + family;
    }

    public static Font getDefaultFont() {
        return DEFAULT;
    }

    public static Font getFont(int fontSpecifier) {
        return DEFAULT;
    }

    public static Font getFont(int face, int style, int size) {
        return new Font(face, style, size);
    }

    String css() {
        return css;
    }

    public int getFace() {
        return face;
    }

    public int getStyle() {
        return style;
    }

    public int getSize() {
        return size;
    }

    public boolean isPlain() {
        return style == STYLE_PLAIN;
    }

    public boolean isBold() {
        return (style & STYLE_BOLD) != 0;
    }

    public boolean isItalic() {
        return (style & STYLE_ITALIC) != 0;
    }

    public boolean isUnderlined() {
        return (style & STYLE_UNDERLINED) != 0;
    }

    public int getHeight() {
        return pixelSize + 3;
    }

    public int getBaselinePosition() {
        return pixelSize;
    }

    public int stringWidth(String s) {
        return Host.measureText(s, css);
    }

    public int substringWidth(String s, int offset, int len) {
        return stringWidth(s.substring(offset, offset + len));
    }

    public int charWidth(char c) {
        return stringWidth(String.valueOf(c));
    }

    public int charsWidth(char[] ch, int offset, int length) {
        return stringWidth(new String(ch, offset, length));
    }
}
