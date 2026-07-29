import * as Crypto from "expo-crypto";
import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Offline promo/access code redemption — no server, no dependency on Play
 * Billing. A code is valid if its signature suffix matches a keyed digest of
 * its payload computed with PROMO_SECRET, recomputed on-device.
 *
 * This is a lightweight keyed-digest scheme (SHA256 of secret+payload), NOT
 * a hardened HMAC construction — appropriate for deterring casual guessing
 * of promo codes, not for anything that needs to withstand serious
 * cryptanalysis. Real payment security is Play Billing's job, handled
 * entirely separately in play-billing/ — this only ever grants the same
 * "has access" state a subscription would, never touches money.
 *
 * Change PROMO_SECRET before shipping, and don't treat it as a real secret
 * once the APK is public — anyone can extract a string constant from an
 * APK. The actual security property this provides is "codes can't be
 * guessed or brute-forced casually," not "codes are unforgeable by a
 * determined attacker with the APK in hand."
 */
const PROMO_SECRET = "1vyUmS0P9qi9EB3Gg3WGW2ukE0X_p-qvmAlYM0g6zrg";

const CODE_PREFIX = "LENSII";
const STORAGE_KEY = "lensii.entitlement.promoCode";

async function sign(payload: string): Promise<string> {
  const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `${PROMO_SECRET}:${payload}`);
  return digest.slice(0, 8).toUpperCase();
}

/** Format: LENSII-<PAYLOAD>-<8-char signature>. Generate real codes with scripts/generate-promo-code.js. */
export async function validatePromoCode(code: string): Promise<boolean> {
  const parts = code.trim().toUpperCase().split("-");
  if (parts.length !== 3 || parts[0] !== CODE_PREFIX) return false;
  const [, payload, sig] = parts;
  if (!payload || !sig) return false;
  const expected = await sign(payload);
  return expected === sig;
}

export async function redeemPromoCode(code: string): Promise<boolean> {
  const normalized = code.trim().toUpperCase();
  const ok = await validatePromoCode(normalized);
  if (ok) {
    try {
      await AsyncStorage.setItem(STORAGE_KEY, normalized);
    } catch {
      return false;
    }
  }
  return ok;
}

/** Re-validates the stored code each call rather than trusting a cached boolean, so edited local storage can't bypass this. */
export async function hasRedeemedCode(): Promise<boolean> {
  try {
    const saved = await AsyncStorage.getItem(STORAGE_KEY);
    if (!saved) return false;
    return await validatePromoCode(saved);
  } catch {
    return false;
  }
}

export async function clearRedeemedCode(): Promise<void> {
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch {
    // best-effort
  }
}
