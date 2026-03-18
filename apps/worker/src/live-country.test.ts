import { describe, expect, it } from "vitest";
import { classifyLiveChannelCountry } from "./live-country.js";

describe("classifyLiveChannelCountry", () => {
  it("uses group prefix as high-confidence country match", () => {
    expect(
      classifyLiveChannelCountry({
        title: "Sports HD",
        groupTitle: "TR:SPOR"
      })
    ).toEqual({
      countryCode: "TR",
      confidence: "high",
      reason: "prefix"
    });
  });

  it("uses strong TR group aliases when prefix is missing", () => {
    expect(
      classifyLiveChannelCountry({
        title: "Ulusal Haber",
        groupTitle: "Türkiye Ulusal"
      })
    ).toEqual({
      countryCode: "TR",
      confidence: "high",
      reason: "tr_strong_group"
    });
  });

  it("rejects single-title-only medium signals", () => {
    expect(
      classifyLiveChannelCountry({
        title: "Turkce Dublaj Kanal",
        groupTitle: "Genel"
      })
    ).toEqual({
      countryCode: null,
      confidence: "unknown",
      reason: "none"
    });
  });

  it("accepts balanced TR medium signals when group and title both match", () => {
    expect(
      classifyLiveChannelCountry({
        title: "Ulusal Turkce Yayin",
        groupTitle: "Dublaj"
      })
    ).toEqual({
      countryCode: "TR",
      confidence: "medium",
      reason: "tr_balanced_multi_signal"
    });
  });

  it("classifies non-TR prefixes correctly", () => {
    expect(
      classifyLiveChannelCountry({
        title: "FOX News",
        groupTitle: "US-News"
      })
    ).toEqual({
      countryCode: "US",
      confidence: "high",
      reason: "prefix"
    });
  });
});
