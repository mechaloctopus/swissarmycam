import { useCallback, useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { isBillingAvailable, queryProducts, purchaseProduct, restorePurchases, BillingProduct } from "play-billing";

/**
 * A single non-consumable "unlock everything" product. Lensii doesn't have
 * subscriptions, consumables, or per-feature purchases — one product keeps
 * both the native module and this store as simple as the app actually needs.
 *
 * This exact ID must be created as a one-time product in Play Console before
 * queryProducts()/purchaseProduct() will return anything real — see
 * app/README.md's "Selling on Google Play" section.
 */
export const PRO_PRODUCT_ID = "lensii_pro_unlock";

const KEY = "lensii.entitlement.pro";

async function readLocalPro(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(KEY)) === "1";
  } catch {
    return false;
  }
}

async function writeLocalPro(value: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, value ? "1" : "0");
  } catch {
    // best-effort — worst case the user just needs to hit "Restore purchases" again
  }
}

/**
 * Reactive Pro-entitlement state for a screen. Trusts the local cache first
 * (instant, works offline) and reconciles against Play in the background —
 * screens that render before billing has ever connected still get a
 * same-render answer instead of a loading flash.
 */
export function useEntitlement() {
  const [pro, setPro] = useState(false);
  const [product, setProduct] = useState<BillingProduct | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    readLocalPro().then((v) => !cancelled && setPro(v));
    if (isBillingAvailable()) {
      queryProducts([PRO_PRODUCT_ID])
        .then((products) => !cancelled && setProduct(products[0] ?? null))
        .catch(() => {});
    }
    return () => {
      cancelled = true;
    };
  }, []);

  const buy = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await purchaseProduct(PRO_PRODUCT_ID);
      await writeLocalPro(true);
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
      const owned = await restorePurchases();
      const hasPro = owned.includes(PRO_PRODUCT_ID);
      await writeLocalPro(hasPro);
      setPro(hasPro);
      if (!hasPro) setError("No previous purchase found on this Google account");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Restore failed");
    } finally {
      setBusy(false);
    }
  }, [busy]);

  return { pro, product, busy, error, buy, restore, available: isBillingAvailable() };
}
