import type { LedgerConfig } from "./config.js";
import { CreditStore } from "./credits.js";
import type { Ledger } from "./ledger.js";
import { SupabaseLedger } from "./ledger-supabase.js";

/**
 * Pick the ledger the config asks for.
 *
 * The seam exists so that moving a running app from the file to Postgres is a
 * deploy with two more environment variables, and so that nothing above this
 * line has to know which one it got.
 */
export function createLedger(config: LedgerConfig): Ledger {
  if (config.ledger === "supabase" && config.supabaseUrl && config.supabaseServiceRoleKey) {
    return new SupabaseLedger({
      url: config.supabaseUrl,
      serviceRoleKey: config.supabaseServiceRoleKey,
      freeCredits: config.freeCredits,
    });
  }

  return new CreditStore(config.creditsFile, { freeCredits: config.freeCredits });
}
