package expo.modules.voicerecorder

import android.content.Context
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMuxer
import android.util.Log
import java.io.File
import java.nio.ByteBuffer
import kotlin.math.max

object AudioSplitter {
  private const val TAG = "AudioSplitter"
  private const val DEFAULT_BUFFER_SIZE = 64 * 1024

  fun splitAudio(
    context: Context,
    inputUri: String,
    chunkDurationMs: Long,
    outputDir: String
  ): List<String> {
    val cleanInputPath = if (inputUri.startsWith("file://")) {
      inputUri.removePrefix("file://")
    } else {
      inputUri
    }

    val inputFile = File(cleanInputPath)
    if (!inputFile.exists() || inputFile.length() == 0L) {
      Log.w(TAG, "Input file does not exist or is empty: $cleanInputPath")
      return listOf(inputUri)
    }

    val cleanOutputDir = if (outputDir.startsWith("file://")) {
      outputDir.removePrefix("file://")
    } else {
      outputDir
    }

    val targetDirectory = if (cleanOutputDir.isNotEmpty()) {
      File(cleanOutputDir)
    } else {
      File(context.cacheDir, "audio_chunks_${System.currentTimeMillis()}")
    }
    targetDirectory.mkdirs()

    val extractor = MediaExtractor()
    try {
      extractor.setDataSource(inputFile.absolutePath)
    } catch (e: Exception) {
      Log.w(TAG, "Failed to set data source for MediaExtractor: $cleanInputPath", e)
      return listOf(inputUri)
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
        return listOf(inputUri)
      }

      val totalDurationUs = if (audioFormat.containsKey(MediaFormat.KEY_DURATION)) {
        audioFormat.getLong(MediaFormat.KEY_DURATION)
      } else {
        0L
      }

      val targetChunkDurationUs = chunkDurationMs * 1000L
      // If the file is shorter than or equal to the target chunk duration, no splitting is needed
      if (totalDurationUs > 0 && totalDurationUs <= targetChunkDurationUs) {
        extractor.release()
        return listOf(inputUri)
      }

      extractor.selectTrack(audioTrackIndex)

      val maxInputSize = if (audioFormat.containsKey(MediaFormat.KEY_MAX_INPUT_SIZE)) {
        audioFormat.getInteger(MediaFormat.KEY_MAX_INPUT_SIZE)
      } else {
        DEFAULT_BUFFER_SIZE
      }
      val buffer = ByteBuffer.allocate(max(maxInputSize, DEFAULT_BUFFER_SIZE))

      val chunkPaths = mutableListOf<String>()
      var chunkIndex = 0

      fun createMuxer(index: Int): Pair<MediaMuxer, Int> {
        val chunkFile = File(targetDirectory, "chunk_${System.currentTimeMillis()}_${index}.m4a")
        val muxer = MediaMuxer(chunkFile.absolutePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
        val track = muxer.addTrack(audioFormat)
        muxer.start()
        chunkPaths.add("file://" + chunkFile.absolutePath)
        return Pair(muxer, track)
      }

      var currentMuxerPair: Pair<MediaMuxer, Int>? = null
      var currentMuxer: MediaMuxer? = null
      var currentTrack = -1
      var chunkStartSampleTimeUs = -1L
      var samplesInChunk = 0

      val bufferInfo = MediaCodec.BufferInfo()

      while (true) {
        buffer.clear()
        val sampleSize = extractor.readSampleData(buffer, 0)
        if (sampleSize < 0) {
          break
        }

        val sampleTimeUs = extractor.sampleTime
        val flags = extractor.sampleFlags

        if (currentMuxer == null) {
          val pair = createMuxer(chunkIndex)
          currentMuxerPair = pair
          currentMuxer = pair.first
          currentTrack = pair.second
          chunkStartSampleTimeUs = sampleTimeUs
          samplesInChunk = 0
        }

        val elapsedInChunkUs = sampleTimeUs - chunkStartSampleTimeUs

        // Roll over to a new chunk when the duration threshold is reached
        if (elapsedInChunkUs >= targetChunkDurationUs && samplesInChunk > 0) {
          try {
            currentMuxer.stop()
            currentMuxer.release()
          } catch (e: Exception) {
            Log.w(TAG, "Error stopping muxer for chunk $chunkIndex", e)
          }

          chunkIndex++
          val pair = createMuxer(chunkIndex)
          currentMuxerPair = pair
          currentMuxer = pair.first
          currentTrack = pair.second
          chunkStartSampleTimeUs = sampleTimeUs
          samplesInChunk = 0
        }

        bufferInfo.offset = 0
        bufferInfo.size = sampleSize
        bufferInfo.presentationTimeUs = (sampleTimeUs - chunkStartSampleTimeUs).coerceAtLeast(0L)
        bufferInfo.flags = flags

        currentMuxer.writeSampleData(currentTrack, buffer, bufferInfo)
        samplesInChunk++

        extractor.advance()
      }

      currentMuxer?.let { muxer ->
        try {
          if (samplesInChunk > 0) {
            muxer.stop()
          }
          muxer.release()
        } catch (e: Exception) {
          Log.w(TAG, "Error closing final muxer", e)
        }
      }

      extractor.release()

      return if (chunkPaths.isNotEmpty()) {
        chunkPaths
      } else {
        listOf(inputUri)
      }
    } catch (e: Exception) {
      Log.e(TAG, "Failed to split audio: $cleanInputPath", e)
      try {
        extractor.release()
      } catch (_: Exception) {}
      return listOf(inputUri)
    }
  }
}
