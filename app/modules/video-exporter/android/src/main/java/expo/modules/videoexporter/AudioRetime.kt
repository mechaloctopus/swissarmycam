package expo.modules.videoexporter

/**
 * PCM retiming primitives for export audio. Both operate on interleaved
 * 16-bit PCM and stream: push() input chunks in, pull processed output out,
 * flush() at the end. Streaming (rather than whole-clip arrays) keeps memory
 * flat no matter how long a clip is.
 */

/**
 * Linear-interpolation resampler. Consuming input at `ratio` input-samples
 * per output-sample changes duration by 1/ratio and shifts pitch by ratio —
 * the classic chipmunk/slow-mo sound. Also serves as the sample-rate
 * converter (ratio = srcRate/dstRate), which at 1x speed is pitch-neutral.
 */
class LinearResampler(private val channels: Int, private val ratio: Double) {
  private var carry = ShortArray(0)
  /** Fractional read position, in frames, relative to the start of `carry`. */
  private var pos = 0.0

  fun push(input: ShortArray, out: MutableList<Short>) {
    val buf = ShortArray(carry.size + input.size)
    carry.copyInto(buf, 0)
    input.copyInto(buf, carry.size)
    val frames = buf.size / channels
    // Interpolation needs frame i and i+1, so stop one frame short.
    while (pos + 1.0 < frames) {
      val i = pos.toInt()
      val frac = pos - i
      for (c in 0 until channels) {
        val a = buf[i * channels + c].toDouble()
        val b = buf[(i + 1) * channels + c].toDouble()
        out.add((a + (b - a) * frac).toInt().coerceIn(-32768, 32767).toShort())
      }
      pos += ratio
    }
    // Keep the tail from the last fully-consumed frame onward.
    val keepFrom = pos.toInt()
    carry = buf.copyOfRange(keepFrom * channels, buf.size)
    pos -= keepFrom
  }

  fun flush(out: MutableList<Short>) {
    // Emit the final frame(s) without a lookahead partner by holding the last value.
    val frames = carry.size / channels
    while (pos < frames) {
      val i = pos.toInt()
      for (c in 0 until channels) out.add(carry[i * channels + c])
      pos += ratio
    }
    carry = ShortArray(0)
  }
}

/**
 * WSOLA (waveform-similarity overlap-add) time-stretcher: changes duration
 * by 1/speed while keeping pitch. Windows of ~30ms are overlap-added at a
 * fixed synthesis hop while the analysis position advances at speed x hop;
 * each analysis window is nudged within ±search range to the offset that
 * best matches the previous output tail (cross-correlation on a mono
 * mixdown), which is what avoids the metallic artifacts of naive OLA.
 *
 * Quality is "good for speech and ambient sound, serviceable for music" —
 * the same tier as the widely-used Sonic library, not a phase vocoder.
 */
class WsolaStretcher(private val channels: Int, sampleRate: Int, private val speed: Double) {
  private val window = (sampleRate * 0.03).toInt().coerceAtLeast(256) // ~30ms frames
  private val hopOut = window / 2
  private val hopIn = (hopOut * speed).toInt().coerceAtLeast(1)
  private val search = (window / 4).coerceAtLeast(64)
  // Correlate only within the held tail — longer would wrap around it.
  private val corrLen = minOf(256, window / 2)

  private var input = ShortArray(0)
  private var inputFrames = 0
  /** The previous synthesis frame's second half, awaiting overlap-add. */
  private var tail = FloatArray(hopOut * channels)
  private var primed = false
  private var analysisPos = 0

  private fun mono(idx: Int): Float {
    var s = 0f
    for (c in 0 until channels) s += input[idx * channels + c].toFloat()
    return s / channels
  }

  fun push(chunk: ShortArray, out: MutableList<Short>) {
    val merged = ShortArray(input.size + chunk.size)
    input.copyInto(merged, 0)
    chunk.copyInto(merged, input.size)
    input = merged
    inputFrames = input.size / channels
    drain(out)
  }

  private fun drain(out: MutableList<Short>) {
    while (analysisPos + window + search < inputFrames) {
      // Find the offset in [-search, +search] whose window start best
      // continues the current output tail.
      var best = 0
      if (primed) {
        var bestScore = Float.NEGATIVE_INFINITY
        var off = -search
        while (off <= search) {
          val start = analysisPos + off
          if (start >= 0 && start + corrLen < inputFrames) {
            var score = 0f
            for (i in 0 until corrLen) {
              score += tail[i * channels] * mono(start + i)
            }
            if (score > bestScore) {
              bestScore = score
              best = off
            }
          }
          off += 4
        }
      }
      val start = (analysisPos + best).coerceAtLeast(0)

      // Overlap-add: first half of this window crossfades with the held tail.
      for (i in 0 until hopOut) {
        val fadeIn = i.toFloat() / hopOut
        val fadeOut = 1f - fadeIn
        for (c in 0 until channels) {
          val fresh = input[(start + i) * channels + c].toFloat()
          val mixed = if (primed) tail[i * channels + c] * fadeOut + fresh * fadeIn else fresh
          out.add(mixed.toInt().coerceIn(-32768, 32767).toShort())
        }
      }
      // Second half becomes the next tail.
      for (i in 0 until hopOut) {
        for (c in 0 until channels) {
          tail[i * channels + c] = input[(start + hopOut + i) * channels + c].toFloat()
        }
      }
      primed = true
      analysisPos += hopIn

      // Drop input we can no longer reach (analysisPos - search margin).
      val drop = (analysisPos - search).coerceAtLeast(0)
      if (drop > 4096) {
        input = input.copyOfRange(drop * channels, input.size)
        inputFrames -= drop
        analysisPos -= drop
      }
    }
  }

  fun flush(out: MutableList<Short>) {
    // Emit the held tail as-is so the stream doesn't end mid-crossfade.
    if (primed) {
      for (i in 0 until hopOut) {
        for (c in 0 until channels) {
          out.add(tail[i * channels + c].toInt().coerceIn(-32768, 32767).toShort())
        }
      }
    }
    input = ShortArray(0)
    inputFrames = 0
    primed = false
  }
}

/** Interleaved channel-count conversion: mono<->stereo and a safe general fallback. */
object ChannelMixer {
  fun convert(input: ShortArray, from: Int, to: Int): ShortArray {
    if (from == to) return input
    val frames = input.size / from
    val out = ShortArray(frames * to)
    for (f in 0 until frames) {
      when {
        from == 1 -> for (c in 0 until to) out[f * to + c] = input[f]
        to == 1 -> {
          var sum = 0
          for (c in 0 until from) sum += input[f * from + c]
          out[f] = (sum / from).toShort()
        }
        else -> for (c in 0 until to) out[f * to + c] = input[f * from + (c % from)]
      }
    }
    return out
  }
}
