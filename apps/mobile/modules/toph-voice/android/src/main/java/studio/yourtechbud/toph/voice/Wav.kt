package studio.yourtechbud.toph.voice

import java.io.File
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.max

/** One range of raw.wav, in milliseconds from the start of the capture. */
internal data class MsRange(val startMs: Double, val endMs: Double)

/**
 * 16 kHz mono PCM16 WAV files with the 44-byte header Toph writes.
 *
 * Mirrors desktop's `apps/desktop/src/main/audio/wav.ts` (header fields, byte offsets, reading and
 * its validation messages) and `apps/desktop/src/main/segmentation/batch-audio-writer.ts` (cutting
 * batches out of raw.wav). Keep them in step: the parity check (`apps/desktop/scripts/parity-check.ts`)
 * guards the framing, and batch audio must cover exactly the ranges desktop would cut.
 */
internal object Wav {
  const val HEADER_BYTES = 44
  const val SAMPLE_RATE = 16_000
  private const val CHANNELS = 1
  private const val BITS_PER_SAMPLE = 16
  private const val PCM_FORMAT = 1

  /** The 44-byte header, field for field as desktop's `writeWavHeader`. */
  fun header(dataBytes: Long): ByteArray {
    val byteRate = SAMPLE_RATE * CHANNELS * (BITS_PER_SAMPLE / 8)
    val blockAlign = CHANNELS * (BITS_PER_SAMPLE / 8)
    return ByteBuffer.allocate(HEADER_BYTES).order(ByteOrder.LITTLE_ENDIAN).apply {
      put("RIFF".toByteArray(Charsets.US_ASCII))
      putInt((36 + dataBytes).toInt())
      put("WAVE".toByteArray(Charsets.US_ASCII))
      put("fmt ".toByteArray(Charsets.US_ASCII))
      putInt(16)
      putShort(PCM_FORMAT.toShort())
      putShort(CHANNELS.toShort())
      putInt(SAMPLE_RATE)
      putInt(byteRate)
      putShort(blockAlign.toShort())
      putShort(BITS_PER_SAMPLE.toShort())
      put("data".toByteArray(Charsets.US_ASCII))
      putInt(dataBytes.toInt())
    }.array()
  }

  /** Desktop's `msToPcmByteOffset`. Java's `Math.round` rounds halves up, like JS `Math.round`. */
  fun msToPcmByteOffset(ms: Double): Long = max(0L, Math.round(ms / 1000.0 * SAMPLE_RATE)) * 2

  /**
   * Writes [ranges] of [raw], in order, as one WAV at [out] (desktop's `writeBatchWavsFromRawFile`).
   * Each range is the bytes `[44 + off(start), 44 + off(end))`; empty ranges are skipped and a range
   * not yet on disk throws.
   */
  fun cutBatch(raw: File, ranges: List<MsRange>, out: File) {
    out.parentFile?.mkdirs()
    RandomAccessFile(raw, "r").use { input ->
      RandomAccessFile(out, "rw").use { output ->
        output.setLength(0)
        output.write(header(0))
        var dataBytes = 0L
        for (range in ranges) {
          val start = HEADER_BYTES + msToPcmByteOffset(range.startMs)
          val end = HEADER_BYTES + msToPcmByteOffset(range.endMs)
          val length = max(0L, end - start)
          if (length == 0L) continue
          // Desktop's message, word for word.
          if (start + length > input.length()) {
            throw IllegalStateException(
              "Raw WAV range ${formatMs(range.startMs)}-${formatMs(range.endMs)}ms is not fully available for debug audio generation.",
            )
          }
          val chunk = ByteArray(length.toInt())
          input.seek(start)
          input.readFully(chunk)
          output.write(chunk)
          dataBytes += length
        }
        output.seek(0)
        output.write(header(dataBytes))
      }
    }
  }

  /** Reads the samples of a WAV, validating exactly what desktop's `readPcm16MonoWav` validates. */
  fun readPcm16Mono(file: File): ShortArray {
    val bytes = file.readBytes()
    if (bytes.size < HEADER_BYTES) {
      throw IllegalArgumentException("WAV file is too small to contain a valid header.")
    }
    val buffer = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
    val ascii = { offset: Int -> String(bytes, offset, 4, Charsets.US_ASCII) }
    if (ascii(0) != "RIFF" || ascii(8) != "WAVE" || ascii(12) != "fmt " || ascii(36) != "data") {
      throw IllegalArgumentException("WAV file is not the simple PCM layout produced by Toph.")
    }
    val audioFormat = buffer.getShort(20).toInt() and 0xffff
    val channelCount = buffer.getShort(22).toInt() and 0xffff
    val sampleRate = buffer.getInt(24).toLong() and 0xffffffffL
    val bitsPerSample = buffer.getShort(34).toInt() and 0xffff
    val dataBytes = buffer.getInt(40).toLong() and 0xffffffffL
    if (
      audioFormat != PCM_FORMAT ||
      channelCount != CHANNELS ||
      sampleRate != SAMPLE_RATE.toLong() ||
      bitsPerSample != BITS_PER_SAMPLE
    ) {
      throw IllegalArgumentException("WAV file must be 16 kHz mono 16-bit PCM.")
    }
    if (HEADER_BYTES + dataBytes > bytes.size) {
      throw IllegalArgumentException("WAV file data chunk is incomplete.")
    }
    // Desktop frames whole samples only (`Math.floor(bytes / 2)`); an odd trailing byte is ignored.
    val samples = ShortArray((dataBytes / 2).toInt())
    buffer.position(HEADER_BYTES)
    buffer.asShortBuffer().get(samples)
    return samples
  }

  /** Little-endian PCM16 bytes of the first [count] samples. */
  fun toBytes(samples: ShortArray, count: Int): ByteArray {
    val bytes = ByteArray(count * 2)
    for (i in 0 until count) {
      val sample = samples[i].toInt()
      bytes[i * 2] = sample.toByte()
      bytes[i * 2 + 1] = (sample shr 8).toByte()
    }
    return bytes
  }

  // Matches how JS prints a number in desktop's message (`1000`, not `1000.0`).
  private fun formatMs(ms: Double): String = if (ms % 1.0 == 0.0) ms.toLong().toString() else ms.toString()
}
