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

  it("classifies TURK group aliases as strong TR signal", () => {
    expect(
      classifyLiveChannelCountry({
        title: "Spor HD",
        groupTitle: "Turk Kanallari"
      })
    ).toEqual({
      countryCode: "TR",
      confidence: "high",
      reason: "tr_strong_group"
    });
  });

  it("classifies strong Turkish title brands even when group is generic", () => {
    expect(
      classifyLiveChannelCountry({
        title: "TRT 1 HD",
        groupTitle: "Genel"
      })
    ).toEqual({
      countryCode: "TR",
      confidence: "high",
      reason: "tr_strong_group"
    });
  });

  it("classifies TR token with contextual title keywords as strong Turkish signal", () => {
    expect(
      classifyLiveChannelCountry({
        title: "TR Spor HD",
        groupTitle: "Spor"
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
