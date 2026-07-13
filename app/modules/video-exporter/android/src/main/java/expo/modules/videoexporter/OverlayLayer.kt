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
  val opacity: Double
)

data class ExportLayer(
  val kind: String,
  val uri: String?,
  val text: String?,
  val color: String,
  val keyframes: List<ExportKeyframe>
)

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
            opacity = k.getDouble("opacity")
          )
        )
      }
      kfs.sortBy { it.t }
      out.add(
        ExportLayer(
          kind = o.getString("kind"),
          uri = if (!o.has("uri") || o.isNull("uri")) null else o.getString("uri"),
          text = if (!o.has("text") || o.isNull("text")) null else o.getString("text"),
          color = if (o.has("color") && !o.isNull("color")) o.getString("color") else "#FFFFFF",
          keyframes = kfs
        )
      )
    }
    return out
  }

  /** Mirrors EditorScreen.tsx's transformAt(): linear interpolation between bounding keyframes. */
  fun transformAt(layer: ExportLayer, t: Double): ExportKeyframe {
    val kfs = layer.keyframes
    if (kfs.isEmpty()) return ExportKeyframe(t, 40.0, 40.0, 1.0, 0.0, 100.0)
    if (kfs.size == 1) return kfs[0]
    if (t <= kfs.first().t) return kfs.first()
    if (t >= kfs.last().t) return kfs.last()
    for (i in 0 until kfs.size - 1) {
      val a = kfs[i]
      val b = kfs[i + 1]
      if (t in a.t..b.t) {
        val span = if (b.t - a.t == 0.0) 1.0 else b.t - a.t
        val p = (t - a.t) / span
        return ExportKeyframe(
          t = t,
          x = a.x + (b.x - a.x) * p,
          y = a.y + (b.y - a.y) * p,
          scale = a.scale + (b.scale - a.scale) * p,
          rotation = a.rotation + (b.rotation - a.rotation) * p,
          opacity = a.opacity + (b.opacity - a.opacity) * p
        )
      }
    }
    return kfs.last()
  }
}

/** Text layers are rendered at this many pixels per live-preview point, for crisper baked text. */
private const val TEXT_OVERSAMPLE = 4f

/** Renders each layer to a Bitmap once (image URI, or a drawn text label). */
object LayerBitmapFactory {
  fun build(context: Context, layer: ExportLayer): Bitmap {
    if (layer.kind == "image" && layer.uri != null) {
      loadImage(context, layer.uri)?.let { return it }
    }
    return renderText(layer.text ?: "", layer.color)
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

  private fun renderText(text: String, colorHex: String): Bitmap {
    val safeText = text.ifBlank { " " }
    val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      color = try {
        Color.parseColor(colorHex)
      } catch (e: Exception) {
        Color.WHITE
      }
      textSize = 24f * TEXT_OVERSAMPLE
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

  /** The layer's natural footprint in live-preview points (matches the RN preview's own boxes). */
  fun naturalSize(layer: ExportLayer, bitmap: Bitmap): Pair<Float, Float> {
    return if (layer.kind == "image") {
      // RN renders image layers in a fixed 100x100 box, resizeMode="contain".
      val longest = maxOf(bitmap.width, bitmap.height).toFloat().coerceAtLeast(1f)
      Pair(100f * (bitmap.width / longest), 100f * (bitmap.height / longest))
    } else {
      Pair(bitmap.width / TEXT_OVERSAMPLE, bitmap.height / TEXT_OVERSAMPLE)
    }
  }

  /** The RN layout box a layer's rotate/scale transform pivots around (its transform-origin). */
  fun layoutSize(layer: ExportLayer, naturalSize: Pair<Float, Float>): Pair<Float, Float> {
    return if (layer.kind == "image") Pair(100f, 100f) else naturalSize
  }
}
