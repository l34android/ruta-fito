package ar.rutafito.karoo

import android.os.Handler
import android.os.Looper
import io.hammerhead.karooext.KarooSystemService
import io.hammerhead.karooext.extension.KarooExtension
import io.hammerhead.karooext.models.DataType
import io.hammerhead.karooext.models.HttpResponseState
import io.hammerhead.karooext.models.OnHttpResponse
import io.hammerhead.karooext.models.OnLocationChanged
import io.hammerhead.karooext.models.OnStreamState
import io.hammerhead.karooext.models.RideState
import io.hammerhead.karooext.models.StreamState
import io.hammerhead.karooext.models.SystemNotification
import org.json.JSONObject
import timber.log.Timber
import kotlin.math.roundToInt

/**
 * Sends the latest heart rate, power, cadence, speed and position to the Ruta Fito server every 15 s,
 * only while a ride is recording or paused. Requests are never queued: stale samples are dropped.
 */
class RutaExtension : KarooExtension("rutafito", "1") {
    private val karoo by lazy { KarooSystemService(applicationContext) }
    private val handler = Handler(Looper.getMainLooper())
    private val consumers = mutableListOf<String>()

    @Volatile private var hr: Double? = null
    @Volatile private var power: Double? = null
    @Volatile private var cadence: Double? = null
    @Volatile private var speedMs: Double? = null
    @Volatile private var lat: Double? = null
    @Volatile private var lon: Double? = null
    @Volatile private var locAt = 0L
    @Volatile private var state = "idle"
    @Volatile private var notifiedOk = false
    @Volatile private var notifiedError = false

    private val tick = object : Runnable {
        override fun run() {
            try { send() } catch (e: Exception) { Timber.e(e, "rutafito send failed") }
            handler.postDelayed(this, SEND_EVERY_MS)
        }
    }

    override fun onCreate() {
        super.onCreate()
        karoo.connect { connected -> Timber.i("rutafito connected=$connected") }
        stream(DataType.Type.HEART_RATE) { hr = it }
        stream(DataType.Type.SMOOTHED_3S_AVERAGE_POWER) { power = it }
        stream(DataType.Type.CADENCE) { cadence = it }
        stream(DataType.Type.SPEED) { speedMs = it }
        consumers += karoo.addConsumer<OnLocationChanged> { lat = it.lat; lon = it.lng; locAt = System.currentTimeMillis() }
        consumers += karoo.addConsumer<RideState> { s ->
            val next = when (s) {
                is RideState.Recording -> "recording"
                is RideState.Paused -> "paused"
                else -> "idle"
            }
            if (next == "recording" && state == "idle") { notifiedOk = false; notifiedError = false }
            state = next
        }
        handler.postDelayed(tick, SEND_EVERY_MS)
    }

    override fun onDestroy() {
        handler.removeCallbacks(tick)
        consumers.forEach { karoo.removeConsumer(it) }
        consumers.clear()
        karoo.disconnect()
        super.onDestroy()
    }

    private fun stream(type: String, set: (Double?) -> Unit) {
        consumers += karoo.addConsumer<OnStreamState>(OnStreamState.StartStreaming(type)) { ev ->
            set((ev.state as? StreamState.Streaming)?.dataPoint?.singleValue?.takeIf { it.isFinite() })
        }
    }

    private fun send() {
        if (state == "idle" || BuildConfig.INGEST_URL.isEmpty()) return
        // Without a recent GPS fix, send no position so the server falls back to the phone.
        val fresh = System.currentTimeMillis() - locAt < LOCATION_MAX_AGE_MS
        val body = JSONObject()
            .put("ts", System.currentTimeMillis())
            .put("state", state)
            .putOpt("lat", if (fresh) lat else null)
            .putOpt("lon", if (fresh) lon else null)
            .putOpt("hr", hr?.roundToInt())
            .putOpt("power", power?.roundToInt())
            .putOpt("cadence", cadence?.roundToInt())
            .putOpt("speedKmh", speedMs?.let { (it * 36).roundToInt() / 10.0 })
            .toString()
        var id = ""
        id = karoo.addConsumer<OnHttpResponse>(
            OnHttpResponse.MakeHttpRequest(
                "POST",
                BuildConfig.INGEST_URL,
                headers = mapOf("Content-Type" to "application/json", "X-Ruta-Key" to BuildConfig.INGEST_KEY),
                body = body.toByteArray(),
                waitForConnection = false,
            ),
            onError = { msg -> Timber.w("rutafito http error $msg") },
        ) { ev ->
            val st = ev.state
            if (st is HttpResponseState.Complete) {
                karoo.removeConsumer(id)
                if (st.statusCode == 200 && !notifiedOk) {
                    notifiedOk = true
                    karoo.dispatch(SystemNotification("rutafito-ok", "Ruta Fito: tus datos se ven en vivo"))
                } else if (st.statusCode in 400..499 && !notifiedError) {
                    notifiedError = true
                    karoo.dispatch(SystemNotification("rutafito-error", "Ruta Fito: el servidor rechazó los datos (${st.statusCode})"))
                }
            }
        }
    }

    companion object {
        private const val SEND_EVERY_MS = 15_000L
        private const val LOCATION_MAX_AGE_MS = 30_000L
    }
}
