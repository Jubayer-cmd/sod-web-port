package sodweb;

import org.teavm.classlib.ResourceSupplier;
import org.teavm.classlib.ResourceSupplierContext;

/**
 * Build-time hook: tells TeaVM which files from the original JAR to embed in sod.js so that
 * the game's own Class.getResourceAsStream("/2") calls keep working unchanged.
 */
public class GameResources implements ResourceSupplier {
    @Override
    public String[] supplyResources(ResourceSupplierContext context) {
        String[] names = new String[25 + 4];
        for (int i = 0; i < 25; i++) {
            names[i] = String.valueOf(i);
        }
        names[25] = "dataIGP";
        names[26] = "icon.png";
        names[27] = "logo.png";
        names[28] = "new.png";
        return names;
    }
}
