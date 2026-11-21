package ar.rutafito.karoo

import android.app.Activity
import android.content.Context
import android.os.Bundle
import android.text.format.DateUtils
import android.util.TypedValue
import android.widget.TextView

/** Status screen: shows whether the extension is running and the result of the last upload. */
class MainActivity : Activity() {
    private lateinit var text: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        text = TextView(this).apply {
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 18f)
            setPadding(32, 48, 32, 32)
        }
        setContentView(text)
    }

    override fun onResume() {
        super.onResume()
        val p = getSharedPreferences(RutaExtension.PREFS, Context.MODE_PRIVATE)
        val at = p.getLong("at", 0L)
        val status = p.getString("status", null)
        text.text = buildString {
            append("Ruta Fito en vivo ${BuildConfig.VERSION_NAME}\n\n")
            if (status == null) append("La extensión todavía no arrancó. Reiniciá el Karoo y volvé a abrir esta pantalla.")
            else append(status).append("\n(").append(DateUtils.getRelativeTimeSpanString(at)).append(")")
            append("\n\nLos datos se envían solo mientras grabás una actividad.")
        }
    }
}
