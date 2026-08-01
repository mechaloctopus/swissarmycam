package expo.modules.artrace

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path

/**
 * Deterministic, high-entropy tracking marker. The exact same bitmap feeds
 * ARCore's AugmentedImageDatabase and the printable PNG export, so what the
 * user prints is bit-identical to what the tracker is searching for.
 *
 * Why a busy printed square instead of "two red dots": a sparse pair of dots
 * carries almost no visual features — a tracker can't recover rotation or
 * scale from it unambiguously. Image tracking needs hundreds of well-spread
 * high-contrast corners with no symmetry or repetition, which is exactly what
 * the seeded random block field below produces. The three distinct corner
 * glyphs (square / ring / diamond) break every rotational symmetry, and the
 * red dot is a brand accent that doubles as a fourth asymmetric mass.
 */
object LensiiMarker {
  const val NAME = "lensii-trace-marker"

  private const val GRID = 14
  private const val SEED = 0x1E45113CAFEL

  fun bitmap(size: Int = 1024): Bitmap {
    val bmp = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bmp)
    val paint = Paint(Paint.ANTI_ALIAS_FLAG)

    paint.style = Paint.Style.FILL
    paint.color = Color.WHITE
    canvas.drawRect(0f, 0f, size.toFloat(), size.toFloat(), paint)

    // Seeded LCG so every install draws the identical marker.
    var state = SEED
    fun next(): Int {
      state = state * 6364136223846793005L + 1442695040888963407L
      return ((state ushr 33) and 0x7FFFFFFF).toInt()
    }

    val margin = size * 0.06f // quiet white border — keep it when printing
    val inner = size - margin * 2
    val cell = inner / GRID
    paint.color = Color.BLACK

    for (row in 0 until GRID) {
      for (col in 0 until GRID) {
        val on = next() % 100 < 42
        val insetL = cell * ((next() % 22) / 100f)
        val insetT = cell * ((next() % 22) / 100f)
        if (!on) continue
        val x = margin + col * cell
        val y = margin + row * cell
        canvas.drawRect(x + insetL, y + insetT, x + cell, y + cell, paint)
      }
    }

    // Multi-scale structure. A single-scale random grid reads as a repetitive
    // texture to a feature matcher — ARCore scores that poorly and can confuse
    // one part of the marker for another. These few large, off-axis bars give
    // the descriptor unmistakable coarse features to hang onto as well as the
    // fine ones, which is what keeps the lock solid at arm's length AND across
    // a room.
    canvas.save()
    canvas.rotate(23f, size / 2f, size / 2f)
    canvas.drawRect(size * 0.18f, size * 0.44f, size * 0.62f, size * 0.52f, paint)
    canvas.restore()
    canvas.save()
    canvas.rotate(-52f, size / 2f, size / 2f)
    canvas.drawRect(size * 0.40f, size * 0.30f, size * 0.86f, size * 0.36f, paint)
    canvas.restore()

    val glyph = size * 0.15f
    val halo = glyph * 0.22f

    // Isolate each corner glyph in white first. Merged into the block field
    // they stop being unambiguous orientation references, which is their whole
    // job — three different shapes in three corners is what tells the tracker
    // which way up the marker is.
    paint.color = Color.WHITE
    canvas.drawRect(0f, 0f, margin + glyph + halo, margin + glyph + halo, paint)
    canvas.drawRect(size - margin - glyph - halo, 0f, size.toFloat(), margin + glyph + halo, paint)
    canvas.drawRect(0f, size - margin - glyph - halo, margin + glyph + halo, size.toFloat(), paint)
    canvas.drawRect(size - margin - glyph - halo, size - margin - glyph - halo, size.toFloat(), size.toFloat(), paint)
    paint.color = Color.BLACK

    // Top-left: solid square
    canvas.drawRect(margin, margin, margin + glyph, margin + glyph, paint)
    // Top-right: ring
    val stroke = size * 0.028f
    paint.style = Paint.Style.STROKE
    paint.strokeWidth = stroke
    canvas.drawCircle(size - margin - glyph / 2f, margin + glyph / 2f, glyph / 2f - stroke, paint)
    paint.style = Paint.Style.FILL
    // Bottom-left: diamond
    val cx = margin + glyph / 2f
    val cy = size - margin - glyph / 2f
    val diamond = Path().apply {
      moveTo(cx, cy - glyph / 2f)
      lineTo(cx + glyph / 2f, cy)
      lineTo(cx, cy + glyph / 2f)
      lineTo(cx - glyph / 2f, cy)
      close()
    }
    canvas.drawPath(diamond, paint)
    // Bottom-right: red dot (Lensii brand accent — reads as an asymmetric
    // mid-gray mass to the grayscale feature extractor)
    paint.color = Color.rgb(226, 34, 44)
    canvas.drawCircle(size - margin - glyph / 2f, size - margin - glyph / 2f, glyph / 2.6f, paint)

    return bmp
  }
}
