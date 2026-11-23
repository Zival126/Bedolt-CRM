import { register } from "node:module";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
register("./loader.mjs", import.meta.url);
// Base de test jetable (jamais data/crm.db), pauses DENUE réduites.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bedolt-test-"));
process.env.DATABASE_PATH ??= path.join(dir, "test.db");
process.env.DENUE_GAP_MS ??= "0";
process.env.DENUE_PAGE_PAUSE_MS ??= "0";
process.env.GEOCODER = "off";
