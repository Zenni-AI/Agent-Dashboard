/**
 * What the app has learned about you, derived on the phone from your own log.
 *
 * Until now every thought started from zero: the app knew everything about one
 * idea and nothing about the person having it. This is the missing link. It is
 * computed locally and sent with each request, so the server still stores
 * nothing — the privacy promise is intact and the model still gets to know you.
 *
 * Kept deliberately small. This rides along on every call, and a profile that
 * grows without bound would quietly become the most expensive part of a
 * request while making the answers vaguer, not sharper.
 */

const RECENT_THOUGHTS = 40;
const MAX_DECISIONS = 12;
const MAX_RETURNING = 5;
const MAX_BOOKS = 6;

/** Words too common to say anything about what a person is into. */
const STOPWORDS = new Set(
  ("the a an and or but if then than that this these those what when where why how who is are was were be been am do does did " +
    "of to in on at by for with from into about as it its i you we they he she them him her my your our their me us " +
    "not no yes so just like really very much more most some any all can could would should will shall may might must " +
    "make makes made making get gets got getting go goes going went have has had having thing things stuff way ways " +
    "one two three first also even still back out up down over under again new old good bad big small maybe")
    .split(" "),
);

/**
 * Subjects that show up across more than one thought.
 *
 * Two appearances is the bar: once is a passing thought, twice is a pattern.
 * Crude word-frequency rather than anything clever, because it only has to be
 * good enough to hand the model a hint it can ignore.
 */
export function recurringSubjects(thoughts) {
  const perThought = thoughts.map((thought) => {
    const words = `${thought.title ?? ""} ${thought.thought ?? ""}`
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, " ")
      .split(/\s+/)
      .filter((word) => word.length > 3 && !STOPWORDS.has(word));
    return new Set(words);
  });

  const counts = new Map();
  for (const words of perThought) {
    for (const word of words) counts.set(word, (counts.get(word) ?? 0) + 1);
  }

  return [...counts.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([word]) => word);
}

/**
 * Build the profile. Returns null when there is not enough history to say
 * anything — a first-time user should not have a paragraph of invented
 * character attached to their first thought.
 */
export function buildProfile(thoughts, books = []) {
  const developed = thoughts.filter((thought) => (thought.turns?.length ?? 0) > 0);
  if (developed.length < 2) return null;

  const recent = developed.slice(0, RECENT_THOUGHTS);
  const keeps = [];
  const kills = [];
  const modeCounts = new Map();

  for (const thought of recent) {
    for (const turn of thought.turns ?? []) {
      modeCounts.set(turn.mode, (modeCounts.get(turn.mode) ?? 0) + 1);
      for (const mark of turn.marks ?? []) {
        (mark.state === "keep" ? keeps : kills).push(mark.text);
      }
    }
  }

  const returning = recent
    .filter((thought) => (thought.turns?.length ?? 0) >= 2)
    .slice(0, MAX_RETURNING)
    .map((thought) => ({ title: thought.title || "untitled", passes: thought.turns.length }));

  const favouriteMode =
    [...modeCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  return {
    thoughtCount: developed.length,
    subjects: recurringSubjects(recent),
    returning,
    keeps: keeps.slice(-MAX_DECISIONS),
    kills: kills.slice(-MAX_DECISIONS),
    favouriteMode,
    books: books
      .filter((book) => book.status === "done")
      .slice(0, MAX_BOOKS)
      .map((book) => book.title)
      .filter(Boolean),
  };
}

/** True when the profile carries enough to be worth the tokens. */
export function isUseful(profile) {
  if (!profile) return false;
  return (
    profile.subjects.length > 0 ||
    profile.returning.length > 0 ||
    profile.keeps.length > 0 ||
    profile.books.length > 0
  );
}
