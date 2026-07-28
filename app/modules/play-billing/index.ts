import { requireNativeModule } from "expo-modules-core";

/** recurrenceMode from ProductDetails.PricingPhase: 1 = infinite recurring, 2 = finite recurring, 3 = non-recurring (e.g. a one-off free trial phase). */
export type PricingPhase = {
  price: string;
  priceAmountMicros: number;
  currencyCode: string;
  /** ISO 8601 duration, e.g. "P7D" (7 days) or "P1M" (1 month). */
  billingPeriod: string;
  recurrenceMode: 1 | 2 | 3;
};

export type BillingProduct = {
  productId: string;
  title: string;
  description: string;
  /** In offer order — a free-trial offer is a $0 non-recurring phase followed by the recurring paid phase. */
  pricingPhases: PricingPhase[];
};

/** Finds the recurring (paid) phase in a subscription's pricing phases — the "then $14/mo" part. */
export function recurringPhase(product: BillingProduct): PricingPhase | null {
  return product.pricingPhases.find((p) => p.recurrenceMode === 1 || p.recurrenceMode === 2) ?? null;
}

/** Finds a free-trial phase, if the offer has one — a $0 non-recurring phase. */
export function trialPhase(product: BillingProduct): PricingPhase | null {
  return product.pricingPhases.find((p) => p.priceAmountMicros === 0 && p.recurrenceMode === 3) ?? null;
}

type NativePlayBillingModule = {
  isAvailable(): boolean;
  connect(): Promise<boolean>;
  queryProducts(productIdsJson: string): Promise<string>;
  purchase(productId: string): Promise<string>;
  restorePurchases(): Promise<string>;
};

let native: NativePlayBillingModule | null = null;
function getNative(): NativePlayBillingModule | null {
  if (native) return native;
  try {
    native = requireNativeModule<NativePlayBillingModule>("PlayBilling");
  } catch {
    native = null;
  }
  return native;
}

/** Android only — false on any other platform or if linking somehow failed. */
export function isBillingAvailable(): boolean {
  try {
    return getNative()?.isAvailable() ?? false;
  } catch {
    return false;
  }
}

let connected: Promise<boolean> | null = null;
/** Idempotent — safe to call repeatedly, only actually connects once. */
export function connectBilling(): Promise<boolean> {
  const mod = getNative();
  if (!mod) return Promise.resolve(false);
  if (!connected) connected = mod.connect();
  return connected;
}

export async function queryProducts(productIds: string[]): Promise<BillingProduct[]> {
  const mod = getNative();
  if (!mod) return [];
  await connectBilling();
  const json = await mod.queryProducts(JSON.stringify(productIds));
  return JSON.parse(json) as BillingProduct[];
}

/** Resolves with the subscribed productId once Google Play confirms the purchase (including entering its free trial, if the offer has one — Play treats trial as an active purchase). */
export async function purchaseProduct(productId: string): Promise<string> {
  const mod = getNative();
  if (!mod) throw new Error("Billing is not available on this build");
  await connectBilling();
  return mod.purchase(productId);
}

/** Re-queries active subscriptions (e.g. after reinstalling, or on a new device). Only returns currently-active ones — Play Billing excludes expired/cancelled subscriptions automatically. */
export async function restorePurchases(): Promise<string[]> {
  const mod = getNative();
  if (!mod) return [];
  await connectBilling();
  const json = await mod.restorePurchases();
  return JSON.parse(json) as string[];
}
