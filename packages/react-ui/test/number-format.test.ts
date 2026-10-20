// @vitest-environment node
import { describe, expect, it } from "vitest";

import { formatNumberValue } from "../src/database/number-format";

describe("the number cell's display format (the deterministic, locale-free stand)", () => {
  it("stands the bare number (the absent attributes)", () => {
    expect(formatNumberValue(555222, {})).toBe("555222");
    expect(formatNumberValue(0, {})).toBe("0");
  });

  it("groups the thousands by the space (the thousands' separator)", () => {
    expect(formatNumberValue(1000000, { thousands: true })).toBe("1 000 000");
    expect(formatNumberValue(555222, { thousands: true })).toBe("555 222");
    expect(formatNumberValue(1000, { thousands: true })).toBe("1 000");
    // The separator off: the bare digits.
    expect(formatNumberValue(1000000, { thousands: false })).toBe("1000000");
  });

  it("frames the number with the prefix and the suffix (the space join)", () => {
    expect(formatNumberValue(555222, { prefix: "AAA", suffix: "BBB", thousands: true })).toBe("AAA 555 222 BBB");
    expect(formatNumberValue(555222, { prefix: "AAA" })).toBe("AAA 555222");
    expect(formatNumberValue(555222, { suffix: "BBB" })).toBe("555222 BBB");
  });

  it("stands the fixed digit count after the point (the rounding)", () => {
    expect(formatNumberValue(5.5, { decimals: 0 })).toBe("6");
    expect(formatNumberValue(5.5, { decimals: 1 })).toBe("5.5");
    expect(formatNumberValue(5, { decimals: 2 })).toBe("5.00");
    expect(formatNumberValue(5.567, { decimals: 2 })).toBe("5.57");
    // The decimals stand with the thousands' grouping.
    expect(formatNumberValue(1234567.891, { decimals: 2, thousands: true })).toBe("1 234 567.89");
  });

  it("keeps the negative's sign on the integer part (the frame stands outside it)", () => {
    expect(formatNumberValue(-12345, { thousands: true })).toBe("-12 345");
    expect(formatNumberValue(-555222, { prefix: "AAA", suffix: "BBB", thousands: true })).toBe("AAA -555 222 BBB");
  });

  it("stands the rounding's negative zero as the bare zero", () => {
    expect(formatNumberValue(-0.4, { decimals: 0 })).toBe("0");
    expect(formatNumberValue(-0.4, { prefix: "AAA", decimals: 0 })).toBe("AAA 0");
  });

  it("stands the absent decimals as the integer and caps the stand at 10", () => {
    expect(formatNumberValue(1.5, {})).toBe("2");
    expect(formatNumberValue(1.23456789, { decimals: 99 })).toBe("1.2345678900");
    // The invalid stand stands 0.
    expect(formatNumberValue(1.5, { decimals: -3 })).toBe("2");
  });

  it("stands the raw value on the explicit null decimals (the float stand, never rounded)", () => {
    expect(formatNumberValue(1000.5, { decimals: null })).toBe("1000.5");
    expect(formatNumberValue(1000.5, { decimals: null, thousands: true })).toBe("1 000.5");
    expect(formatNumberValue(-1234567.89, { decimals: null, thousands: true })).toBe("-1 234 567.89");
    expect(formatNumberValue(1000.5, { decimals: null, prefix: "AAA", suffix: "BBB" })).toBe("AAA 1000.5 BBB");
  });
});
