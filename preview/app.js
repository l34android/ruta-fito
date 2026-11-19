/* Ruta Fito — modo arcade. Map + fighting-game HUD + tab bar with Ruta and Sala sheets. */
(() => {
  const S = window.SPRITES;
  const $ = (id) => document.getElementById(id);
  const key = new URLSearchParams(location.search).get('k');
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const clock = (ts) => { const d = new Date(ts - 3 * 3.6e6); return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`; };
  const arDate = () => new Date(Date.now() - 3 * 3.6e6).toISOString().slice(0, 10);
  const clean = (n) => n.replace(/ \(destino\)$/, '');
  const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch {} } };
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Pre-render sprites once.
  const IMG = {
    face: S.dataUrl(S.FACE, 3),
    faceSmall: S.dataUrl(S.FACE, 2, false),
    run: S.sheetUrl(S.FITO_FRAMES, 2),
    icon: Object.fromEntries(Object.entries(S.ICONS).map(([k, v]) => [k, S.dataUrl(v, 3)])),
  };
  document.querySelectorAll('[data-ico]').forEach((el) => { el.style.backgroundImage = `url(${S.dataUrl(S.ICONS[el.dataset.ico], 3, false)})`; });
  $('p1-face').style.backgroundImage = `url(${IMG.faceSmall})`;

  let trip, map, me, meMode = null, data = null, selectedDay = null, lastHere = null, firstBanner = true;
  const pins = {}, lines = {};

  // ── Map ───────────────────────────────────
  function initMap() {
    map = L.map('map', { zoomControl: true, attributionControl: true });
    // 2x upscaled tiles → visible pixels
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
      tileSize: 512, zoomOffset: -1, maxZoom: 16, attribution: 'Tiles &copy; Esri &middot; &copy; OpenStreetMap',
    }).addTo(map);
    const all = [];
    for (const d of trip.days) {
      const ll = d.route.map(([lon, lat]) => [lat, lon]); all.push(...ll);
      L.polyline(ll, { color: '#0b0b1a', weight: 10, opacity: 1, lineCap: 'square', lineJoin: 'miter' }).addTo(map);
      lines[d.id] = L.polyline(ll, { color: '#ffd400', weight: 5, opacity: 1, lineCap: 'square', lineJoin: 'miter' }).addTo(map);
      d.stops.forEach((s, i) => {
        if (d.id !== trip.days[0].id && i === 0) return;
        pins[s.id] = L.marker([s.lat, s.lon], { icon: stopIcon(s, false), title: s.name, alt: s.name, keyboard: true })
          .bindPopup(`<strong>${esc(clean(s.name).toUpperCase())}</strong>${esc(s.description)}`).addTo(map);
      });
    }
    map.fitBounds(L.latLngBounds(all), { padding: [20, 20] });
  }
  const stopIcon = (s, next) => L.divIcon({ className: '', html: `<div class="stop-ico sprite${next ? ' is-next' : ''}" style="background-image:url(${IMG.icon[s.type]})"></div>`, iconSize: [42, 42], iconAnchor: [21, 21] });

  function renderFito() {
    if (!data?.hasPosition) { if (me) { map.removeLayer(me); me = null; meMode = null; } return; }
    const ll = [data.position.lat, data.position.lon];
    const mode = hereStop() ? 'run' : 'face';
    const icon = mode === 'run'
      ? L.divIcon({ className: '', html: `<div class="fito-run sprite" role="img" aria-label="Fito moviendo la cola" style="background-image:url(${IMG.run.url})"></div>`, iconSize: [68, 52], iconAnchor: [34, 46] })
      : L.divIcon({ className: '', html: `<div class="fito-face sprite" role="img" aria-label="Lean y Fito en ruta" style="background-image:url(${IMG.face})"></div>`, iconSize: [54, 54], iconAnchor: [27, 27] });
    if (!me) { me = L.marker(ll, { icon, zIndexOffset: 1000, title: 'Lean y Fito' }).addTo(map); map.setView(ll, 9); }
    else { me.setLatLng(ll); if (mode !== meMode) me.setIcon(icon); }
    meMode = mode;
  }

  // ── Data helpers ──────────────────────────
  const planFor = (id) => data?.plans?.find((p) => p.dayId === id);
  const dayNow = () => data?.dayId || (trip.days.find((d) => d.date === arDate()) || trip.days[0]).id;
  function hereStop() {
    const p = planFor(dayNow()); if (!p?.live) return null;
    const i = p.stops.findIndex((x, j) => j > 0 && x.state === 'here');
    return i > 0 ? trip.days.find((d) => d.id === p.dayId).stops[i] : null;
  }

  // ── HUD ───────────────────────────────────
  function renderHud() {
    const day = trip.days.find((d) => d.id === dayNow());
    const plan = planFor(day.id);
    const km = data?.hasPosition && data.dayId === day.id ? data.km : 0;
    const pct = Math.max(0, Math.min(100, Math.round((km / day.totalKm) * 100)));
    $('bar-day-fill').style.width = `${pct}%`; $('bar-day').setAttribute('aria-valuenow', pct);
    $('day-sub').textContent = `${day.label.split(' · ')[0].toUpperCase()} · ${Math.round(km)}/${day.totalKm} KM`;

    const here = hereStop();
    let next = null, remaining = null;
    if (data?.next) { next = trip.days.flatMap((d) => d.stops).find((s) => s.id === data.next.id); }
    if (!next && !data?.arrived) next = day.stops[1];
    const target = here || next;
    $('next-icon').style.backgroundImage = target ? `url(${IMG.icon[target.type]})` : 'none';
    if (here) {
      $('next-name').textContent = clean(here.name).toUpperCase();
      $('next-sub').textContent = '¡PARADA!';
      $('timer').textContent = '00';
      $('bar-next-fill').style.width = '0%';
    } else if (data?.arrived) {
      $('next-name').textContent = '¡LLEGARON!'; $('next-sub').textContent = clean(day.stops.at(-1).name).toUpperCase(); $('timer').textContent = '00'; $('bar-next-fill').style.width = '0%';
    } else if (next) {
      const prevKm = [...day.stops].reverse().find((s) => s.km < next.km && s.id !== next.id)?.km ?? 0;
      remaining = data?.next ? data.next.etaMin : null;
      const leftKm = Math.max(0, next.km - km);
      const legPct = Math.max(0, Math.min(100, Math.round((leftKm / Math.max(1, next.km - prevKm)) * 100)));
      $('bar-next-fill').style.width = `${data?.hasPosition ? legPct : 100}%`; $('bar-next').setAttribute('aria-valuenow', legPct);
      $('next-name').textContent = clean(next.name).toUpperCase();
      $('next-sub').textContent = data?.next ? `${Math.round(leftKm)} KM · ${data.next.etaClock}` : `PREVISTO ${next.plannedArrival}`;
      $('timer').textContent = remaining == null ? '--' : String(Math.min(99, remaining)).padStart(2, '0');
    }
    // Banners: round intro once; ¡PARADA! when we arrive somewhere new.
    const hereId = here?.id || null;
    if (firstBanner) { banner(day.label.split(' · ')[0].toUpperCase()); firstBanner = false; }
    else if (hereId && hereId !== lastHere) banner('¡PARADA!');
    lastHere = hereId;

    const sig = $('signal');
    if (!data) sig.textContent = 'SIN CONEXIÓN…';
    else if (data.hiddenNearHome) sig.textContent = 'EN CASA, PREPARANDO LA SALIDA';
    else if (!data.hasPosition) sig.textContent = `SALIDA PREVISTA ${day.departure}`;
    else if (data.position.ageMin > 20) sig.textContent = `ÚLTIMA SEÑAL HACE ${data.position.ageMin} MIN`;
    else sig.textContent = '';
  }
  function banner(text) {
    const b = $('banner'); b.textContent = text; b.classList.remove('show'); void b.offsetWidth; b.classList.add('show');
  }

  // ── Ruta sheet ────────────────────────────
  function renderDays() {
    $('days').innerHTML = trip.days.map((d) => `<button class="day-btn" type="button" role="tab" data-day="${d.id}" aria-selected="${d.id === selectedDay}">${esc(d.label.split(' · ')[0].toUpperCase())}</button>`).join('');
    $('days').querySelectorAll('button').forEach((b) => b.onclick = () => { selectedDay = b.dataset.day; renderDays(); renderStops(); });
  }
  function renderStops() {
    const d = trip.days.find((x) => x.id === selectedDay);
    const plan = planFor(d.id);
    $('stops').innerHTML = d.stops.map((s, i) => {
      const ps = plan?.stops?.[i]; const live = plan?.live;
      const st = live ? ps.state : 'pending';
      let when;
      if (live && st === 'here') when = `<span class="tagline here">ACÁ DESDE ${clock(ps.arrivedAt)}</span>`;
      else if (live && st === 'visited' && ps.arrivedAt) when = `Pararon ${clock(ps.arrivedAt)}${ps.leftAt ? ` · ${Math.round((ps.leftAt - ps.arrivedAt) / 60e3)} min` : ''}`;
      else if (live && st === 'skipped') when = 'No pararon';
      else if (i === 0) when = `Salida ${d.departure}`;
      else when = `${live ? 'Llegan' : 'Previsto'} ${clock(ps?.eta || ps?.planned)}`;
      return `<li class="stop${st === 'here' ? ' is-here' : ''}${st === 'next' ? ' is-next' : ''}${st === 'visited' || st === 'skipped' ? ' is-done' : ''}">
        <span class="stop-ico sprite" style="background-image:url(${IMG.icon[s.type]})" aria-hidden="true"></span>
        <div><h3>${esc(clean(s.name).toUpperCase())}</h3><p>${when}</p><p>${esc(s.description.split('. ')[0].replace(/\.$/, ''))}.</p></div></li>`;
    }).join('');
  }

  // ── Sala ──────────────────────────────────
  let chat = [], lastId = 0, seenId = Number(store.get('ruta8.seen') || 0), chatOpen = false;
  function renderChat(newOnes) {
    const ol = $('chat');
    if (!chat.length) { ol.innerHTML = '<li class="chat-empty">Todavía no hay mensajes. ¡Escribí el primero!</li>'; return; }
    const html = (m) => {
      if (m.kind === 'event') return `<li class="msg event" data-id="${m.id}">${esc(m.text)}<time>${clock(m.ts)}</time></li>`;
      const img = m.photo ? `<a href="/api/photo/${encodeURIComponent(m.photo)}?k=${encodeURIComponent(key)}" target="_blank" rel="noopener"><img src="/api/photo/${encodeURIComponent(m.photo)}?k=${encodeURIComponent(key)}" alt="Foto de Lean" loading="lazy"></a>` : '';
      return `<li class="msg ${m.kind === 'lean' ? 'lean' : ''}" data-id="${m.id}"><span class="who">${esc(m.kind === 'lean' ? 'LEAN' : m.author.toUpperCase())}</span>${img}${m.text ? `<div class="t">${esc(m.text)}</div>` : ''}<time>${clock(m.ts)}</time></li>`;
    };
    const atBottom = ol.scrollHeight - ol.scrollTop - ol.clientHeight < 80;
    if (newOnes && ol.querySelector('.msg')) newOnes.forEach((m) => ol.insertAdjacentHTML('beforeend', html(m)));
    else ol.innerHTML = chat.map(html).join('');
    if (atBottom || !newOnes) ol.scrollTop = ol.scrollHeight;
  }
  async function pollChat() {
    try {
      const r = await fetch(`/api/chat?k=${encodeURIComponent(key)}&after=${lastId}`, { cache: 'no-store' });
      if (!r.ok) return;
      const j = await r.json();
      const keep = new Set(j.ids);
      const before = chat.length;
      chat = chat.filter((m) => keep.has(m.id) || m.id > Math.max(...j.ids, 0));
      const removed = chat.length !== before;
      if (j.messages.length) { chat.push(...j.messages); lastId = chat.at(-1).id; }
      if (removed) renderChat(); else if (j.messages.length) renderChat(lastId === j.messages.at(-1).id && before ? j.messages : null);
      if (chatOpen && lastId) { seenId = lastId; store.set('ruta8.seen', String(seenId)); }
      const unread = chat.filter((m) => m.id > seenId && m.kind !== 'event').length;
      $('badge').hidden = !unread; $('badge').textContent = unread > 9 ? '9+' : unread;
    } catch {}
  }
  function setupComposer() {
    const saved = store.get('ruta8.name');
    if (saved) { $('name').value = saved; $('name-field').hidden = true; $('who').textContent = `(como ${saved})`; }
    $('who').onclick = () => { $('name-field').hidden = false; $('name').focus(); };
    $('composer').onsubmit = async (e) => {
      e.preventDefault();
      const name = $('name').value.trim(), text = $('text').value.trim();
      $('form-error').textContent = '';
      if (!name) { $('name-field').hidden = false; $('form-error').textContent = 'Poné tu nombre para que sepan quién escribe.'; $('name').focus(); return; }
      if (!text) { $('form-error').textContent = 'Escribí algo antes de enviar.'; $('text').focus(); return; }
      $('send').disabled = true; $('send').textContent = 'ENVIANDO';
      try {
        const r = await fetch(`/api/chat?k=${encodeURIComponent(key)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, text }) });
        const j = await r.json();
        if (!r.ok) { $('form-error').textContent = j.error || 'No pude enviarlo. Probá de nuevo.'; return; }
        store.set('ruta8.name', name); $('name-field').hidden = true; $('who').textContent = `(como ${name})`;
        $('text').value = ''; await pollChat();
      } catch { $('form-error').textContent = 'Sin conexión. Tu mensaje sigue acá: probá de nuevo.'; }
      finally { $('send').disabled = false; $('send').textContent = 'ENVIAR'; }
    };
  }

  // ── Sheets + tab bar ──────────────────────
  let openSheet = null, opener = null;
  function setTab(tab) {
    document.querySelectorAll('.tab').forEach((t) => { if (t.dataset.tab === tab) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current'); });
  }
  function show(id, from) {
    if (openSheet) hide(true);
    const el = $(`sheet-${id}`); opener = from || null;
    el.hidden = false; requestAnimationFrame(() => el.classList.add('open'));
    openSheet = el; setTab(id);
    if (id === 'sala') { chatOpen = true; pollChat(); setTimeout(() => (($('name-field').hidden ? $('text') : $('name'))).focus(), reduced ? 0 : 220); }
    else el.querySelector('[data-close]').focus();
  }
  function hide(silent) {
    if (!openSheet) return;
    const el = openSheet; openSheet = null; chatOpen = false;
    el.classList.add('closing'); el.classList.remove('open');
    setTimeout(() => { el.classList.remove('closing'); if (!el.classList.contains('open')) el.hidden = true; }, reduced ? 0 : 160);
    if (!silent) { setTab('mapa'); opener?.focus(); }
  }
  document.querySelectorAll('.tab').forEach((t) => t.onclick = () => {
    const tab = t.dataset.tab;
    if (tab === 'mapa') hide(); else if (openSheet?.id === `sheet-${tab}`) hide(); else show(tab, t);
  });
  document.querySelectorAll('[data-close]').forEach((b) => b.onclick = () => hide());
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && openSheet) hide(); });

  // ── Loop ──────────────────────────────────
  async function poll() {
    try {
      const r = await fetch(`/api/public?k=${encodeURIComponent(key)}`, { cache: 'no-store' });
      if (r.status === 404) return fatal('LINK VENCIDO', 'Pedile a Lean uno nuevo.');
      data = await r.json();
    } catch { data = null; }
    if (!selectedDay || !openSheet) selectedDay = dayNow();
    renderHud(); renderFito();
    for (const [id, m] of Object.entries(pins)) m.setIcon(stopIcon(trip.days.flatMap((d) => d.stops).find((s) => s.id === id), id === data?.next?.id));
    renderDays(); renderStops();
  }
  function fatal(title, text) {
    document.body.insertAdjacentHTML('beforeend', `<div class="banner show" style="animation:none;opacity:1;white-space:normal">${esc(title)}<br><small style="font-size:14px">${esc(text)}</small></div>`);
  }

  async function main() {
    if (!key) return fatal('FALTA EL LINK', 'Abrilo tal cual te lo mandó Lean.');
    trip = await (await fetch('trip.built.json', { cache: 'no-store' })).json();
    selectedDay = dayNow();
    initMap(); setupComposer(); renderChat();
    await poll(); await pollChat();
    setInterval(poll, 30e3);
    let tick = 0;
    setInterval(() => { tick++; if (chatOpen || tick % 3 === 0) pollChat(); }, 10e3); // 10 s open, 30 s closed
  }
  main().catch((e) => { console.error(e); fatal('GAME OVER', 'No pude cargar el viaje. Recargá.'); });
})();
