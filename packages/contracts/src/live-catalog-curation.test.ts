import { describe, expect, it } from "vitest";
import fixture from "../test-fixtures/live-channel-curation.json";
import { curateLiveChannels, describeLiveChannel } from "./live-catalog-curation";

describe("live catalog shared conformance", () => {
  for (const scenario of fixture.cases) {
    it(scenario.name, () => {
      const input = structuredClone(scenario.rows);
      const before = structuredClone(input);
      const excluded = new Set((scenario as { excludedIds?: string[] }).excludedIds ?? []);
      const result = curateLiveChannels(input, excluded);
      expect(result.items.map(({ id, title }) => ({ id, title }))).toEqual(scenario.expectedItems);
      expect(Object.fromEntries(result.canonicalById)).toEqual(scenario.expectedAliases);
      expect(input).toEqual(before);
      for (const selected of result.items) {
        const original = input.find(row => row.id === selected.id)!;
        expect(selected.sourceTitle).toBe(original.title);
        expect(selected).toEqual({ ...original, title: selected.title, sourceTitle: original.title });
      }
      const reversed = curateLiveChannels([...input].reverse(), excluded);
      expect(reversed.items).toEqual(result.items);
      expect(Object.fromEntries(reversed.canonicalById)).toEqual(scenario.expectedAliases);
      const warm = curateLiveChannels(result.items, excluded);
      expect(warm.items).toEqual(result.items);
    });
  }
  for (const scenario of fixture.descriptorCases) {
    it(`describes ${scenario.title}`, () => {
      expect(describeLiveChannel(scenario.title, scenario.groupTitle)).toMatchObject(scenario.expected);
    });
  }
  it("does not alias an all-unavailable or owner-excluded group", () => {
    expect(curateLiveChannels([{ id: "1", title: "TR | ATV FHD", available: false }]).canonicalById.size).toBe(0);
    expect(curateLiveChannels([{ id: "1", title: "TR | ATV FHD" }], new Set(["1"]))).toEqual({ items: [], canonicalById: new Map() });
  });
  it("preserves fields and avoids normalizing the raw cache in place", () => {
    const source = { id: "a", title: "TR | ATV FHD", groupTitle: "TR | Ulusal", personalRef: { id: "42", scope: "owner-a" }, extension: "ts", logoUrl: "/atv.png" };
    const result = curateLiveChannels([source]);
    expect(result.items[0]).not.toBe(source);
    expect(result.items[0].personalRef).toBe(source.personalRef);
    expect(source.title).toBe("TR | ATV FHD");
    expect(result.items[0].title).toBe("ATV");
  });
});
