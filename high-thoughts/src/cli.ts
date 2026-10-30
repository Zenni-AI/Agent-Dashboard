#!/usr/bin/env node
import "dotenv/config";
import { loadLedgerConfig } from "./config.js";
import { createLedger } from "./ledger-factory.js";
import { issueToken, looksLikeToken } from "./token.js";

/**
 * Grant and inspect creation credits from the shell.
 *
 * Stands in for a payment provider until one is wired up: a Stripe webhook
 * will call exactly the same `grant`. Useful afterwards too, for comping a
 * creation to someone whose generation failed in a way the refund missed.
 *
 * Talks to whichever ledger the environment points at, so running it against
 * production is a matter of having production's env vars — and running it
 * against the wrong one is too. The banner says which, before you spend.
 *
 *   npm run credits -- new 3          issue a token with 3 creations
 *   npm run credits -- add <token> 5  top an existing token up
 *   npm run credits -- check <token>  what's left
 */
async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  const config = loadLedgerConfig();
  const store = createLedger(config);

  switch (command) {
    case "new": {
      const count = Number.parseInt(args[0] ?? "1", 10);
      const token = issueToken();
      const total = await store.grant(token, count, args[1]);
      console.log(`\n  ${token}\n`);
      console.log(`  ${total} creation${total === 1 ? "" : "s"}. This is the only time it is shown.`);
      console.log(`  Paste it into the app under Library → "I have a code".\n`);
      break;
    }

    case "add": {
      const [token, amount] = args;
      if (!looksLikeToken(token)) throw new Error("Give a token that starts ht_.");
      const total = await store.grant(token, Number.parseInt(amount ?? "1", 10));
      console.log(`${total} creation${total === 1 ? "" : "s"} on that token.`);
      break;
    }

    case "check": {
      const token = args[0];
      if (!(await store.known(token))) {
        console.log("Not a token this ledger has seen.");
        break;
      }
      console.log(`${await store.balance(token)} creation(s) left.`);
      break;
    }

    default:
      console.log(`
  npm run credits -- new [count] [note]   issue a token
  npm run credits -- add <token> <count>  top one up
  npm run credits -- check <token>        balance

  Ledger: ${await store.describe()}
`);
  }
}

main().catch((error) => {
  console.error((error as Error).message);
  process.exit(1);
});
