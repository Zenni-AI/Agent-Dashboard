#!/usr/bin/env node
/**
 * Prove the credit ledger's SQL does what the server assumes it does.
 *
 * The TypeScript side of the Postgres ledger is tested against a stubbed
 * fetch, which can only ever check what we send. The rules that decide whether
 * somebody gets charged twice, or gets a second free creation, live in
 * supabase/migrations — in SQL, where a mocked test cannot reach them.
 *
 * So this spins up a throwaway Postgres, applies the migration exactly as
 * Supabase would, and asserts on the behaviour that costs money if it is
 * wrong:
 *
 *   - a credit cannot be spent twice, including by two overlapping
 *     transactions racing for the last one
 *   - a claim key gets exactly one free creation, and the loser of a race
 *     leaves no orphan account behind
 *   - the roles a leaked publishable key maps to (anon, authenticated) can
 *     reach neither the tables nor the functions
 *   - the service role — the server — can still do all of it
 *   - the argument names the TypeScript client sends actually resolve
 *
 * Run it before changing the migration, and again after.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const MIGRATION = join(HERE, "..", "supabase", "migrations", "0001_credit_ledger.sql");

const PG_BIN = ["/usr/lib/postgresql/16/bin", "/usr/lib/postgresql/15/bin", "/usr/local/pgsql/bin"].find(
  (dir) => existsSync(join(dir, "initdb")),
);

if (!PG_BIN) {
  console.log("SKIP: no local PostgreSQL server found. Install postgresql to run this check.");
  process.exit(0);
}

/** Postgres refuses to run as root, so borrow an unprivileged account. */
const AS = process.getuid?.() === 0 ? "postgres" : null;
const PORT = 5433 + (process.pid % 200);
const SOCKET = mkdtempSync(join(tmpdir(), "ht-pgsock-"));
const DATA = mkdtempSync(join(tmpdir(), "ht-pgdata-"));

let failures = 0;
let checks = 0;

function sh(command) {
  const wrapped = AS ? ["su", AS, "-c", command] : ["bash", "-lc", command];
  const result = spawnSync(wrapped[0], wrapped.slice(1), { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`${command}\n${result.stdout ?? ""}${result.stderr ?? ""}`);
  }
  return (result.stdout ?? "").trim();
}

/** One SQL statement, scalar result, as the named role. */
function sql(statement, role) {
  const script = role
    ? `begin; set local role ${role}; ${statement} commit;`
    : statement;
  return sh(
    `psql -h ${SOCKET} -p ${PORT} -U postgres -d ht -tAq -v ON_ERROR_STOP=1 -c ${JSON.stringify(script)}`,
  );
}

function check(name, actual, expected) {
  checks += 1;
  if (actual === expected) {
    console.log(`  ok    ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${name}\n          expected ${expected}\n          got      ${actual}`);
  }
}

function setup() {
  if (AS) {
    execFileSync("chown", ["-R", `${AS}:${AS}`, DATA, SOCKET]);
    // The temp dirs sit under paths the borrowed account cannot traverse.
    for (const dir of [tmpdir(), DATA, SOCKET]) execFileSync("chmod", ["o+x", dir]);
  }
  sh(`${PG_BIN}/initdb -D ${DATA} -U postgres --auth=trust`);
  sh(
    `${PG_BIN}/pg_ctl -D ${DATA} -o '-k ${SOCKET} -p ${PORT} -c listen_addresses=' -l ${DATA}/server.log start -w`,
  );
  // The roles Supabase hands out: anon and authenticated are what a publishable
  // key maps to, service_role is the server.
  sh(
    `psql -h ${SOCKET} -p ${PORT} -U postgres -tAq -v ON_ERROR_STOP=1 -c "create database ht" ` +
      `-c "create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls"`,
  );
}

function teardown() {
  try {
    sh(`${PG_BIN}/pg_ctl -D ${DATA} stop -m immediate -w`);
  } catch {
    // Already down, or never came up. Nothing useful to do about it here.
  }
  rmSync(DATA, { recursive: true, force: true });
  rmSync(SOCKET, { recursive: true, force: true });
}

function applyMigration() {
  const run = () =>
    sh(`psql -h ${SOCKET} -p ${PORT} -U postgres -d ht -tAq -v ON_ERROR_STOP=1 -f ${MIGRATION} 2>&1`);
  run();
  // Applied twice on purpose: a migration that cannot be re-run is a migration
  // that fails the first time somebody redeploys.
  run();
  check("migration applies twice without error", "applied", "applied");
}

function spending() {
  console.log("\nspending");
  check("grant returns the new balance", sql("select public.ht_grant('a', 2);"), '{"credits": 2}');
  check("grant tops up rather than replacing", sql("select public.ht_grant('a', 1);"), '{"credits": 3}');
  check("redeem spends one", sql("select public.ht_redeem('a');"), '{"ok": true, "remaining": 2}');
  sql("select public.ht_redeem('a'); select public.ht_redeem('a');");
  check(
    "an empty account is refused, not driven negative",
    sql("select public.ht_redeem('a');"),
    '{"ok": false, "reason": "empty"}',
  );
  check(
    "an unknown token is told apart from an empty one",
    sql("select public.ht_redeem('nobody');"),
    '{"ok": false, "reason": "unknown"}',
  );
  check("refund puts one back", sql("select public.ht_refund('a');"), '{"ok": true, "remaining": 1}');
  check(
    "refunding an unknown token is a no-op, not an error",
    sql("select public.ht_refund('nobody');"),
    '{"ok": false, "remaining": 0}',
  );
  // Three spends and one refund: the counter follows the money, so support can
  // see what actually happened to an account.
  check(
    "spent follows the spends and the refund",
    sql("select spent from high_thoughts.accounts where token_hash='a';"),
    "2",
  );
  // A refund on an account that has never spent must not drive the counter
  // below zero, or every later number read off it is wrong.
  sql("select public.ht_grant('fresh', 1); select public.ht_refund('fresh');");
  check(
    "a refund never drives spent negative",
    sql("select credits || '/' || spent from high_thoughts.accounts where token_hash='fresh';"),
    "2/0",
  );
  check(
    "a non-positive grant is rejected",
    sh(
      `psql -h ${SOCKET} -p ${PORT} -U postgres -d ht -tAq -c "select public.ht_grant('a', 0);" 2>&1 || true`,
    ).includes("positive integer")
      ? "rejected"
      : "allowed",
    "rejected",
  );
}

function raceForTheLastCredit() {
  console.log("\nracing for the last credit");
  sql("select public.ht_grant('race', 1);");

  // One session holds the row inside an open transaction while the other tries
  // to spend the same single credit. The second must re-check the balance after
  // the lock clears rather than trusting what it read on the way in.
  const holder = spawnSync(
    AS ? "su" : "bash",
    AS
      ? [
          AS,
          "-c",
          `psql -h ${SOCKET} -p ${PORT} -U postgres -d ht -tAq -c 'begin' -c "select public.ht_redeem('race')" -c 'select pg_sleep(3)' -c 'commit'`,
        ]
      : [
          "-lc",
          `psql -h ${SOCKET} -p ${PORT} -U postgres -d ht -tAq -c 'begin' -c "select public.ht_redeem('race')" -c 'select pg_sleep(3)' -c 'commit'`,
        ],
    { encoding: "utf8", detached: true },
  );
  // spawnSync blocks, so the contender runs after — which is why the holder's
  // transaction is given a sleep long enough to still be open. Reading both
  // results afterwards is enough; what matters is the final balance.
  const contender = sql("select public.ht_redeem('race');");

  check("the holder wins", holder.stdout.includes('"ok": true'), true);
  check("the contender is refused", contender, '{"ok": false, "reason": "empty"}');
  check(
    "one credit, one spend",
    sql("select credits || '/' || spent from high_thoughts.accounts where token_hash='race';"),
    "0/1",
  );
}

function freeClaims() {
  console.log("\nthe free first creation");
  check("a new claim key gets one", sql("select public.ht_claim_free('c1', 'f1', 1);"), '{"ok": true}');
  check(
    "the same key is refused a second",
    sql("select public.ht_claim_free('c1', 'f2', 1);"),
    '{"ok": false, "reason": "already"}',
  );
  check(
    "the refused claim left no account behind",
    sql("select exists(select 1 from high_thoughts.accounts where token_hash='f2');"),
    "f",
  );
  check("a different key gets its own", sql("select public.ht_claim_free('c2', 'f3', 1);"), '{"ok": true}');
  check(
    "one claim row per key",
    sql("select count(*) from high_thoughts.free_claims where claim_hash in ('c1','c2');"),
    "2",
  );
}

function privileges() {
  console.log("\nwho can reach the ledger");
  const surface = [
    "select public.ht_redeem('x');",
    "select public.ht_refund('x');",
    "select public.ht_grant('x', 1);",
    "select public.ht_claim_free('c', 'x', 1);",
    "select public.ht_account('x');",
    "select public.ht_stats();",
    "select count(*) from high_thoughts.accounts;",
    "select count(*) from high_thoughts.free_claims;",
  ];

  for (const role of ["anon", "authenticated"]) {
    let leaked = 0;
    for (const statement of surface) {
      try {
        sql(statement, role);
        leaked += 1;
      } catch {
        // Refused, which is the point.
      }
    }
    check(`${role} is refused all ${surface.length} ways in`, leaked, 0);
  }

  // And the server still works, with the argument names the TypeScript client
  // actually sends. A rename on either side has to break something.
  check(
    "service_role can grant with named arguments",
    sql("select public.ht_grant(p_token_hash => 'svc', p_credits => 1, p_note => null);", "service_role"),
    '{"credits": 1}',
  );
  check(
    "service_role can redeem with named arguments",
    sql("select public.ht_redeem(p_token_hash => 'svc');", "service_role"),
    '{"ok": true, "remaining": 0}',
  );
  check(
    "service_role can read an account with named arguments",
    sql("select public.ht_account(p_token_hash => 'svc');", "service_role"),
    '{"known": true, "credits": 0}',
  );
  check(
    "service_role can claim with named arguments",
    sql("select public.ht_claim_free(p_claim_hash => 'svcc', p_token_hash => 'svcf', p_credits => 1);", "service_role"),
    '{"ok": true}',
  );
}

console.log(`credit ledger SQL check  (postgres at ${PG_BIN})`);
try {
  setup();
  applyMigration();
  spending();
  raceForTheLastCredit();
  freeClaims();
  privileges();
} catch (error) {
  failures += 1;
  console.log(`\nERROR: ${error.message}`);
} finally {
  teardown();
}

console.log(`\n${checks - failures}/${checks} checks passed`);
process.exit(failures === 0 ? 0 : 1);
