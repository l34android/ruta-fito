/* Gran Fondo 7 Lagos — live follow page. Static course (race.json) + live data (/api/granfondo). */
(() => {
  const $ = (id) => document.getElementById(id);
  const key = new URLSearchParams(location.search).get('k');
  const q = `k=${encodeURIComponent(key || '')}`;
  const svg = (n, cls = 'icon') => `<svg class="${cls}" aria-hidden="true"><use href="#i-${n}"/></svg>`;
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmt = (n, d = 1) => (n == null ? '—' : Number(n).toLocaleString('es-AR', { minimumFractionDigits: d, maximumFractionDigits: d }));
  const clock = (ts) => { const d = new Date(ts - 3 * 3.6e6); return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`; };
  const hm = (min) => `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`;
  const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch {} } };

  let race, map, rider, data;

  // ── Course ───────────────────────────────
  function initMap() {
    map = L.map('map', { zoomControl: true, scrollWheelZoom: false });
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 17, attribution: 'Imágenes &copy; Esri' }).addTo(map);
    const ll = race.route.map(([lon, lat]) => [lat, lon]);
    L.polyline(ll, { color: '#06121f', weight: 9, opacity: .9 }).addTo(map);
    L.polyline(ll, { color: '#2ee6c5', weight: 5 }).addTo(map);
    // climbs highlighted in yellow
    for (const c of race.climbs) {
      const seg = slice(c.startKm, c.endKm);
      if (seg.length > 1) L.polyline(seg, { color: '#ffd200', weight: 6 }).addTo(map).bindTooltip(`${fmt(c.lenKm)} km al ${fmt(c.grade)} %${c.official ? ' · subida oficial' : ''}`);
    }
    const end = (latlng, icon, label) => L.marker(latlng, { icon: L.divIcon({ className: '', html: `<div class="endpoint" title="${label}">${svg(icon)}</div>`, iconSize: [32, 32], iconAnchor: [16, 16] }), title: label, alt: label }).addTo(map);
    end(ll[0], 'map-pin', `Largada: ${race.start.label}`);
    end(ll[ll.length - 1], 'flag', `Llegada: ${race.finish.label}`);
    map.fitBounds(L.latLngBounds(ll), { padding: [24, 24] });
  }
  function cumKm() {
    if (race._cum) return race._cum;
    const R = 6371, rad = Math.PI / 180, c = [0];
    for (let i = 1; i < race.route.length; i++) {
      const [x1, y1] = race.route[i - 1], [x2, y2] = race.route[i];
      const h = Math.sin(((y2 - y1) * rad) / 2) ** 2 + Math.cos(y1 * rad) * Math.cos(y2 * rad) * Math.sin(((x2 - x1) * rad) / 2) ** 2;
      c.push(c[i - 1] + 2 * R * Math.asin(Math.sqrt(h)));
    }
    return (race._cum = c);
  }
  function slice(a, b) { const c = cumKm(); return race.route.filter((_, i) => c[i] >= a && c[i] <= b).map(([lon, lat]) => [lat, lon]); }

  function renderLakeTicks() {
    $('lake-ticks').innerHTML = (race.lakes || []).map((l) => `<span style="left:${(l.km / race.totalKm) * 100}%" title="${esc(l.name)}"></span>`).join('');
  }

  // Elevation profile as inline SVG (climbs shaded, lakes as ticks, rider marker).
  function renderProfile(km) {
    const P = race.profile || [];
    if (!P.length) { $('profile').innerHTML = '<p class="meta" style="padding:8px">Perfil no disponible.</p>'; return; }
    const W = Math.max(300, Math.round($('profile').clientWidth - 16)), H = W < 500 ? 170 : 190, pad = { l: 48, r: 8, t: 12, b: 26 };
    const maxE = Math.max(...P.map((p) => p[1])), minE = Math.min(...P.map((p) => p[1]));
    const x = (k) => pad.l + (k / race.totalKm) * (W - pad.l - pad.r);
    const y = (e) => pad.t + (1 - (e - minE) / Math.max(1, maxE - minE)) * (H - pad.t - pad.b);
    const pts = P.map((p) => `${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join(' ');
    const area = `M${x(0)},${H - pad.b} L${pts.replace(/ /g, ' L')} L${x(race.totalKm)},${H - pad.b} Z`;
    const climbs = race.climbs.map((c) => `<rect x="${x(c.startKm).toFixed(1)}" y="${pad.t}" width="${Math.max(2, x(c.endKm) - x(c.startKm)).toFixed(1)}" height="${H - pad.t - pad.b}" fill="#ffd200" opacity=".18"/>`).join('');
    const ticks = (W < 500 ? [0, 50, 100] : [0, 25, 50, 75, 100]).filter((k) => k <= race.totalKm).map((k) => `<text x="${x(k)}" y="${H - 8}" fill="#b9c9d8" font-size="12" text-anchor="middle">${k} km</text>`).join('');
    const lakes = (race.lakes || []).map((l) => `<line x1="${x(l.km)}" x2="${x(l.km)}" y1="${pad.t}" y2="${H - pad.b}" stroke="#b9c9d8" stroke-dasharray="2 4" opacity=".5"><title>${esc(l.name)}</title></line>`).join('');
    const e = km != null ? (P[Math.min(P.length - 1, Math.round(km / (P[1][0] - P[0][0])))] || P.at(-1))[1] : null;
    const me = km != null ? `<line x1="${x(km)}" x2="${x(km)}" y1="${pad.t}" y2="${H - pad.b}" stroke="#2ee6c5" stroke-width="2"/><circle cx="${x(km)}" cy="${y(e)}" r="6" fill="#2ee6c5" stroke="#06121f" stroke-width="3"/>` : '';
    $('profile').innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
      <text x="4" y="${pad.t + 10}" fill="#b9c9d8" font-size="12">${Math.round(maxE)} m</text>
      <text x="4" y="${H - pad.b}" fill="#b9c9d8" font-size="12">${Math.round(minE)} m</text>
      ${climbs}${lakes}
      <path d="${area}" fill="#16304a"/><polyline points="${pts}" fill="none" stroke="#2ee6c5" stroke-width="2"/>
      ${me}${ticks}</svg>`;
    $('gain').textContent = race.gain ? `+${fmt(race.gain, 0)} m de desnivel` : '';
  }

  // ── Live ──────────────────────────────────
  function render() {
    const v = data?.live || { started: false, km: 0 };
    $('total').textContent = fmt(race.totalKm, 0);
    $('km').textContent = fmt(v.km || 0);
    const pct = v.pct || 0;
    $('fill').style.width = `${pct}%`; $('progress').setAttribute('aria-valuenow', Math.round(pct));
    $('pct').textContent = v.finished ? `¡Llegó a ${race.finish.label}!` : v.started ? `${fmt(pct)} % · faltan ${fmt(v.remainingKm)} km · largó ${v.startedAt}` : 'Todavía no largó. El reloj arranca al cruzar la largada.';
    $('m-time').textContent = v.started ? hm(v.elapsedMin) : '—';
    $('m-avg').innerHTML = v.avgKmh ? `${fmt(v.avgKmh)}<small>km/h</small>` : '—';
    $('m-cur').innerHTML = v.curKmh != null ? `${fmt(v.curKmh)}<small>km/h</small>` : '—';
    $('m-eta').textContent = v.eta ? v.eta.clock : '—';

    const c = $('climb');
    if (v.inClimb) {
      c.classList.add('is-on'); $('climb-eyebrow').textContent = 'Subiendo ahora';
      $('climb-text').textContent = `Le faltan ${fmt(v.inClimb.leftKm)} km de subida al ${fmt(v.inClimb.grade)} %${v.inClimb.official ? ' (subida oficial)' : ''}`;
    } else if (v.nextClimb) {
      c.classList.remove('is-on'); $('climb-eyebrow').textContent = 'Próxima subida';
      $('climb-text').textContent = `En ${fmt(v.nextClimb.inKm)} km: ${fmt(v.nextClimb.lenKm)} km al ${fmt(v.nextClimb.grade)} %${v.nextClimb.official ? ' (subida oficial)' : ''}`;
    } else { c.classList.remove('is-on'); $('climb-eyebrow').textContent = 'Subidas'; $('climb-text').textContent = v.finished ? 'Terminadas. ¡Bien ahí!' : 'No quedan subidas: todo al final.'; }

    const dot = $('dot'), lt = $('live-text');
    if (!data) { dot.className = 'dot warn'; lt.textContent = 'Sin conexión, reintentando'; }
    else if (v.finished) { dot.className = 'dot ok'; lt.textContent = `Llegó · ${hm(v.elapsedMin)}`; }
    else if (!v.started) { dot.className = 'dot'; lt.textContent = 'Esperando la largada'; }
    else if (v.ageMin > 10) { dot.className = 'dot warn'; lt.textContent = `Sin señal hace ${v.ageMin} min (zona sin cobertura)`; }
    else { dot.className = 'dot ok'; lt.textContent = v.ageMin <= 2 ? 'En vivo' : `En vivo · hace ${v.ageMin} min`; }

    renderProfile(v.started ? v.km : null);
    renderRider(v);
    renderLinks();
  }
  function renderRider(v) {
    const p = data?.position;
    if (!p) { if (rider) { map.removeLayer(rider); rider = null; } return; }
    const icon = L.divIcon({ className: '', html: `<div class="rider${v.ageMin > 10 ? ' stale' : ''}">${svg('bike')}</div>`, iconSize: [44, 44], iconAnchor: [22, 22] });
    if (!rider) { rider = L.marker([p.lat, p.lon], { icon, zIndexOffset: 1000, title: 'Lean', alt: 'Posición de Lean' }).addTo(map); }
    else { rider.setLatLng([p.lat, p.lon]); rider.setIcon(icon); }
  }
  function renderLinks() {
    const l = data?.links || {}, el = $('links');
    const items = [];
    if (l.karoo) items.push(`<a class="btn btn-secondary" href="${esc(l.karoo)}" target="_blank" rel="noopener">${svg('external-link')}Karoo en vivo</a>`);
    if (l.garmin) items.push(`<a class="btn btn-secondary" href="${esc(l.garmin)}" target="_blank" rel="noopener">${svg('external-link')}Garmin LiveTrack (pulso)</a>`);
    el.innerHTML = items.join(''); el.hidden = !items.length;
  }

  // ── Aliento (shared room) ─────────────────
  let chat = [], lastId = 0;
  function bubble(m) {
    if (m.kind === 'event') return `<li class="event">${esc(m.text)} · ${clock(m.ts)}</li>`;
    const img = m.photo ? `<img src="/api/photo/${encodeURIComponent(m.photo)}?${q}" alt="Foto de Lean" loading="lazy">` : '';
    return `<li class="bubble ${m.kind === 'lean' ? 'lean' : ''}"><span class="who">${esc(m.kind === 'lean' ? 'Lean' : m.author)}</span>${img}${m.text ? `<div class="t">${esc(m.text)}</div>` : ''}<time>${clock(m.ts)}</time></li>`;
  }
  async function pollChat() {
    try {
      const r = await fetch(`/api/chat?${q}&after=${lastId}`, { cache: 'no-store' }); if (!r.ok) return;
      const j = await r.json(); const keep = new Set(j.ids); const maxK = Math.max(0, ...j.ids);
      const n0 = chat.length; chat = chat.filter((m) => keep.has(m.id) || m.id > maxK);
      if (j.messages.length) { chat.push(...j.messages); lastId = chat.at(-1).id; }
      if (j.messages.length || n0 !== chat.length || !n0) {
        const ol = $('chat'); const recent = chat.slice(-30);
        ol.innerHTML = recent.length ? recent.map(bubble).join('') : '<li class="empty">Dejale el primer mensaje de aliento.</li>';
        ol.scrollTop = ol.scrollHeight;
      }
    } catch {}
  }
  function setupComposer() {
    const setWho = (n) => { $('name-field').hidden = true; $('who').hidden = false; $('who').textContent = `como ${n} · cambiar`; };
    const saved = store.get('ruta.name'); if (saved) { $('name').value = saved; setWho(saved); }
    $('who').onclick = () => { $('name-field').hidden = false; $('who').hidden = true; $('name').focus(); };
    $('text').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('composer').requestSubmit(); } });
    $('composer').onsubmit = async (e) => {
      e.preventDefault();
      const name = $('name').value.trim(), text = $('text').value.trim(); $('form-error').textContent = '';
      if (!name) { $('name-field').hidden = false; $('form-error').textContent = 'Poné tu nombre para que Lean sepa quién lo alienta.'; $('name').focus(); return; }
      if (!text) { $('form-error').textContent = 'Escribí algo antes de enviar.'; $('text').focus(); return; }
      $('send').disabled = true;
      try {
        const r = await fetch(`/api/chat?${q}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, text }) });
        const j = await r.json();
        if (!r.ok) { $('form-error').textContent = j.error || 'No pude enviarlo. Probá de nuevo.'; return; }
        store.set('ruta.name', name); setWho(name); $('text').value = ''; await pollChat();
      } catch { $('form-error').textContent = 'Sin conexión. Tu mensaje sigue acá: probá de nuevo.'; }
      finally { $('send').disabled = false; }
    };
  }

  async function poll() {
    try {
      const r = await fetch(`/api/granfondo?${q}`, { cache: 'no-store' });
      if (r.status === 404) { $('live-text').textContent = 'Este link no funciona. Pedile a Lean uno nuevo.'; $('dot').className = 'dot warn'; return; }
      data = await r.json();
    } catch { data = null; }
    render();
  }
  async function main() {
    if (!key) { $('live-text').textContent = 'Falta el link completo. Abrilo tal cual te lo mandó Lean.'; return; }
    race = await (await fetch('race.json', { cache: 'no-store' })).json();
    initMap(); renderLakeTicks(); setupComposer();
    let rt; addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => renderProfile(data?.live?.started ? data.live.km : null), 200); });
    await poll(); await pollChat();
    setInterval(poll, 30e3); setInterval(pollChat, 20e3);
  }
  main().catch((e) => { console.error(e); $('live-text').textContent = 'No pude cargar la carrera. Recargá la página.'; });
})();
