import { requireNativeModule } from "expo-modules-core";

export type BillingProduct = {
  productId: string;
  title: string;
  description: string;
  price: string;
  priceAmountMicros: number;
  currencyCode: string;
};

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

/** Resolves with the purchased productId once Google Play confirms the purchase. */
export async function purchaseProduct(productId: string): Promise<string> {
  const mod = getNative();
  if (!mod) throw new Error("Billing is not available on this build");
  await connectBilling();
  return mod.purchase(productId);
}

/** Re-queries owned one-time products (e.g. after reinstalling, or on a new device). */
export async function restorePurchases(): Promise<string[]> {
  const mod = getNative();
  if (!mod) return [];
  await connectBilling();
  const json = await mod.restorePurchases();
  return JSON.parse(json) as string[];
}
