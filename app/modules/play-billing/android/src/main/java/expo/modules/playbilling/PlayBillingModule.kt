package expo.modules.playbilling

import com.android.billingclient.api.AcknowledgePurchaseParams
import com.android.billingclient.api.BillingClient
import com.android.billingclient.api.BillingClient.BillingResponseCode
import com.android.billingclient.api.BillingClient.ProductType
import com.android.billingclient.api.BillingClientStateListener
import com.android.billingclient.api.BillingFlowParams
import com.android.billingclient.api.BillingResult
import com.android.billingclient.api.PendingPurchasesParams
import com.android.billingclient.api.ProductDetails
import com.android.billingclient.api.Purchase
import com.android.billingclient.api.PurchasesUpdatedListener
import com.android.billingclient.api.QueryProductDetailsParams
import com.android.billingclient.api.QueryPurchasesParams
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONArray
import org.json.JSONObject

/**
 * Subscription purchases via Google Play Billing Library 9.x — Lensii sells
 * exactly one SUBS product (with a free-trial offer configured in Play
 * Console, not tracked by this code at all: Play Billing treats an active
 * trial as an active purchase, so "does queryPurchasesAsync return this
 * product" already answers "does the user have access," trial or paid,
 * with no separate trial-state bookkeeping needed here).
 *
 * A purchase resolves the pending `purchase()` promise the moment
 * PurchasesUpdatedListener reports it, and is also broadcast as
 * "onPurchaseUpdated" so a purchase that completes while the promise-holding
 * screen isn't mounted (e.g. after the app was killed mid-flow) still
 * reaches JS once billing reconnects and restorePurchases() runs.
 */
class PlayBillingModule : Module() {
  private var billingClient: BillingClient? = null
  private var pendingPurchasePromise: Promise? = null
  private val productDetailsCache = mutableMapOf<String, ProductDetails>()

  override fun definition() = ModuleDefinition {
    Name("PlayBilling")

    Events("onPurchaseUpdated", "onPurchaseError")

    Function("isAvailable") { true }

    AsyncFunction("connect") { promise: Promise ->
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      val existing = billingClient
      if (existing != null && existing.isReady) {
        promise.resolve(true)
        return@AsyncFunction
      }

      val listener = PurchasesUpdatedListener { billingResult, purchases ->
        if (billingResult.responseCode == BillingResponseCode.OK && purchases != null) {
          for (purchase in purchases) handlePurchase(purchase)
        } else if (billingResult.responseCode != BillingResponseCode.USER_CANCELED) {
          sendEvent("onPurchaseError", mapOf("code" to billingResult.responseCode, "message" to (billingResult.debugMessage ?: "")))
          pendingPurchasePromise?.reject("PURCHASE_FAILED", billingResult.debugMessage ?: "Purchase failed", null)
          pendingPurchasePromise = null
        } else {
          pendingPurchasePromise?.reject("USER_CANCELED", "Purchase was canceled", null)
          pendingPurchasePromise = null
        }
      }

      // enablePendingPurchases() is mandatory regardless of product type, but
      // enableOneTimeProducts() specifically opts into pending (deferred)
      // one-time-purchase support -- not applicable now that Lensii sells
      // only a subscription, so it's left off.
      val client = BillingClient.newBuilder(context)
        .setListener(listener)
        .enablePendingPurchases(PendingPurchasesParams.newBuilder().build())
        .enableAutoServiceReconnection()
        .build()
      billingClient = client

      client.startConnection(object : BillingClientStateListener {
        override fun onBillingSetupFinished(billingResult: BillingResult) {
          promise.resolve(billingResult.responseCode == BillingResponseCode.OK)
        }
        override fun onBillingServiceDisconnected() {
          // enableAutoServiceReconnection() handles reconnecting.
        }
      })
    }

    AsyncFunction("queryProducts") { productIdsJson: String, promise: Promise ->
      val client = billingClient
      if (client == null || !client.isReady) {
        promise.reject("NOT_CONNECTED", "Call connect() first", null)
        return@AsyncFunction
      }
      val ids = JSONArray(productIdsJson)
      val products = (0 until ids.length()).map { i ->
        QueryProductDetailsParams.Product.newBuilder()
          .setProductId(ids.getString(i))
          .setProductType(ProductType.SUBS)
          .build()
      }
      val params = QueryProductDetailsParams.newBuilder().setProductList(products).build()

      client.queryProductDetailsAsync(params) { billingResult, result ->
        if (billingResult.responseCode != BillingResponseCode.OK) {
          promise.reject("QUERY_FAILED", billingResult.debugMessage ?: "Could not query products", null)
          return@queryProductDetailsAsync
        }
        val out = JSONArray()
        for (details in result.productDetailsList) {
          productDetailsCache[details.productId] = details
          // The first offer on the first base plan — Lensii only ever
          // configures one base plan with one (trial) offer per product, so
          // there's no offer-selection UI to build.
          val offer = details.subscriptionOfferDetails?.firstOrNull()
          val phases = offer?.pricingPhases?.pricingPhaseList ?: emptyList()
          val phasesJson = JSONArray()
          for (phase in phases) {
            phasesJson.put(
              JSONObject().apply {
                put("price", phase.formattedPrice)
                put("priceAmountMicros", phase.priceAmountMicros)
                put("currencyCode", phase.priceCurrencyCode)
                put("billingPeriod", phase.billingPeriod)
                put("recurrenceMode", phase.recurrenceMode)
              }
            )
          }
          out.put(
            JSONObject().apply {
              put("productId", details.productId)
              put("title", details.title)
              put("description", details.description)
              put("pricingPhases", phasesJson)
            }
          )
        }
        promise.resolve(out.toString())
      }
    }

    AsyncFunction("purchase") { productId: String, promise: Promise ->
      val client = billingClient
      val activity = appContext.currentActivity
      val details = productDetailsCache[productId]
      when {
        client == null || !client.isReady -> {
          promise.reject("NOT_CONNECTED", "Call connect() first", null)
        }
        activity == null -> {
          promise.reject("NO_ACTIVITY", "No current activity", null)
        }
        details == null -> {
          promise.reject("UNKNOWN_PRODUCT", "Call queryProducts() for this product first", null)
        }
        else -> {
          val offerToken = details.subscriptionOfferDetails?.firstOrNull()?.offerToken
          if (offerToken == null) {
            promise.reject("NO_OFFER", "This subscription has no purchasable offer configured in Play Console", null)
            return@AsyncFunction
          }
          val paramsBuilder = BillingFlowParams.ProductDetailsParams.newBuilder()
            .setProductDetails(details)
            .setOfferToken(offerToken)
          val flowParams = BillingFlowParams.newBuilder()
            .setProductDetailsParamsList(listOf(paramsBuilder.build()))
            .build()
          pendingPurchasePromise = promise
          val launchResult = client.launchBillingFlow(activity, flowParams)
          if (launchResult.responseCode != BillingResponseCode.OK) {
            pendingPurchasePromise = null
            promise.reject("LAUNCH_FAILED", launchResult.debugMessage ?: "Could not launch billing flow", null)
          }
          // else: resolved by the PurchasesUpdatedListener above.
        }
      }
    }

    AsyncFunction("restorePurchases") { promise: Promise ->
      val client = billingClient
      if (client == null || !client.isReady) {
        promise.reject("NOT_CONNECTED", "Call connect() first", null)
        return@AsyncFunction
      }
      val params = QueryPurchasesParams.newBuilder().setProductType(ProductType.SUBS).build()
      client.queryPurchasesAsync(params) { billingResult, purchases ->
        if (billingResult.responseCode != BillingResponseCode.OK) {
          promise.reject("QUERY_FAILED", billingResult.debugMessage ?: "Could not query purchases", null)
          return@queryPurchasesAsync
        }
        val out = JSONArray()
        for (purchase in purchases) {
          if (purchase.purchaseState == Purchase.PurchaseState.PURCHASED) {
            handlePurchase(purchase, resolvePending = false)
            purchase.products.firstOrNull()?.let { out.put(it) }
          }
        }
        promise.resolve(out.toString())
      }
    }
  }

  private fun handlePurchase(purchase: Purchase, resolvePending: Boolean = true) {
    if (purchase.purchaseState != Purchase.PurchaseState.PURCHASED) return

    if (!purchase.isAcknowledged) {
      val client = billingClient
      if (client != null) {
        val ackParams = AcknowledgePurchaseParams.newBuilder().setPurchaseToken(purchase.purchaseToken).build()
        client.acknowledgePurchase(ackParams) { }
      }
    }

    val productId = purchase.products.firstOrNull() ?: ""
    if (resolvePending) {
      pendingPurchasePromise?.resolve(productId)
      pendingPurchasePromise = null
    }
    sendEvent("onPurchaseUpdated", mapOf("productId" to productId, "purchaseToken" to purchase.purchaseToken))
  }
}
