package javax.microedition.rms;

import java.util.Hashtable;
import java.util.Vector;
import sodweb.Host;

/**
 * MIDP RecordStore persisted to localStorage. Each store is held in memory while open and
 * written through on every change as "sod.rms.<name>" = comma-separated hex records
 * (empty string for a deleted record id, so ids stay stable).
 */
public class RecordStore {
    private static final Hashtable OPEN = new Hashtable();

    private final String name;
    private final Vector records; // byte[] or null (deleted); index = recordId - 1
    private int openCount;

    private RecordStore(String name, Vector records) {
        this.name = name;
        this.records = records;
    }

    public static RecordStore openRecordStore(String name, boolean create)
            throws RecordStoreException {
        RecordStore rs = (RecordStore) OPEN.get(name);
        if (rs == null) {
            String raw = Host.storageGet(key(name));
            if (raw == null && !create) {
                throw new RecordStoreNotFoundException(name);
            }
            rs = new RecordStore(name, decode(raw));
            if (raw == null) {
                rs.persist();
            }
            OPEN.put(name, rs);
        }
        rs.openCount++;
        return rs;
    }

    public static void deleteRecordStore(String name) throws RecordStoreException {
        if (Host.storageGet(key(name)) == null) {
            throw new RecordStoreNotFoundException(name);
        }
        OPEN.remove(name);
        Host.storageRemove(key(name));
    }

    public static String[] listRecordStores() {
        return null;
    }

    public void closeRecordStore() throws RecordStoreException {
        if (openCount <= 0) {
            throw new RecordStoreNotOpenException(name);
        }
        if (--openCount == 0) {
            OPEN.remove(name);
        }
    }

    public String getName() {
        return name;
    }

    public int getNumRecords() throws RecordStoreNotOpenException {
        checkOpen();
        int n = 0;
        for (int i = 0; i < records.size(); i++) {
            if (records.elementAt(i) != null) {
                n++;
            }
        }
        return n;
    }

    public int getNextRecordID() throws RecordStoreException {
        checkOpen();
        return records.size() + 1;
    }

    public int getSize() {
        return 0;
    }

    public int getSizeAvailable() {
        return 64 * 1024;
    }

    public int addRecord(byte[] data, int offset, int len) throws RecordStoreException {
        checkOpen();
        byte[] copy = new byte[len];
        if (len > 0) {
            System.arraycopy(data, offset, copy, 0, len);
        }
        records.addElement(copy);
        persist();
        return records.size();
    }

    public void setRecord(int id, byte[] data, int offset, int len) throws RecordStoreException {
        get(id);
        byte[] copy = new byte[len];
        if (len > 0) {
            System.arraycopy(data, offset, copy, 0, len);
        }
        records.setElementAt(copy, id - 1);
        persist();
    }

    public void deleteRecord(int id) throws RecordStoreException {
        get(id);
        records.setElementAt(null, id - 1);
        persist();
    }

    public byte[] getRecord(int id) throws RecordStoreException {
        byte[] r = get(id);
        byte[] copy = new byte[r.length];
        System.arraycopy(r, 0, copy, 0, r.length);
        return copy;
    }

    public int getRecord(int id, byte[] buffer, int offset) throws RecordStoreException {
        byte[] r = get(id);
        System.arraycopy(r, 0, buffer, offset, r.length);
        return r.length;
    }

    public int getRecordSize(int id) throws RecordStoreException {
        return get(id).length;
    }

    private byte[] get(int id) throws RecordStoreException {
        checkOpen();
        if (id < 1 || id > records.size() || records.elementAt(id - 1) == null) {
            throw new InvalidRecordIDException(String.valueOf(id));
        }
        return (byte[]) records.elementAt(id - 1);
    }

    private void checkOpen() throws RecordStoreNotOpenException {
        if (openCount <= 0) {
            throw new RecordStoreNotOpenException(name);
        }
    }

    private static String key(String name) {
        return "sod.rms." + name;
    }

    private static final String HEX = "0123456789abcdef";

    private void persist() {
        StringBuffer sb = new StringBuffer();
        for (int i = 0; i < records.size(); i++) {
            if (i > 0) {
                sb.append(',');
            }
            byte[] r = (byte[]) records.elementAt(i);
            if (r == null) {
                sb.append('-');
                continue;
            }
            for (int j = 0; j < r.length; j++) {
                sb.append(HEX.charAt((r[j] >> 4) & 0xf)).append(HEX.charAt(r[j] & 0xf));
            }
        }
        Host.storageSet(key(name), sb.toString());
    }

    private static Vector decode(String raw) {
        Vector v = new Vector();
        if (raw == null || raw.length() == 0) {
            return v;
        }
        int start = 0;
        while (start <= raw.length()) {
            int comma = raw.indexOf(',', start);
            int end = comma < 0 ? raw.length() : comma;
            String part = raw.substring(start, end);
            if (part.equals("-")) {
                v.addElement(null);
            } else {
                byte[] b = new byte[part.length() / 2];
                for (int j = 0; j < b.length; j++) {
                    b[j] = (byte) Integer.parseInt(part.substring(j * 2, j * 2 + 2), 16);
                }
                v.addElement(b);
            }
            if (comma < 0) {
                break;
            }
            start = comma + 1;
        }
        return v;
    }
}
