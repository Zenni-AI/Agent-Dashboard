/**
 * Channel references arrive in every shape a user might paste. Normalising them
 * up front keeps a single lookup path in the Data API client.
 */
export type ChannelRef =
  | { kind: "id"; value: string }
  | { kind: "handle"; value: string }
  | { kind: "username"; value: string };

/**
 * Accepts a channel ID, an @handle, or any of the URL forms YouTube serves:
 *   https://youtube.com/@handle
 *   https://www.youtube.com/channel/UC...
 *   https://youtube.com/c/CustomName
 *   https://youtube.com/user/LegacyName
 */
export function parseChannelRef(input: string): ChannelRef {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("Empty channel reference.");

  if (/^UC[\w-]{22}$/.test(trimmed)) {
    return { kind: "id", value: trimmed };
  }

  if (trimmed.startsWith("@")) {
    return { kind: "handle", value: trimmed.slice(1) };
  }

  if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith("youtube.com") || trimmed.startsWith("www.youtube.com")) {
    const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    let url: URL;
    try {
      url = new URL(withScheme);
    } catch {
      throw new Error(`Could not parse "${input}" as a channel URL.`);
    }
    const segments = url.pathname.split("/").filter(Boolean);
    const [first, second] = segments;
    if (first?.startsWith("@")) return { kind: "handle", value: first.slice(1) };
    if (first === "channel" && second) return { kind: "id", value: second };
    if (first === "user" && second) return { kind: "username", value: second };
    if (first === "c" && second) return { kind: "handle", value: second };
    throw new Error(
      `"${input}" is a YouTube URL but not a channel URL. Use the @handle or the /channel/UC... form.`,
    );
  }

  // A bare word is far more likely to be a handle than a legacy username.
  return { kind: "handle", value: trimmed };
}

/** The query parameter `channels.list` expects for a given reference. */
export function channelRefQueryParam(ref: ChannelRef): [string, string] {
  switch (ref.kind) {
    case "id":
      return ["id", ref.value];
    case "handle":
      return ["forHandle", `@${ref.value}`];
    case "username":
      return ["forUsername", ref.value];
  }
}
