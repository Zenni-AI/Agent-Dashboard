#!/usr/bin/env node
import "dotenv/config";
import { loadConfig, MissingKeyError } from "./config.js";
import { CreditStore, issueToken, looksLikeToken } from "./credits.js";

/**
 * Grant and inspect book credits from the shell.
 *
 * Stands in for a payment provider until one is wired up: a Stripe webhook
 * will call exactly the same `grant`. Useful afterwards too, for comping a
 * book to someone whose generation failed in a way the refund missed.
 *
 *   npm run credits -- new 3          issue a token with 3 books
 *   npm run credits -- add <token> 5  top an existing token up
 *   npm run credits -- check <token>  what's left
 */
function creditsFile(): string {
  try {
    return loadConfig().creditsFile;
  } catch (error) {
    // The ledger has nothing to do with the API key; don't demand one here.
    if (error instanceof MissingKeyError) {
      return process.env.HIGH_THOUGHTS_CREDITS_FILE?.trim() || ".high-thoughts/credits.json";
    }
    throw error;
  }
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  const store = new CreditStore(creditsFile());

  switch (command) {
    case "new": {
      const count = Number.parseInt(args[0] ?? "1", 10);
      const token = issueToken();
      const total = await store.grant(token, count, args[1]);
      console.log(`\n  ${token}\n`);
      console.log(`  ${total} book${total === 1 ? "" : "s"}. This is the only time it is shown.`);
      console.log(`  Paste it into the app under Library → "I have a code".\n`);
      break;
    }

    case "add": {
      const [token, amount] = args;
      if (!looksLikeToken(token)) throw new Error("Give a token that starts ht_.");
      const total = await store.grant(token, Number.parseInt(amount ?? "1", 10));
      console.log(`${total} book${total === 1 ? "" : "s"} on that token.`);
      break;
    }

    case "check": {
      const token = args[0];
      if (!store.known(token)) {
        console.log("Not a token this ledger has seen.");
        break;
      }
      console.log(`${store.balance(token)} book(s) left.`);
      break;
    }

    default:
      console.log(`
  npm run credits -- new [count] [note]   issue a token
  npm run credits -- add <token> <count>  top one up
  npm run credits -- check <token>        balance

  Ledger: ${creditsFile()}  (${store.accountCount} account(s))
`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
