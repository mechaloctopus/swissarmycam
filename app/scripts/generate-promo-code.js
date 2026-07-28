#!/usr/bin/env node
// Generates a valid Lensii promo/access code for a given payload.
//
// Usage: node scripts/generate-promo-code.js SOMEPAYLOAD
//
// Reads PROMO_SECRET straight out of src/promoCodes.ts (regex-extracted, not
// duplicated) so the generator and the app's own validation can never drift
// out of sync with each other.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const srcPath = path.join(__dirname, "../src/promoCodes.ts");
const src = fs.readFileSync(srcPath, "utf8");
const match = src.match(/PROMO_SECRET\s*=\s*"([^"]+)"/);
if (!match) {
  console.error(`Could not find PROMO_SECRET in ${srcPath}`);
  process.exit(1);
}
const secret = match[1];
if (secret.includes("CHANGE-ME")) {
  console.error("PROMO_SECRET in src/promoCodes.ts is still the placeholder — change it before generating real codes.");
  process.exit(1);
}

const payload = (process.argv[2] || "").trim().toUpperCase();
if (!payload || !/^[A-Z0-9]+$/.test(payload)) {
  console.error("Usage: node scripts/generate-promo-code.js PAYLOAD   (letters/digits only)");
  process.exit(1);
}

const sig = crypto.createHash("sha256").update(`${secret}:${payload}`).digest("hex").slice(0, 8).toUpperCase();
console.log(`LENSII-${payload}-${sig}`);
