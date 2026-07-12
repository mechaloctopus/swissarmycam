/**
 * Unit conversion tables. Every unit converts through a base unit (metres for
 * length, litres for volume) so adding a unit only ever needs one factor.
 */
export type UnitGroup = "length" | "volume" | "weight" | "temperature";

export type UnitDef = { key: string; label: string; toBase: number; fromBaseOffset?: number };

export const LENGTH_UNITS: UnitDef[] = [
  { key: "mm", label: "Millimeters", toBase: 0.001 },
  { key: "cm", label: "Centimeters", toBase: 0.01 },
  { key: "m", label: "Meters", toBase: 1 },
  { key: "km", label: "Kilometers", toBase: 1000 },
  { key: "in", label: "Inches", toBase: 0.0254 },
  { key: "ft", label: "Feet", toBase: 0.3048 },
  { key: "yd", label: "Yards", toBase: 0.9144 },
  { key: "mi", label: "Miles", toBase: 1609.344 },
];

export const VOLUME_UNITS: UnitDef[] = [
  { key: "ml", label: "Milliliters", toBase: 0.001 },
  { key: "l", label: "Liters", toBase: 1 },
  { key: "tsp", label: "Teaspoons", toBase: 0.00492892 },
  { key: "tbsp", label: "Tablespoons", toBase: 0.0147868 },
  { key: "cup", label: "Cups", toBase: 0.236588 },
  { key: "floz", label: "Fluid ounces (US)", toBase: 0.0295735 },
  { key: "pt", label: "Pints (US)", toBase: 0.473176 },
  { key: "qt", label: "Quarts (US)", toBase: 0.946353 },
  { key: "gal", label: "Gallons (US)", toBase: 3.78541 },
];

export const WEIGHT_UNITS: UnitDef[] = [
  { key: "mg", label: "Milligrams", toBase: 0.001 },
  { key: "g", label: "Grams", toBase: 1 },
  { key: "kg", label: "Kilograms", toBase: 1000 },
  { key: "oz", label: "Ounces", toBase: 28.3495 },
  { key: "lb", label: "Pounds", toBase: 453.592 },
  { key: "st", label: "Stone", toBase: 6350.29 },
];

/** Temperature isn't linear-through-zero, so it gets its own converter. */
export function convertTemperature(value: number, from: "c" | "f" | "k", to: "c" | "f" | "k"): number {
  const celsius = from === "c" ? value : from === "f" ? ((value - 32) * 5) / 9 : value - 273.15;
  if (to === "c") return celsius;
  if (to === "f") return (celsius * 9) / 5 + 32;
  return celsius + 273.15;
}

export const TEMPERATURE_UNITS: { key: "c" | "f" | "k"; label: string }[] = [
  { key: "c", label: "Celsius" },
  { key: "f", label: "Fahrenheit" },
  { key: "k", label: "Kelvin" },
];

export function convert(value: number, from: UnitDef, to: UnitDef): number {
  return (value * from.toBase) / to.toBase;
}

export const GROUPS: { key: UnitGroup; label: string; glyph: string }[] = [
  { key: "length", label: "Length", glyph: "↔" },
  { key: "volume", label: "Volume", glyph: "◐" },
  { key: "weight", label: "Weight", glyph: "⚖" },
  { key: "temperature", label: "Temperature", glyph: "🌡" },
];

/** Formats a number without ugly float noise, keeping useful precision. */
export function formatResult(n: number): string {
  if (!isFinite(n)) return "—";
  const abs = Math.abs(n);
  const decimals = abs === 0 ? 2 : abs < 0.01 ? 6 : abs < 1 ? 4 : abs < 100 ? 3 : abs < 10000 ? 2 : 0;
  const fixed = n.toFixed(decimals);
  return fixed.replace(/\.?0+$/, "").replace(/^$/, "0") || "0";
}
