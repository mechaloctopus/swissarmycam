package expo.modules.screenrecorder

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder

/**
 * Minimal foreground service whose only job is to satisfy Android's
 * requirement (API 29+, strictly enforced from API 34) that MediaProjection
 * capture runs inside a foreground service of type `mediaProjection`, with a
 * persistent notification the user can see and tap to stop. The actual
 * capture pipeline lives in RecorderState.
 */
class ScreenRecordService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    val channelId = "lensii_screen_record"

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val channel = NotificationChannel(channelId, "Screen recording", NotificationManager.IMPORTANCE_LOW)
      val nm = getSystemService(NotificationManager::class.java)
      nm?.createNotificationChannel(channel)
    }

    val notification: Notification = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(this, channelId)
        .setContentTitle("Lensii")
        .setContentText("Recording your screen")
        .setSmallIcon(android.R.drawable.ic_menu_camera)
        .setOngoing(true)
        .build()
    } else {
      @Suppress("DEPRECATION")
      Notification.Builder(this)
        .setContentTitle("Lensii")
        .setContentText("Recording your screen")
        .setSmallIcon(android.R.drawable.ic_menu_camera)
        .setOngoing(true)
        .build()
    }

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      startForeground(NOTIF_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION)
    } else {
      startForeground(NOTIF_ID, notification)
    }

    RecorderState.begin(applicationContext)
  }

  companion object {
    private const val NOTIF_ID = 4471
  }
}
