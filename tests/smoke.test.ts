import { describe, it, expect } from "vitest";

describe("smoke", () => {
  it("vitest runs", () => {
    const items = [1, 2, 3];
    expect(items.at(0)).toBe(1);
  });
});
