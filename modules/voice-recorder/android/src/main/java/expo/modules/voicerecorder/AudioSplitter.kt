package expo.modules.voicerecorder

import android.content.Context
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMuxer
import android.util.Log
import java.io.File
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import kotlin.math.max

object AudioSplitter {
  private const val TAG = "AudioSplitter"
  private const val DEFAULT_BUFFER_SIZE = 64 * 1024
  private const val TIMEOUT_US = 10_000L
  private const val TARGET_SAMPLE_RATE = 16000
  private const val TARGET_CHANNELS = 1

  private class PcmMonoResampler(
    private val sourceSampleRate: Int,
    private val sourceChannels: Int,
    private val targetSampleRate: Int
  ) {
    private val phaseStep = sourceSampleRate.toDouble() / targetSampleRate.toDouble()
    private var phase = 0.0
    private var lastSample: Short = 0

    fun process(pcmData: ByteArray, offset: Int, size: Int, raf: RandomAccessFile): Long {
      val bytesPerFrame = sourceChannels * 2
      if (bytesPerFrame <= 0) return 0L
      val frameCount = size / bytesPerFrame
      if (frameCount == 0) return 0L

      val monoSamples = ShortArray(frameCount)
      for (i in 0 until frameCount) {
        var sum = 0
        for (c in 0 until sourceChannels) {
          val byteIdx = offset + i * bytesPerFrame + c * 2
          val low = pcmData[byteIdx].toInt() and 0xFF
          val high = pcmData[byteIdx + 1].toInt()
          val sample = (high shl 8) or low
          sum += sample
        }
        monoSamples[i] = (sum / sourceChannels).toShort()
      }

      if (sourceSampleRate == targetSampleRate) {
        val outBytes = ByteArray(frameCount * 2)
        for (i in 0 until frameCount) {
          val s = monoSamples[i].toInt()
          outBytes[i * 2] = (s and 0xFF).toByte()
          outBytes[i * 2 + 1] = ((s shr 8) and 0xFF).toByte()
        }
        raf.write(outBytes)
        return outBytes.size.toLong()
      }

      var bytesWritten = 0L
      val outByteList = ArrayList<Byte>(frameCount * 2)
      while (phase < frameCount) {
        val idx = phase.toInt()
        val frac = (phase - idx).toFloat()
        val s0 = if (idx > 0) monoSamples[idx - 1] else lastSample
        val s1 = monoSamples[idx]
        val interp = (s0 + frac * (s1 - s0)).toInt().coerceIn(-32768, 32767)
        outByteList.add((interp and 0xFF).toByte())
        outByteList.add(((interp shr 8) and 0xFF).toByte())
        phase += phaseStep
      }
      phase -= frameCount
      lastSample = monoSamples[frameCount - 1]

      val outBytes = ByteArray(outByteList.size)
      for (b in outByteList.indices) {
        outBytes[b] = outByteList[b]
      }
      if (outBytes.isNotEmpty()) {
        raf.write(outBytes)
        bytesWritten += outBytes.size
      }
      return bytesWritten
    }
  }

  private fun cleanPath(uri: String): String {
    return if (uri.startsWith("file://")) {
      uri.removePrefix("file://")
    } else {
      uri
    }
  }

  fun getAudioDuration(inputUri: String): Long {
    val cleanPath = cleanPath(inputUri)
    val file = File(cleanPath)
    if (!file.exists() || file.length() == 0L) {
      return 0L
    }

    val extractor = MediaExtractor()
    return try {
      extractor.setDataSource(file.absolutePath)
      for (i in 0 until extractor.trackCount) {
        val format = extractor.getTrackFormat(i)
        val mime = format.getString(MediaFormat.KEY_MIME) ?: ""
        if (mime.startsWith("audio/")) {
          if (format.containsKey(MediaFormat.KEY_DURATION)) {
            return format.getLong(MediaFormat.KEY_DURATION) / 1000L // microseconds to milliseconds
          }
        }
      }
      0L
    } catch (e: Exception) {
      Log.w(TAG, "Failed to get audio duration for $cleanPath", e)
      0L
    } finally {
      try {
        extractor.release()
      } catch (_: Exception) {}
    }
  }

  fun extractAudioChunk(
    context: Context,
    inputUri: String,
    startTimeMs: Long,
    durationMs: Long,
    outputDir: String
  ): Map<String, Any>? {
    val cleanInputPath = cleanPath(inputUri)
    val inputFile = File(cleanInputPath)
    if (!inputFile.exists() || inputFile.length() == 0L) {
      Log.w(TAG, "Input file does not exist or is empty: $cleanInputPath")
      return null
    }

    val cleanOutputDir = cleanPath(outputDir)
    val targetDirectory = if (cleanOutputDir.isNotEmpty()) {
      File(cleanOutputDir)
    } else {
      File(context.cacheDir, "audio_chunks")
    }
    targetDirectory.mkdirs()

    val extractor = MediaExtractor()
    try {
      extractor.setDataSource(inputFile.absolutePath)
    } catch (e: Exception) {
      Log.w(TAG, "Failed to set data source for MediaExtractor: $cleanInputPath", e)
      return null
    }

    try {
      var audioTrackIndex = -1
      var audioFormat: MediaFormat? = null

      for (i in 0 until extractor.trackCount) {
        val format = extractor.getTrackFormat(i)
        val mime = format.getString(MediaFormat.KEY_MIME) ?: ""
        if (mime.startsWith("audio/")) {
          audioTrackIndex = i
          audioFormat = format
          break
        }
      }

      if (audioTrackIndex < 0 || audioFormat == null) {
        Log.w(TAG, "No audio track found in $cleanInputPath")
        extractor.release()
        return null
      }

      val mime = audioFormat.getString(MediaFormat.KEY_MIME) ?: ""
      val totalDurationUs = if (audioFormat.containsKey(MediaFormat.KEY_DURATION)) {
        audioFormat.getLong(MediaFormat.KEY_DURATION)
      } else {
        0L
      }

      val startUs = startTimeMs * 1000L
      val targetChunkDurationUs = durationMs * 1000L
      val endUs = startUs + targetChunkDurationUs

      // If the audio track is AAC (audio/mp4a-latm), attempt fast remuxing with MediaMuxer
      if (mime == "audio/mp4a-latm") {
        try {
          val result = extractAacChunk(
            extractor,
            audioTrackIndex,
            audioFormat,
            targetDirectory,
            startUs,
            endUs,
            totalDurationUs
          )
          if (result != null) {
            extractor.release()
            return result
          }
        } catch (e: Exception) {
          Log.w(TAG, "Fast AAC remuxing failed; falling back to PCM WAV decoding: $cleanInputPath", e)
          extractor.seekTo(0L, MediaExtractor.SEEK_TO_CLOSEST_SYNC)
        }
      }

      // Universal fallback or non-AAC decoding (MP3, WAV, FLAC, OGG, etc.) via MediaCodec to WAV
      val result = extractPcmWavChunk(
        extractor,
        audioTrackIndex,
        audioFormat,
        mime,
        targetDirectory,
        startUs,
        endUs,
        totalDurationUs
      )
      extractor.release()
      return result
    } catch (e: Exception) {
      Log.e(TAG, "Failed to extract audio chunk from $cleanInputPath", e)
      try {
        extractor.release()
      } catch (_: Exception) {}
      return null
    }
  }

  private fun extractAacChunk(
    extractor: MediaExtractor,
    audioTrackIndex: Int,
    audioFormat: MediaFormat,
    targetDirectory: File,
    startUs: Long,
    endUs: Long,
    totalDurationUs: Long
  ): Map<String, Any>? {
    extractor.selectTrack(audioTrackIndex)
    if (startUs > 0) {
      extractor.seekTo(startUs, MediaExtractor.SEEK_TO_PREVIOUS_SYNC)
    } else {
      extractor.seekTo(0L, MediaExtractor.SEEK_TO_CLOSEST_SYNC)
    }

    val chunkFile = File(targetDirectory, "chunk_${startUs / 1000L}_${System.currentTimeMillis()}.m4a")
    var muxer: MediaMuxer? = null
    var success = false
    var samplesWritten = 0

    try {
      val m = MediaMuxer(chunkFile.absolutePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
      muxer = m
      val track = m.addTrack(audioFormat)
      m.start()

      val maxInputSize = if (audioFormat.containsKey(MediaFormat.KEY_MAX_INPUT_SIZE)) {
        try {
          audioFormat.getInteger(MediaFormat.KEY_MAX_INPUT_SIZE)
        } catch (_: Exception) {
          DEFAULT_BUFFER_SIZE
        }
      } else {
        DEFAULT_BUFFER_SIZE
      }
      val buffer = ByteBuffer.allocate(max(maxInputSize, DEFAULT_BUFFER_SIZE))
      val bufferInfo = MediaCodec.BufferInfo()

      var isLastChunk = false
      var firstSampleTimeUs = -1L
      var lastSampleTimeUs = -1L

      while (true) {
        buffer.clear()
        val sampleSize = extractor.readSampleData(buffer, 0)
        if (sampleSize < 0) {
          isLastChunk = true
          break
        }

        val sampleTimeUs = extractor.sampleTime
        val flags = extractor.sampleFlags

        // Skip samples before startUs if seek landed early
        if (sampleTimeUs < startUs && startUs > 0) {
          extractor.advance()
          continue
        }

        // If we crossed endUs and have already written samples, stop chunk
        if (sampleTimeUs >= endUs && samplesWritten > 0) {
          break
        }

        if (firstSampleTimeUs < 0) {
          firstSampleTimeUs = sampleTimeUs
        }
        lastSampleTimeUs = sampleTimeUs

        bufferInfo.offset = 0
        bufferInfo.size = sampleSize
        bufferInfo.presentationTimeUs = (sampleTimeUs - firstSampleTimeUs).coerceAtLeast(0L)
        bufferInfo.flags = flags

        m.writeSampleData(track, buffer, bufferInfo)
        samplesWritten++

        extractor.advance()
      }

      if (samplesWritten == 0) {
        if (startUs > 0) {
          success = true
          return mapOf(
            "chunkUri" to "",
            "durationMs" to 0L,
            "isLastChunk" to true,
            "totalDurationMs" to (totalDurationUs / 1000L)
          )
        }
        return null
      }

      if (samplesWritten > 0) {
        m.stop()
      }
      success = true

      if (totalDurationUs > 0 && endUs >= totalDurationUs) {
        isLastChunk = true
      }

      val chunkDurationMs = if (firstSampleTimeUs >= 0 && lastSampleTimeUs >= firstSampleTimeUs) {
        (lastSampleTimeUs - firstSampleTimeUs) / 1000L
      } else {
        (endUs - startUs) / 1000L
      }

      return mapOf(
        "chunkUri" to "file://${chunkFile.absolutePath}",
        "durationMs" to chunkDurationMs,
        "isLastChunk" to isLastChunk,
        "totalDurationMs" to (totalDurationUs / 1000L)
      )
    } finally {
      try {
        muxer?.release()
      } catch (_: Exception) {}
      if (!success && chunkFile.exists()) {
        try {
          chunkFile.delete()
        } catch (_: Exception) {}
      }
    }
  }

  private fun extractPcmWavChunk(
    extractor: MediaExtractor,
    audioTrackIndex: Int,
    audioFormat: MediaFormat,
    mime: String,
    targetDirectory: File,
    startUs: Long,
    endUs: Long,
    totalDurationUs: Long
  ): Map<String, Any>? {
    extractor.selectTrack(audioTrackIndex)
    if (startUs > 0) {
      extractor.seekTo(startUs, MediaExtractor.SEEK_TO_PREVIOUS_SYNC)
    } else {
      extractor.seekTo(0L, MediaExtractor.SEEK_TO_CLOSEST_SYNC)
    }

    var decoder: MediaCodec? = null
    var raf: RandomAccessFile? = null
    var chunkFile: File? = null
    var success = false

    try {
      val d = MediaCodec.createDecoderByType(mime)
      decoder = d
      d.configure(audioFormat, null, null, 0)
      d.start()

      val cf = File(targetDirectory, "chunk_${startUs / 1000L}_${System.currentTimeMillis()}.wav")
      chunkFile = cf
      val r = RandomAccessFile(cf, "rw")
      raf = r
      r.setLength(44L) // Reserve 44 bytes for RIFF/WAVE header
      r.seek(44L)

      var totalPcmBytesWritten = 0L
      var isLastChunk = false
      var sawInputEOS = false
      var sawOutputEOS = false
      var firstSampleTimeUs = -1L
      var lastSampleTimeUs = -1L
      var actualSampleRate = if (audioFormat.containsKey(MediaFormat.KEY_SAMPLE_RATE)) {
        try { audioFormat.getInteger(MediaFormat.KEY_SAMPLE_RATE) } catch (_: Exception) { 44100 }
      } else {
        44100
      }
      var actualChannels = if (audioFormat.containsKey(MediaFormat.KEY_CHANNEL_COUNT)) {
        try { audioFormat.getInteger(MediaFormat.KEY_CHANNEL_COUNT) } catch (_: Exception) { 1 }
      } else {
        1
      }

      var resampler = PcmMonoResampler(actualSampleRate, actualChannels, TARGET_SAMPLE_RATE)

      val bufferInfo = MediaCodec.BufferInfo()

      while (!sawOutputEOS) {
        if (!sawInputEOS) {
          val inputIndex = d.dequeueInputBuffer(TIMEOUT_US)
          if (inputIndex >= 0) {
            val inputBuffer = d.getInputBuffer(inputIndex)
            if (inputBuffer != null) {
              inputBuffer.clear()
              val sampleSize = extractor.readSampleData(inputBuffer, 0)
              if (sampleSize < 0) {
                sawInputEOS = true
                d.queueInputBuffer(inputIndex, 0, 0, 0L, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
              } else {
                val sampleTimeUs = extractor.sampleTime
                d.queueInputBuffer(inputIndex, 0, sampleSize, sampleTimeUs, 0)
                extractor.advance()
              }
            }
          }
        }

        val outputIndex = d.dequeueOutputBuffer(bufferInfo, TIMEOUT_US)
        if (outputIndex >= 0) {
          if (bufferInfo.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) {
            sawOutputEOS = true
            isLastChunk = true
          }

          val outputBuffer = d.getOutputBuffer(outputIndex)
          if (outputBuffer != null && bufferInfo.size > 0) {
            val sampleTimeUs = bufferInfo.presentationTimeUs

            if (sampleTimeUs >= startUs || startUs == 0L) {
              if (sampleTimeUs >= endUs && totalPcmBytesWritten > 0L) {
                if (sawInputEOS) {
                  // Extractor already reached source EOF. Continue draining decoder to observe EOS flag.
                } else {
                  sawOutputEOS = true
                }
              } else {
                if (firstSampleTimeUs < 0) {
                  firstSampleTimeUs = sampleTimeUs
                }
                lastSampleTimeUs = sampleTimeUs

                val pcmData = ByteArray(bufferInfo.size)
                outputBuffer.position(bufferInfo.offset)
                outputBuffer.get(pcmData, 0, bufferInfo.size)

                val bytesWritten = resampler.process(pcmData, 0, bufferInfo.size, r)
                totalPcmBytesWritten += bytesWritten
              }
            }
          }
          d.releaseOutputBuffer(outputIndex, false)
        } else if (outputIndex == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
          val newFormat = d.outputFormat
          if (newFormat.containsKey(MediaFormat.KEY_SAMPLE_RATE)) {
            try { actualSampleRate = newFormat.getInteger(MediaFormat.KEY_SAMPLE_RATE) } catch (_: Exception) {}
          }
          if (newFormat.containsKey(MediaFormat.KEY_CHANNEL_COUNT)) {
            try { actualChannels = newFormat.getInteger(MediaFormat.KEY_CHANNEL_COUNT) } catch (_: Exception) {}
          }
          resampler = PcmMonoResampler(actualSampleRate, actualChannels, TARGET_SAMPLE_RATE)
        }
      }

      if (totalPcmBytesWritten == 0L) {
        if (startUs > 0) {
          success = true
          return mapOf(
            "chunkUri" to "",
            "durationMs" to 0L,
            "isLastChunk" to true,
            "totalDurationMs" to (totalDurationUs / 1000L)
          )
        }
        return null
      }

      // Write canonical RIFF/WAVE 16-bit PCM header at beginning of file (16 kHz mono)
      writeWavHeader(r, totalPcmBytesWritten, TARGET_SAMPLE_RATE, TARGET_CHANNELS, 16)
      success = true

      if (totalDurationUs > 0 && endUs >= totalDurationUs) {
        isLastChunk = true
      }

      val chunkDurationMs = if (firstSampleTimeUs >= 0 && lastSampleTimeUs >= firstSampleTimeUs) {
        (lastSampleTimeUs - firstSampleTimeUs) / 1000L
      } else {
        (endUs - startUs) / 1000L
      }

      return mapOf(
        "chunkUri" to "file://${cf.absolutePath}",
        "durationMs" to chunkDurationMs,
        "isLastChunk" to isLastChunk,
        "totalDurationMs" to (totalDurationUs / 1000L)
      )
    } finally {
      try {
        raf?.close()
      } catch (_: Exception) {}
      if (!success && chunkFile != null && chunkFile.exists()) {
        try {
          chunkFile.delete()
        } catch (_: Exception) {}
      }
      try {
        decoder?.stop()
      } catch (_: Exception) {}
      try {
        decoder?.release()
      } catch (_: Exception) {}
    }
  }

  private fun writeWavHeader(
    raf: RandomAccessFile,
    pcmDataLength: Long,
    sampleRate: Int,
    channels: Int,
    bitsPerSample: Int
  ) {
    raf.seek(0)
    val totalDataLen = pcmDataLength + 36
    val byteRate = (sampleRate * channels * bitsPerSample / 8).toLong()
    val blockAlign = (channels * bitsPerSample / 8).toShort()

    val header = ByteArray(44)
    header[0] = 'R'.code.toByte()
    header[1] = 'I'.code.toByte()
    header[2] = 'F'.code.toByte()
    header[3] = 'F'.code.toByte()
    header[4] = (totalDataLen and 0xffL).toByte()
    header[5] = ((totalDataLen shr 8) and 0xffL).toByte()
    header[6] = ((totalDataLen shr 16) and 0xffL).toByte()
    header[7] = ((totalDataLen shr 24) and 0xffL).toByte()
    header[8] = 'W'.code.toByte()
    header[9] = 'A'.code.toByte()
    header[10] = 'V'.code.toByte()
    header[11] = 'E'.code.toByte()
    header[12] = 'f'.code.toByte() // 'fmt ' chunk
    header[13] = 'm'.code.toByte()
    header[14] = 't'.code.toByte()
    header[15] = ' '.code.toByte()
    header[16] = 16 // Subchunk1Size (16 for PCM)
    header[17] = 0
    header[18] = 0
    header[19] = 0
    header[20] = 1 // AudioFormat 1 = PCM
    header[21] = 0
    header[22] = (channels and 0xff).toByte()
    header[23] = ((channels shr 8) and 0xff).toByte()
    header[24] = (sampleRate and 0xff).toByte()
    header[25] = ((sampleRate shr 8) and 0xff).toByte()
    header[26] = ((sampleRate shr 16) and 0xff).toByte()
    header[27] = ((sampleRate shr 24) and 0xff).toByte()
    header[28] = (byteRate and 0xffL).toByte()
    header[29] = ((byteRate shr 8) and 0xffL).toByte()
    header[30] = ((byteRate shr 16) and 0xffL).toByte()
    header[31] = ((byteRate shr 24) and 0xffL).toByte()
    header[32] = (blockAlign.toInt() and 0xff).toByte()
    header[33] = ((blockAlign.toInt() shr 8) and 0xff).toByte()
    header[34] = (bitsPerSample and 0xff).toByte()
    header[35] = ((bitsPerSample shr 8) and 0xff).toByte()
    header[36] = 'd'.code.toByte() // 'data' chunk
    header[37] = 'a'.code.toByte()
    header[38] = 't'.code.toByte()
    header[39] = 'a'.code.toByte()
    header[40] = (pcmDataLength and 0xffL).toByte()
    header[41] = ((pcmDataLength shr 8) and 0xffL).toByte()
    header[42] = ((pcmDataLength shr 16) and 0xffL).toByte()
    header[43] = ((pcmDataLength shr 24) and 0xffL).toByte()

    raf.write(header, 0, 44)
  }

  fun splitAudio(
    context: Context,
    inputUri: String,
    chunkDurationMs: Long,
    outputDir: String
  ): List<String> {
    val totalDurationMs = getAudioDuration(inputUri)
    if (totalDurationMs <= chunkDurationMs && totalDurationMs > 0) {
      return listOf(inputUri)
    }

    val chunkPaths = mutableListOf<String>()
    var startTimeMs = 0L

    while (true) {
      val chunkResult = extractAudioChunk(context, inputUri, startTimeMs, chunkDurationMs, outputDir)
      if (chunkResult == null) {
        break
      }

      val chunkUri = chunkResult["chunkUri"] as? String
      val isLastChunk = chunkResult["isLastChunk"] as? Boolean ?: true

      if (!chunkUri.isNullOrEmpty()) {
        chunkPaths.add(chunkUri)
      }

      if (isLastChunk) {
        break
      }

      startTimeMs += chunkDurationMs
    }

    return if (chunkPaths.isNotEmpty()) {
      chunkPaths
    } else {
      listOf(inputUri)
    }
  }
}
