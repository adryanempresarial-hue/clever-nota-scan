import { describe, expect, it } from "vitest";
import { prioritizePeriod } from "../src/lib/period-order";

describe("selected period priority", () => {
  it("puts 6-8 first without dropping or changing records or the remaining order", () => {
    const groups = [
      { label: "1-3", items: [{ value: 2000, uh: "021" }] },
      { label: "4-5", items: [{ value: 100 }] },
      { label: "6-8", items: [{ value: 1500 }] },
    ];
    const result = prioritizePeriod(groups, "6-8");
    expect(result.map(group => group.label)).toEqual(["6-8", "1-3", "4-5"]);
    expect(result[0]).toBe(groups[2]);
    expect(result[1].items).toEqual([{ value: 2000, uh: "021" }]);
    expect(groups.map(group => group.label)).toEqual(["1-3", "4-5", "6-8"]);
  });
  it("restores chronological order when the priority is cleared", () => {
    const groups = [{ label: "1-3" }, { label: "6-8" }];
    expect(prioritizePeriod(groups, "")).toEqual(groups);
    expect(prioritizePeriod(groups, "missing")).toEqual(groups);
  });
});