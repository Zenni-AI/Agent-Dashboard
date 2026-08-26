import { describe, expect, it } from "vitest";
import { channelRefQueryParam, parseChannelRef } from "../src/youtube/resolve.js";

describe("parseChannelRef", () => {
  it("recognises a raw channel id", () => {
    expect(parseChannelRef("UCuAXFkgsw1L7xaCfnd5JJOw")).toEqual({
      kind: "id",
      value: "UCuAXFkgsw1L7xaCfnd5JJOw",
    });
  });

  it("recognises an @handle", () => {
    expect(parseChannelRef("@SoutheastSoftwash")).toEqual({
      kind: "handle",
      value: "SoutheastSoftwash",
    });
  });

  it("parses every channel URL shape", () => {
    expect(parseChannelRef("https://youtube.com/@someone")).toEqual({ kind: "handle", value: "someone" });
    expect(parseChannelRef("https://www.youtube.com/channel/UCuAXFkgsw1L7xaCfnd5JJOw")).toEqual({
      kind: "id",
      value: "UCuAXFkgsw1L7xaCfnd5JJOw",
    });
    expect(parseChannelRef("https://youtube.com/user/LegacyName")).toEqual({
      kind: "username",
      value: "LegacyName",
    });
    expect(parseChannelRef("youtube.com/c/CustomName")).toEqual({
      kind: "handle",
      value: "CustomName",
    });
  });

  it("treats a bare word as a handle", () => {
    expect(parseChannelRef("Fireship")).toEqual({ kind: "handle", value: "Fireship" });
  });

  it("rejects empty input and non-channel YouTube URLs", () => {
    expect(() => parseChannelRef("   ")).toThrow(/Empty/);
    expect(() => parseChannelRef("https://youtube.com/watch?v=abc")).toThrow(/not a channel URL/);
  });
});

describe("channelRefQueryParam", () => {
  it("maps each reference kind to the right Data API parameter", () => {
    expect(channelRefQueryParam({ kind: "id", value: "UC1" })).toEqual(["id", "UC1"]);
    expect(channelRefQueryParam({ kind: "handle", value: "x" })).toEqual(["forHandle", "@x"]);
    expect(channelRefQueryParam({ kind: "username", value: "y" })).toEqual(["forUsername", "y"]);
  });
});
