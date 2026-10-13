package sodweb;

import javax.microedition.media.MediaException;
import javax.microedition.media.Player;


/**
 * MMAPI Player backed by SODHost's WebAudio engine: WAV through decodeAudioData, MIDI
 * through a small synth in host.js.
 */
public final class WebPlayer implements Player {
    private final int handle;
    private int state = UNREALIZED;
    private int loopCount = 1;

    public WebPlayer(byte[] data, String type) {
        handle = Host.audioCreate(data, type);
    }

    public void realize() throws MediaException {
        if (state == UNREALIZED) {
            state = REALIZED;
        }
    }

    public void prefetch() throws MediaException {
        realize();
        if (state == REALIZED) {
            state = PREFETCHED;
        }
    }

    public void start() throws MediaException {
        prefetch();
        Host.audioStart(handle, loopCount);
        state = STARTED;
    }

    public void stop() throws MediaException {
        if (state == STARTED) {
            Host.audioStop(handle);
            state = PREFETCHED;
        }
    }

    public void deallocate() {
        if (state == STARTED) {
            Host.audioStop(handle);
        }
        if (state != CLOSED) {
            state = REALIZED;
        }
    }

    public void close() {
        Host.audioClose(handle);
        state = CLOSED;
    }

    public void setLoopCount(int count) {
        loopCount = count;
    }

    public int getState() {
        if (state == STARTED && !Host.audioPlaying(handle)) {
            state = PREFETCHED;
        }
        return state;
    }

    public long getDuration() {
        return TIME_UNKNOWN;
    }

    public long getMediaTime() {
        return TIME_UNKNOWN;
    }

    public long setMediaTime(long t) {
        return 0;
    }

    public String getContentType() {
        return "";
    }
}
