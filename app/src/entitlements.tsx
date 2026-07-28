import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  isBillingAvailable,
  queryProducts,
  purchaseProduct,
  restorePurchases,
  BillingProduct,
  PricingPhase,
  trialPhase,
  recurringPhase,
} from "play-billing";
import { redeemPromoCode, hasRedeemedCode } from "./promoCodes";

/**
 * A single recurring subscription — a 7-day free trial (configured as a
 * Play Console base-plan offer, not tracked by this code) then a monthly
 * charge. This exact ID must be created as a subscription product in Play
 * Console before queryProducts()/purchaseProduct() return anything real —
 * see app/README.md's "Selling on Google Play" section.
 */
export const SUBSCRIPTION_PRODUCT_ID = "lensii_pro_monthly";

const KEY = "lensii.entitlement.subscription";

async function readLocalActive(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(KEY)) === "1";
  } catch {
    return false;
  }
}

async function writeLocalActive(value: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, value ? "1" : "0");
  } catch {
    // best-effort — worst case the next reconciliation on mount corrects it
  }
}

type EntitlementState = {
  pro: boolean;
  product: BillingProduct | null;
  trial: PricingPhase | null;
  recurring: PricingPhase | null;
  busy: boolean;
  error: string | null;
  buy: () => Promise<void>;
  restore: () => Promise<void>;
  redeemCode: (code: string) => Promise<boolean>;
  available: boolean;
};

/**
 * The actual implementation, run exactly once at the app root (see
 * EntitlementProvider) rather than per-screen — gating several tabs at once
 * would otherwise fire several redundant Play Billing queries in parallel.
 *
 * `pro` (true = has access) reflects the subscription (including an active
 * free trial, which Play Billing treats as an active purchase) or a redeemed
 * promo code. Trusts the local cache first (instant, works offline), then
 * reconciles against Play in the background — a subscription can lapse
 * while the app is closed, so this re-checks on every mount rather than
 * trusting the cache indefinitely the way a one-time purchase safely could.
 */
function useEntitlementState(): EntitlementState {
  const [pro, setPro] = useState(false);
  const [product, setProduct] = useState<BillingProduct | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const [cachedActive, codeActive] = await Promise.all([readLocalActive(), hasRedeemedCode()]);
      if (!cancelled) setPro(cachedActive || codeActive);

      if (!isBillingAvailable()) return;

      queryProducts([SUBSCRIPTION_PRODUCT_ID])
        .then((products) => !cancelled && setProduct(products[0] ?? null))
        .catch(() => {});

      try {
        const owned = await restorePurchases();
        const subActive = owned.includes(SUBSCRIPTION_PRODUCT_ID);
        await writeLocalActive(subActive);
        if (!cancelled) setPro(subActive || codeActive);
      } catch {
        // offline, most likely — trust the cached/code state already set above
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const buy = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await purchaseProduct(SUBSCRIPTION_PRODUCT_ID);
      await writeLocalActive(true);
      setPro(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Purchase failed");
    } finally {
      setBusy(false);
    }
  }, [busy]);

  const restore = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const [owned, codeActive] = await Promise.all([restorePurchases(), hasRedeemedCode()]);
      const subActive = owned.includes(SUBSCRIPTION_PRODUCT_ID);
      await writeLocalActive(subActive);
      setPro(subActive || codeActive);
      if (!subActive && !codeActive) setError("No active subscription found on this Google account");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Restore failed");
    } finally {
      setBusy(false);
    }
  }, [busy]);

  const redeemCode = useCallback(
    async (code: string) => {
      if (busy) return false;
      setBusy(true);
      setError(null);
      try {
        const ok = await redeemPromoCode(code);
        if (ok) setPro(true);
        else setError("That code isn't valid");
        return ok;
      } finally {
        setBusy(false);
      }
    },
    [busy]
  );

  const trial: PricingPhase | null = product ? trialPhase(product) : null;
  const recurring: PricingPhase | null = product ? recurringPhase(product) : null;

  return { pro, product, trial, recurring, busy, error, buy, restore, redeemCode, available: isBillingAvailable() };
}

const EntitlementContext = createContext<EntitlementState | null>(null);

export function EntitlementProvider({ children }: { children: React.ReactNode }) {
  const state = useEntitlementState();
  return <EntitlementContext.Provider value={state}>{children}</EntitlementContext.Provider>;
}

export function useEntitlement(): EntitlementState {
  const ctx = useContext(EntitlementContext);
  if (!ctx) throw new Error("useEntitlement must be used within EntitlementProvider");
  return ctx;
}
