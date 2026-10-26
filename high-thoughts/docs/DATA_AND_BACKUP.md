# Where your ideas live, and how they are lost

Written plainly because the honest answer is not "they are safe".

## What is stored, and where

Everything is in **this browser, on this device**, in `localStorage`:

| Key | Holds |
| --- | --- |
| `high-thoughts/v1` | ideas: original text, title, interview answers, conversation passes, marks |
| `high-thoughts/creations/v1` | creations: the generated HTML, kind, version, the feedback that caused it |
| `high-thoughts/token/v1` | the credit token |
| `high-thoughts/offer/v1` | when you were last offered an upgrade |

**The server stores none of it.** It sees an idea for as long as it takes to
answer, and writes nothing down. The only thing it keeps is the credit ledger,
which holds a hash of a token and a number — never an idea.

## This is not a backup

Browser storage is **not durable, and not cross-device.** It disappears when:

- you clear site data, cookies, or "browsing history" with site data ticked
- the browser evicts storage under disk pressure — **Safari does this after
  about seven days of not opening the site** on iOS and macOS
- you use a private window, which discards it on close
- you switch browsers, phones, or profiles — there is no sync of any kind
- you uninstall the home-screen app on some platforms

**Nothing here is represented as a backup, and the UI must never say it is.**
The Library screen says "kept on this phone" for exactly this reason.

## Quota

`localStorage` is roughly **5 MB per origin**. A creation is 18–25 KB of HTML,
so about 200 fit. We keep a maximum of **40 creations** and drop the oldest.

When a write is refused, `saveCreation` returns `stored: false`, and the app
tells you on screen that the creation is showing but not saved, and suggests
saving the file. **It never fails silently.**

## How to actually not lose things

1. **Back up everything** — Library → *Back up everything* writes a JSON file
   containing every idea and every creation. Keep it somewhere real.
2. **Save the file** on any creation you care about — it downloads a standalone
   HTML page that opens in any browser, forever, with no server.

Both are manual. That is the honest state of the MVP.

## What would make it durable (not built, not approved)

Accounts and server-side storage. That is the only thing that survives a
cleared browser or a new phone. It is deliberately out of scope for Milestone 1
and is coupled to the sharing decision, which is deferred.

**Until then: if it is not exported, assume it can vanish.**
