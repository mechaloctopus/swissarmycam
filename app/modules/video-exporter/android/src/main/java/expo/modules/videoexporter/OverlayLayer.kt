package expo.modules.videoexporter

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Rect
import android.graphics.Typeface
import android.net.Uri
import org.json.JSONArray

data class ExportKeyframe(
  val t: Double,
  val x: Double,
  val y: Double,
  val scale: Double,
  val rotation: Double,
  val opacity: Double,
  /** How this keyframe's values approach the NEXT one: linear | in | out | inOut. */
  val easing: String = "linear"
)

data class ExportLayer(
  val kind: String,
  val uri: String?,
  val text: String?,
  val color: String,
  val fontSize: Float,
  /** Visibility window in timeline (output) seconds. */
  val tIn: Double,
  val tOut: Double,
  val fadeIn: Double,
  val fadeOut: Double,
  val keyframes: List<ExportKeyframe>,
  /** Non-null = chroma-key this layer with the given key colour. */
  val keyColor: List<Float>? = null,
  val threshold: Float = 0.35f,
  val smoothing: Float = 0.15f
)

/** One clip in the timeline sequence, mirroring BaseClip in src/timeline.ts. */
data class ExportClip(
  val uri: String,
  val trimIn: Double,
  val trimOut: Double,
  val speed: Double,
  val preservePitch: Boolean,
  val muted: Boolean,
  val transition: String,
  val transitionDur: Double
) {
  fun outputDurationUs(): Long {
    val span = (trimOut - trimIn).coerceAtLeast(0.0)
    return ((span / speed.coerceAtLeast(0.01)) * 1_000_000.0).toLong()
  }

  /**
   * Audio is a straight sample copy, which is only correct at 1x. A speed
   * change needs real resampling (pitch-shifted) or time-stretching
   * (pitch-preserved); neither is built, so a retimed clip contributes
   * silence rather than audio that drifts against the retimed video.
   */
  fun canPassThroughAudio(): Boolean = !muted && speed == 1.0
}

/** The preview's on-screen footprint for each layer kind — must match src/timeline.ts. */
const val IMAGE_LAYER_BOX = 120f
const val VIDEO_LAYER_BOX_W = 160f
const val VIDEO_LAYER_BOX_H = 90f

object LayerParser {
  fun parse(json: String): List<ExportLayer> {
    val arr = JSONArray(json)
    val out = mutableListOf<ExportLayer>()
    for (i in 0 until arr.length()) {
      val o = arr.getJSONObject(i)
      val kfArr = o.getJSONArray("keyframes")
      val kfs = mutableListOf<ExportKeyframe>()
      for (j in 0 until kfArr.length()) {
        val k = kfArr.getJSONObject(j)
        kfs.add(
          ExportKeyframe(
            t = k.getDouble("t"),
            x = k.getDouble("x"),
            y = k.getDouble("y"),
            scale = k.getDouble("scale"),
            rotation = k.getDouble("rotation"),
            opacity = k.getDouble("opacity"),
            easing = if (k.has("easing") && !k.isNull("easing")) k.getString("easing") else "linear"
          )
        )
      }
      kfs.sortBy { it.t }
      val keyColorArr = if (o.has("keyColor") && !o.isNull("keyColor")) o.getJSONArray("keyColor") else null
      val keyColor = if (keyColorArr != null && keyColorArr.length() >= 3) {
        listOf(keyColorArr.getDouble(0).toFloat(), keyColorArr.getDouble(1).toFloat(), keyColorArr.getDouble(2).toFloat())
      } else null
      out.add(
        ExportLayer(
          kind = o.getString("kind"),
          uri = if (!o.has("uri") || o.isNull("uri")) null else o.getString("uri"),
          text = if (!o.has("text") || o.isNull("text")) null else o.getString("text"),
          color = if (o.has("color") && !o.isNull("color")) o.getString("color") else "#FFFFFF",
          fontSize = if (o.has("fontSize") && !o.isNull("fontSize")) o.getDouble("fontSize").toFloat() else 28f,
          tIn = if (o.has("tIn") && !o.isNull("tIn")) o.getDouble("tIn") else 0.0,
          // A missing tOut means "to the end" — Double.MAX_VALUE keeps the
          // visibility test a plain comparison with no special-casing.
          tOut = if (o.has("tOut") && !o.isNull("tOut")) o.getDouble("tOut") else Double.MAX_VALUE,
          fadeIn = if (o.has("fadeIn") && !o.isNull("fadeIn")) o.getDouble("fadeIn") else 0.0,
          fadeOut = if (o.has("fadeOut") && !o.isNull("fadeOut")) o.getDouble("fadeOut") else 0.0,
          keyframes = kfs,
          keyColor = keyColor,
          threshold = if (o.has("threshold") && !o.isNull("threshold")) o.getDouble("threshold").toFloat() else 0.35f,
          smoothing = if (o.has("smoothing") && !o.isNull("smoothing")) o.getDouble("smoothing").toFloat() else 0.15f
        )
      )
    }
    return out
  }

  fun parseClips(json: String): List<ExportClip> {
    val arr = JSONArray(json)
    val out = mutableListOf<ExportClip>()
    for (i in 0 until arr.length()) {
      val o = arr.getJSONObject(i)
      out.add(
        ExportClip(
          uri = o.getString("uri").removePrefix("file://"),
          trimIn = if (o.has("trimIn")) o.getDouble("trimIn") else 0.0,
          trimOut = if (o.has("trimOut")) o.getDouble("trimOut") else 0.0,
          speed = (if (o.has("speed")) o.getDouble("speed") else 1.0).coerceAtLeast(0.01),
          preservePitch = if (o.has("preservePitch")) o.getBoolean("preservePitch") else true,
          muted = if (o.has("muted")) o.getBoolean("muted") else false,
          transition = if (o.has("transition") && !o.isNull("transition")) o.getString("transition") else "none",
          transitionDur = if (o.has("transitionDur")) o.getDouble("transitionDur") else 0.0
        )
      )
    }
    return out
  }

  /**
   * Mirrors dipAmountAt() in src/timeline.ts: how black the composite goes at
   * timeline time `t`, from dip transitions on either side of each cut. Half
   * the transition rides on each clip so the blackest point is the cut itself.
   */
  fun dipAmountAt(clips: List<ExportClip>, clipStartsUs: LongArray, t: Double): Float {
    var dip = 0.0
    for (i in 1 until clips.size) {
      val c = clips[i]
      if (c.transition != "dip" || c.transitionDur <= 0.0) continue
      val cut = clipStartsUs[i] / 1_000_000.0
      val half = c.transitionDur / 2.0
      if (t >= cut - half && t <= cut + half) {
        dip = maxOf(dip, 1.0 - Math.abs(t - cut) / half)
      }
    }
    return dip.coerceIn(0.0, 1.0).toFloat()
  }

  /** Mirrors ease() in src/timeline.ts. */
  private fun ease(p: Double, kind: String): Double {
    val c = p.coerceIn(0.0, 1.0)
    return when (kind) {
      "in" -> c * c
      "out" -> 1 - (1 - c) * (1 - c)
      "inOut" -> if (c < 0.5) 2 * c * c else 1 - 2 * (1 - c) * (1 - c)
      else -> c
    }
  }

  /** Mirrors transformAt() in src/timeline.ts. */
  fun transformAt(layer: ExportLayer, t: Double): ExportKeyframe {
    val kfs = layer.keyframes
    if (kfs.isEmpty()) return ExportKeyframe(t, 40.0, 40.0, 1.0, 0.0, 100.0)
    if (kfs.size == 1) return kfs[0].copy(t = t)
    if (t <= kfs.first().t) return kfs.first().copy(t = t)
    if (t >= kfs.last().t) return kfs.last().copy(t = t)
    for (i in 0 until kfs.size - 1) {
      val a = kfs[i]
      val b = kfs[i + 1]
      if (t in a.t..b.t) {
        val span = if (b.t - a.t == 0.0) 1.0 else b.t - a.t
        val p = ease((t - a.t) / span, a.easing)
        return ExportKeyframe(
          t = t,
          x = a.x + (b.x - a.x) * p,
          y = a.y + (b.y - a.y) * p,
          scale = a.scale + (b.scale - a.scale) * p,
          rotation = a.rotation + (b.rotation - a.rotation) * p,
          opacity = a.opacity + (b.opacity - a.opacity) * p,
          easing = a.easing
        )
      }
    }
    return kfs.last().copy(t = t)
  }

  fun isVisibleAt(layer: ExportLayer, t: Double): Boolean = t >= layer.tIn && t <= layer.tOut

  /**
   * Mirrors alphaAt() in src/timeline.ts: keyframed opacity times the in/out
   * fade envelope, and 0 outside the visibility window — so the engine can use
   * this alone to decide whether to draw a layer at all.
   */
  fun alphaAt(layer: ExportLayer, t: Double): Float {
    if (!isVisibleAt(layer, t)) return 0f
    val base = transformAt(layer, t).opacity / 100.0
    var env = 1.0
    if (layer.fadeIn > 0 && t < layer.tIn + layer.fadeIn) {
      env = minOf(env, (t - layer.tIn) / layer.fadeIn)
    }
    if (layer.fadeOut > 0 && layer.tOut != Double.MAX_VALUE && t > layer.tOut - layer.fadeOut) {
      env = minOf(env, (layer.tOut - t) / layer.fadeOut)
    }
    return (base * env.coerceIn(0.0, 1.0)).coerceIn(0.0, 1.0).toFloat()
  }
}

/** Text layers are rendered at this many pixels per preview point, for crisper baked text. */
private const val TEXT_OVERSAMPLE = 4f

/** Renders a still layer (image or drawn text) to a Bitmap once. */
object LayerBitmapFactory {
  fun build(context: Context, layer: ExportLayer): Bitmap {
    if ((layer.kind == "image" || layer.kind == "gif") && layer.uri != null) {
      loadImage(context, layer.uri)?.let { return it }
    }
    return renderText(layer.text ?: "", layer.color, layer.fontSize)
  }

  private fun loadImage(context: Context, uri: String): Bitmap? = try {
    if (uri.startsWith("file://") || uri.startsWith("/")) {
      BitmapFactory.decodeFile(uri.removePrefix("file://"))
    } else {
      context.contentResolver.openInputStream(Uri.parse(uri))?.use { BitmapFactory.decodeStream(it) }
    }
  } catch (e: Exception) {
    null
  }

  private fun renderText(text: String, colorHex: String, fontSize: Float): Bitmap {
    val safeText = text.ifBlank { " " }
    val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      color = try {
        Color.parseColor(colorHex)
      } catch (e: Exception) {
        Color.WHITE
      }
      textSize = fontSize * TEXT_OVERSAMPLE
      typeface = Typeface.DEFAULT_BOLD
    }
    val bounds = Rect()
    paint.getTextBounds(safeText, 0, safeText.length, bounds)
    val pad = (8f * TEXT_OVERSAMPLE).toInt()
    val width = (paint.measureText(safeText).toInt() + pad * 2).coerceAtLeast(1)
    val height = (bounds.height() + pad * 2).coerceAtLeast(1)
    val bmp = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
    Canvas(bmp).drawText(safeText, pad.toFloat(), height - pad - bounds.bottom.toFloat(), paint)
    return bmp
  }

  /** The layer's natural footprint in preview points (matches the RN preview's boxes). */
  fun naturalSize(layer: ExportLayer, bitmap: Bitmap): Pair<Float, Float> {
    return if (layer.kind == "image" || layer.kind == "gif") {
      // RN renders these in a fixed square box with contentFit="contain".
      val longest = maxOf(bitmap.width, bitmap.height).toFloat().coerceAtLeast(1f)
      Pair(IMAGE_LAYER_BOX * (bitmap.width / longest), IMAGE_LAYER_BOX * (bitmap.height / longest))
    } else {
      Pair(bitmap.width / TEXT_OVERSAMPLE, bitmap.height / TEXT_OVERSAMPLE)
    }
  }

  /** The RN layout box a layer's rotate/scale pivots around (its transform-origin). */
  fun layoutSize(layer: ExportLayer, naturalSize: Pair<Float, Float>): Pair<Float, Float> {
    return if (layer.kind == "image" || layer.kind == "gif") Pair(IMAGE_LAYER_BOX, IMAGE_LAYER_BOX) else naturalSize
  }
}

/** Video layers pivot/size around the same box the preview shows for them. */
fun videoLayerNaturalSize(): Pair<Float, Float> = Pair(VIDEO_LAYER_BOX_W, VIDEO_LAYER_BOX_H)
