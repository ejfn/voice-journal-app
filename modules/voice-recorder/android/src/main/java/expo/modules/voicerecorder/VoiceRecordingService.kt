package expo.modules.voicerecorder

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.MediaRecorder
import android.os.Binder
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import androidx.core.app.NotificationCompat
import java.io.File
import java.util.Locale

interface VoiceRecordingServiceListener {
  fun onStatusUpdate(isRecording: Boolean, isPaused: Boolean, durationMillis: Long, amplitude: Int)
  fun onRecordingFinished(uri: String, durationMillis: Long)
  fun onRecordingError(error: String)
}

class VoiceRecordingService : Service() {
  private val binder = LocalBinder()
  private var mediaRecorder: MediaRecorder? = null
  private val recorderLock = Any()

  @Volatile
  var isRecording = false
    private set

  @Volatile
  var isPaused = false
    private set

  private var currentFilePath: String? = null
  private var baseTime: Long = 0L
  private var pauseTime: Long = 0L
  private var totalPausedDuration: Long = 0L

  private val mainHandler = Handler(Looper.getMainLooper())
  private var statusRunnable: Runnable? = null
  private var listener: VoiceRecordingServiceListener? = null

  inner class LocalBinder : Binder() {
    fun getService(): VoiceRecordingService = this@VoiceRecordingService
  }

  override fun onBind(intent: Intent?): IBinder = binder

  fun setListener(listener: VoiceRecordingServiceListener?) {
    this.listener = listener
  }

  override fun onCreate() {
    super.onCreate()
    createNotificationChannel()
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_START -> {
        val path = intent.getStringExtra(EXTRA_FILE_PATH)
        if (path != null && !isRecording) {
          startRecordingInternal(path)
        }
      }
      ACTION_PAUSE -> {
        pauseRecordingInternal()
      }
      ACTION_RESUME -> {
        resumeRecordingInternal()
      }
      ACTION_STOP -> {
        stopRecordingInternal()
      }
    }
    return START_NOT_STICKY
  }

  private fun createNotificationChannel() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      val channel = NotificationChannel(
        CHANNEL_ID,
        "Voice Recording",
        NotificationManager.IMPORTANCE_DEFAULT
      ).apply {
        description = "Displays recording indicator and background controls"
        setShowBadge(false)
        enableVibration(false)
        vibrationPattern = null
        enableLights(false)
        setSound(null, null)
        lockscreenVisibility = Notification.VISIBILITY_PUBLIC
      }
      notificationManager.createNotificationChannel(channel)
    }
  }

  private fun buildNotification(paused: Boolean): Notification {
    val contentIntent = packageManager.getLaunchIntentForPackage(packageName)?.let { appIntent ->
      PendingIntent.getActivity(
        this,
        0,
        appIntent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
      )
    }

    val toggleIntent = Intent(this, VoiceRecordingService::class.java).apply {
      action = if (paused) ACTION_RESUME else ACTION_PAUSE
    }
    val toggleRequestCode = if (paused) 2 else 1
    val togglePendingIntent = PendingIntent.getService(
      this,
      toggleRequestCode,
      toggleIntent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )

    val stopIntent = Intent(this, VoiceRecordingService::class.java).apply {
      action = ACTION_STOP
    }
    val stopPendingIntent = PendingIntent.getService(
      this,
      3,
      stopIntent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )

    val durationMillis = getCurrentDurationMillis()
    val formattedDuration = formatDuration(durationMillis)

    val title = if (paused) "Voice Journal (Paused)" else "Voice Journal"
    val content = if (paused) {
      "Recording paused • Tap Resume to continue"
    } else {
      "Recording voice note... • Tap to open"
    }

    val iconRes = if (paused) R.drawable.ic_notification_pause else R.drawable.ic_notification_mic

    val builder = NotificationCompat.Builder(this, CHANNEL_ID)
      .setContentTitle(title)
      .setContentText(content)
      .setSmallIcon(iconRes)
      .setColor(0xFF4F46E5.toInt()) // Indigo theme accent
      .setOngoing(true)
      .setContentIntent(contentIntent)
      .setCategory(NotificationCompat.CATEGORY_SERVICE)
      .setPriority(NotificationCompat.PRIORITY_DEFAULT)
      .setSilent(true)
      .setOnlyAlertOnce(true)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)

    if (paused) {
      builder.setShowWhen(false)
      builder.setSubText(formattedDuration)
      builder.addAction(
        0,
        "Resume",
        togglePendingIntent
      )
    } else {
      builder.setShowWhen(true)
      builder.setUsesChronometer(true)
      builder.setWhen(System.currentTimeMillis() - durationMillis)
      builder.addAction(
        0,
        "Pause",
        togglePendingIntent
      )
    }

    builder.addAction(
      0,
      "Stop",
      stopPendingIntent
    )

    return builder.build()
  }

  private fun formatDuration(durationMillis: Long): String {
    val totalSeconds = (durationMillis / 1000).coerceAtLeast(0L)
    val hours = totalSeconds / 3600
    val minutes = (totalSeconds % 3600) / 60
    val seconds = totalSeconds % 60
    return if (hours > 0) {
      String.format(Locale.getDefault(), "%02d:%02d:%02d", hours, minutes, seconds)
    } else {
      String.format(Locale.getDefault(), "%02d:%02d", minutes, seconds)
    }
  }

  private fun updateNotification(paused: Boolean) {
    val notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    notificationManager.notify(NOTIFICATION_ID, buildNotification(paused))
  }

  fun startRecordingInternal(filePath: String): Boolean {
    synchronized(recorderLock) {
      if (isRecording) return true

      try {
        val cleanPath = if (filePath.startsWith("file://")) filePath.removePrefix("file://") else filePath
        val file = File(cleanPath)
        file.parentFile?.mkdirs()

        val recorder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
          MediaRecorder(this)
        } else {
          @Suppress("DEPRECATION")
          MediaRecorder()
        }

        recorder.apply {
          setAudioSource(MediaRecorder.AudioSource.MIC)
          setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
          setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
          setAudioSamplingRate(44100)
          setAudioEncodingBitRate(128000)
          setOutputFile(file.absolutePath)
          prepare()
          start()
        }

        mediaRecorder = recorder
        currentFilePath = "file://" + file.absolutePath
        isRecording = true
        isPaused = false
        baseTime = SystemClock.elapsedRealtime()
        pauseTime = 0L
        totalPausedDuration = 0L

        val notification = buildNotification(paused = false)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
          startForeground(
            NOTIFICATION_ID,
            notification,
            ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
          )
        } else {
          startForeground(NOTIFICATION_ID, notification)
        }

        startStatusTicker()
        listener?.onStatusUpdate(true, false, 0L, 0)
        return true
      } catch (e: Exception) {
        Log.e(TAG, "Failed to start MediaRecorder", e)
        listener?.onRecordingError(e.message ?: "Failed to start recording")
        cleanup()
        return false
      }
    }
  }

  fun pauseRecordingInternal(): Boolean {
    synchronized(recorderLock) {
      if (!isRecording || isPaused) return false

      try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
          mediaRecorder?.pause()
          isPaused = true
          pauseTime = SystemClock.elapsedRealtime()
          updateNotification(paused = true)
          listener?.onStatusUpdate(true, true, getCurrentDurationMillis(), 0)
          return true
        }
      } catch (e: Exception) {
        Log.e(TAG, "Failed to pause MediaRecorder", e)
      }
      return false
    }
  }

  fun resumeRecordingInternal(): Boolean {
    synchronized(recorderLock) {
      if (!isRecording || !isPaused) return false

      try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
          mediaRecorder?.resume()
          if (pauseTime > 0) {
            totalPausedDuration += SystemClock.elapsedRealtime() - pauseTime
            pauseTime = 0L
          }
          isPaused = false
          updateNotification(paused = false)
          listener?.onStatusUpdate(true, false, getCurrentDurationMillis(), 0)
          return true
        }
      } catch (e: Exception) {
        Log.e(TAG, "Failed to resume MediaRecorder", e)
      }
      return false
    }
  }

  fun stopRecordingInternal(): Pair<String, Long>? {
    synchronized(recorderLock) {
      if (!isRecording) return null

      val finalDuration = getCurrentDurationMillis()
      val path = currentFilePath ?: ""

      try {
        mediaRecorder?.apply {
          stop()
          reset()
          release()
        }
      } catch (e: Exception) {
        Log.e(TAG, "Error stopping MediaRecorder", e)
      }

      cleanup()
      listener?.onRecordingFinished(path, finalDuration)
      return Pair(path, finalDuration)
    }
  }

  fun getCurrentDurationMillis(): Long {
    if (!isRecording) return 0L
    return if (isPaused) {
      (pauseTime - baseTime - totalPausedDuration).coerceAtLeast(0L)
    } else {
      (SystemClock.elapsedRealtime() - baseTime - totalPausedDuration).coerceAtLeast(0L)
    }
  }

  private fun startStatusTicker() {
    stopStatusTicker()
    statusRunnable = object : Runnable {
      override fun run() {
        if (isRecording) {
          var amplitude = 0
          if (!isPaused) {
            try {
              amplitude = mediaRecorder?.maxAmplitude ?: 0
            } catch (_: Exception) {}
          }
          listener?.onStatusUpdate(
            isRecording,
            isPaused,
            getCurrentDurationMillis(),
            amplitude
          )
          mainHandler.postDelayed(this, 150)
        }
      }
    }
    mainHandler.post(statusRunnable!!)
  }

  private fun stopStatusTicker() {
    statusRunnable?.let { mainHandler.removeCallbacks(it) }
    statusRunnable = null
  }

  private fun cleanup() {
    stopStatusTicker()
    mediaRecorder = null
    isRecording = false
    isPaused = false
    currentFilePath = null

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
      stopForeground(STOP_FOREGROUND_REMOVE)
    } else {
      @Suppress("DEPRECATION")
      stopForeground(true)
    }
    stopSelf()
  }

  override fun onDestroy() {
    cleanup()
    super.onDestroy()
  }

  companion object {
    private const val TAG = "VoiceRecordingService"
    private const val CHANNEL_ID = "voice_journal_recording_v4"
    private const val NOTIFICATION_ID = 4001

    const val ACTION_START = "expo.modules.voicerecorder.action.START"
    const val ACTION_PAUSE = "expo.modules.voicerecorder.action.PAUSE"
    const val ACTION_RESUME = "expo.modules.voicerecorder.action.RESUME"
    const val ACTION_STOP = "expo.modules.voicerecorder.action.STOP"
    const val EXTRA_FILE_PATH = "file_path"
  }
}
