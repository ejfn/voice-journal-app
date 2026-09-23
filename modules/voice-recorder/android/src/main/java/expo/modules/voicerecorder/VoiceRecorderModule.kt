package expo.modules.voicerecorder

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.os.Build
import android.os.IBinder
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class VoiceRecorderModule : Module(), VoiceRecordingServiceListener {
  private val context: Context
    get() = appContext.reactContext ?: throw IllegalStateException("React Application Context is null")

  private var recordingService: VoiceRecordingService? = null
  private var isBound = false

  private val serviceConnection = object : ServiceConnection {
    override fun onServiceConnected(name: ComponentName?, service: IBinder?) {
      val binder = service as? VoiceRecordingService.LocalBinder
      recordingService = binder?.getService()
      recordingService?.setListener(this@VoiceRecorderModule)
      isBound = true
    }

    override fun onServiceDisconnected(name: ComponentName?) {
      recordingService?.setListener(null)
      recordingService = null
      isBound = false
    }
  }

  override fun definition() = ModuleDefinition {
    Name("VoiceRecorder")

    Events("onStatusUpdate")

    OnCreate {
      bindToServiceIfRunning()
    }

    OnDestroy {
      unbindFromService()
    }

    AsyncFunction("startRecording") { filePath: String ->
      val intent = Intent(context, VoiceRecordingService::class.java).apply {
        action = VoiceRecordingService.ACTION_START
        putExtra(VoiceRecordingService.EXTRA_FILE_PATH, filePath)
      }

      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        context.startForegroundService(intent)
      } else {
        context.startService(intent)
      }

      bindToService()
      true
    }

    AsyncFunction("pauseRecording") {
      recordingService?.pauseRecordingInternal() ?: run {
        val intent = Intent(context, VoiceRecordingService::class.java).apply {
          action = VoiceRecordingService.ACTION_PAUSE
        }
        context.startService(intent)
      }
      true
    }

    AsyncFunction("resumeRecording") {
      recordingService?.resumeRecordingInternal() ?: run {
        val intent = Intent(context, VoiceRecordingService::class.java).apply {
          action = VoiceRecordingService.ACTION_RESUME
        }
        context.startService(intent)
      }
      true
    }

    AsyncFunction("stopRecording") {
      val result = recordingService?.stopRecordingInternal()
      unbindFromService()

      mapOf(
        "uri" to (result?.first ?: ""),
        "durationMillis" to (result?.second ?: 0L)
      )
    }

    Function("getStatus") {
      val service = recordingService
      val isRecording = service?.isRecording ?: false
      val isPaused = service?.isPaused ?: false
      val durationMillis = service?.getCurrentDurationMillis() ?: 0L

      mapOf(
        "isRecording" to isRecording,
        "isPaused" to isPaused,
        "durationMillis" to durationMillis
      )
    }
  }

  private fun bindToService() {
    if (!isBound) {
      val intent = Intent(context, VoiceRecordingService::class.java)
      context.bindService(intent, serviceConnection, Context.BIND_AUTO_CREATE)
    }
  }

  private fun bindToServiceIfRunning() {
    val intent = Intent(context, VoiceRecordingService::class.java)
    context.bindService(intent, serviceConnection, 0)
  }

  private fun unbindFromService() {
    if (isBound) {
      recordingService?.setListener(null)
      try {
        context.unbindService(serviceConnection)
      } catch (_: Exception) {}
      recordingService = null
      isBound = false
    }
  }

  override fun onStatusUpdate(isRecording: Boolean, isPaused: Boolean, durationMillis: Long, amplitude: Int) {
    val normalizedMetering = if (amplitude > 0) {
      (amplitude.toDouble() / 32767.0).coerceIn(0.0, 1.0)
    } else {
      0.05
    }

    this@VoiceRecorderModule.sendEvent(
      "onStatusUpdate",
      mapOf(
        "isRecording" to isRecording,
        "isPaused" to isPaused,
        "isFinished" to false,
        "durationMillis" to durationMillis,
        "meteringLevel" to normalizedMetering
      )
    )
  }

  override fun onRecordingFinished(uri: String, durationMillis: Long) {
    this@VoiceRecorderModule.sendEvent(
      "onStatusUpdate",
      mapOf(
        "isRecording" to false,
        "isPaused" to false,
        "isFinished" to true,
        "uri" to uri,
        "durationMillis" to durationMillis
      )
    )
  }

  override fun onRecordingError(error: String) {
    this@VoiceRecorderModule.sendEvent(
      "onStatusUpdate",
      mapOf(
        "isRecording" to false,
        "isPaused" to false,
        "isFinished" to true,
        "hasError" to true,
        "error" to error
      )
    )
  }
}
