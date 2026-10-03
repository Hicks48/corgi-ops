import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// Any store a test forgets to point at a temp dir lands here, never in the real ~/.corgiops.
process.env.CORGIOPS_HOME = mkdtempSync(join(tmpdir(), "corgiops-test-home-"))
