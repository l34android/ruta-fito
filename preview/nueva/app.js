/* Ruta Fito — nueva vista: full-screen map, next-stop mini card, tab bar, Ruta and Sala sheets. */
(() => {
  const F = window.FITO;
  const $ = (id) => document.getElementById(id);
  const key = new URLSearchParams(location.search).get('k');
  const q = `k=${encodeURIComponent(key || '')}`;
  const TYPE = {
    salida: { icon: 'map-pin', label: 'Salida' }, descanso: { icon: 'trees', label: 'Descanso con verde' },
    nafta: { icon: 'gas-station', label: 'Carga de nafta' }, noche: { icon: 'bed', label: 'Noche' }, destino: { icon: 'flag', label: 'Destino' },
  };
  const ACCENT = '#32d74b', MUTED = '#636366';
  const svg = (n, cls = 'icon') => `<svg class="${cls}" aria-hidden="true"><use href="#i-${n}"/></svg>`;
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const clock = (ts) => { const d = new Date(ts - 3 * 3.6e6); return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`; };
  const arDate = () => new Date(Date.now() - 3 * 3.6e6).toISOString().slice(0, 10);
  const clean = (n) => n.replace(/ \(destino\)$/, '');
  const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch {} } };
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fmtDur = (m) => `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;

  let trip, map, me, meMode = null, data = null, selectedDay = null, userPickedDay = false;
  const pins = {}, lines = {};
  $('status-avatar').innerHTML = F.face('Fito');

  function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 3000); }

  // ── Map ───────────────────────────────────
  const allStops = () => trip.days.flatMap((d) => d.stops);
  const pinIcon = (s, next) => L.divIcon({ className: '', html: `<div class="pin${next ? ' is-next' : ''}">${svg(TYPE[s.type].icon)}</div>`, iconSize: [36, 36], iconAnchor: [18, 18] });
  function initMap() {
    map = L.map('map', { zoomControl: false });
    L.control.zoom({ position: 'topright' }).addTo(map);
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', { maxZoom: 16, attribution: 'Tiles &copy; Esri &middot; HERE, Garmin, &copy; OpenStreetMap' }).addTo(map);
    const all = [];
    for (const d of trip.days) {
      const ll = d.route.map(([lon, lat]) => [lat, lon]); all.push(...ll);
      lines[d.id] = L.polyline(ll, { color: MUTED, weight: 5, lineCap: 'round' }).addTo(map);
      d.stops.forEach((s, i) => {
        if (d.id !== trip.days[0].id && i === 0) return;
        pins[s.id] = L.marker([s.lat, s.lon], { icon: pinIcon(s, false), title: s.name, alt: `${TYPE[s.type].label}: ${s.name}`, keyboard: true })
          .bindPopup(`<strong>${esc(clean(s.name))}</strong>${esc(s.description)}`).addTo(map);
      });
    }
    map.fitBounds(L.latLngBounds(all), { padding: [40, 40] });
  }
  function highlight() {
    const cur = dayNow();
    for (const [id, l] of Object.entries(lines)) { l.setStyle({ color: id === cur ? ACCENT : MUTED }); if (id === cur) l.bringToFront(); }
    const nextId = data?.next?.id;
    for (const [id, m] of Object.entries(pins)) m.setIcon(pinIcon(allStops().find((s) => s.id === id), id === nextId));
  }
  function renderFito() {
    if (!data?.hasPosition) { if (me) { map.removeLayer(me); me = null; meMode = null; } return; }
    const ll = [data.position.lat, data.position.lon];
    const here = hereStop();
    const mode = here ? 'standing' : 'avatar';
    const stale = data.position.ageMin > 20;
    const icon = mode === 'standing'
      ? L.divIcon({ className: '', html: `<div class="fito-standing">${F.body(`Fito moviendo la cola en ${clean(here.name)}`)}</div>`, iconSize: [104, 78], iconAnchor: [52, 72] })
      : L.divIcon({ className: '', html: `<div class="fito-avatar${stale ? ' is-stale' : ''}">${F.face('Lean y Fito en ruta')}</div>`, iconSize: [56, 56], iconAnchor: [28, 28] });
    const modeKey = mode + stale;
    if (!me) { me = L.marker(ll, { icon, zIndexOffset: 1000, title: 'Lean y Fito' }).addTo(map); map.setView(ll, 9); }
    else { me.setLatLng(ll); if (modeKey !== meMode) me.setIcon(icon); }
    meMode = modeKey;
  }

  // ── Data helpers ──────────────────────────
  const planFor = (id) => data?.plans?.find((p) => p.dayId === id);
  const dayNow = () => data?.dayId || (trip.days.find((d) => d.date === arDate()) || trip.days[0]).id;
  function hereStop() {
    const p = planFor(dayNow()); if (!p?.live) return null;
    const i = p.stops.findIndex((x, j) => j > 0 && x.state === 'here');
    return i > 0 ? trip.days.find((d) => d.id === p.dayId).stops[i] : null;
  }

  // ── Status + mini card ────────────────────
  function renderStatus() {
    const day = trip.days.find((d) => d.id === dayNow());
    const dot = $('dot'); let txt, cls = '';
    if (!data) { txt = 'Sin conexión, reintentando'; cls = 'warn'; }
    else if (data.hiddenNearHome) txt = 'En casa, preparando la salida';
    else if (!data.hasPosition) txt = `${day.label} · salida ${day.departure}`;
    else if (data.position.ageMin > 20) { txt = `Última señal hace ${data.position.ageMin} min`; cls = 'warn'; }
    else { txt = `En vivo · ${day.label.split(' · ')[0]}`; cls = 'ok'; }
    dot.className = `dot ${cls}`; $('status-sub').textContent = txt;
  }
  function renderMini() {
    const day = trip.days.find((d) => d.id === dayNow());
    const plan = planFor(day.id);
    const here = hereStop();
    let s, eyebrow = 'Próxima parada', meta = '', isHere = false;
    if (data?.arrived) {
      s = day.stops.at(-1); eyebrow = s.type === 'destino' ? '¡Llegaron!' : 'Hacen noche en'; meta = s.type === 'destino' ? 'Viaje completo' : 'Mañana sigue la ruta'; isHere = true;
    } else if (here) {
      const i = day.stops.indexOf(here);
      s = here; isHere = true; eyebrow = 'Parados ahora';
      meta = `Desde las ${clock(plan.stops[i].arrivedAt)} · ${here.type === 'descanso' ? 'Fito está estirando las patas' : here.type === 'nafta' ? 'cargando nafta' : TYPE[here.type].label.toLowerCase()}`;
    } else {
      s = data?.next ? allStops().find((x) => x.id === data.next.id) : day.stops[1];
      if (data?.next && data.hasPosition) {
        const left = Math.max(0, Math.round(s.km - (data.km || 0)));
        meta = `${left} km · llegan ${data.next.etaClock} · en ${data.next.etaMin} min`;
      } else meta = `Previsto ${s.plannedArrival} · km ${Math.round(s.km)}`;
    }
    $('mini-icon').innerHTML = svg(TYPE[s.type].icon); $('mini-icon').classList.toggle('is-next', true);
    $('mini-eyebrow').textContent = eyebrow; $('mini-eyebrow').classList.toggle('is-here', isHere);
    $('mini-name').textContent = clean(s.name); $('mini-meta').textContent = meta;
    $('mini').setAttribute('aria-label', `${eyebrow}: ${clean(s.name)}. ${meta}. Abrir la ruta`);
    $('mini').dataset.stop = s.id;
  }

  // ── Ruta ──────────────────────────────────
  function renderDays() {
    $('days').innerHTML = trip.days.map((d) => `<button class="segment" type="button" role="tab" data-day="${d.id}" aria-selected="${d.id === selectedDay}">${esc(d.label)}</button>`).join('');
    $('days').querySelectorAll('button').forEach((b) => b.onclick = () => { userPickedDay = true; selectedDay = b.dataset.day; renderDays(); renderStops(); });
  }
  function renderStops() {
    const d = trip.days.find((x) => x.id === selectedDay);
    const plan = planFor(d.id);
    $('day-stats').innerHTML = `<div><dt>Distancia</dt><dd>${d.totalKm} km</dd></div><div><dt>Manejando</dt><dd>${fmtDur(d.driveMin)}</dd></div><div><dt>${plan?.live ? 'Llegada en vivo' : 'Llegada estimada'}</dt><dd>${plan?.live ? clock(plan.endEta) : d.plannedEnd}</dd></div>`;
    $('stops').innerHTML = d.stops.map((s, i) => {
      const ps = plan?.stops?.[i]; const live = plan?.live; const st = live ? ps.state : 'pending';
      let when;
      if (live && st === 'here') when = `<span class="here">Están acá desde las ${clock(ps.arrivedAt)}</span>`;
      else if (live && st === 'visited' && ps.arrivedAt) when = `Pararon a las ${clock(ps.arrivedAt)}${ps.leftAt ? ` · ${Math.round((ps.leftAt - ps.arrivedAt) / 60e3)} min` : ''}`;
      else if (live && st === 'skipped') when = 'No pararon';
      else if (i === 0) when = `Salida ${d.departure}`;
      else when = `${live ? 'Llegan' : 'Previsto'} ${clock(ps?.eta || ps?.planned)} · km ${Math.round(s.km)}`;
      return `<li class="row${st === 'visited' ? ' is-visited' : ''}${st === 'visited' || st === 'skipped' ? ' is-done' : ''}" id="row-${s.id}">
        <span class="type-tile${st === 'next' || st === 'here' ? ' is-next' : ''}" title="${TYPE[s.type].label}">${svg(st === 'visited' ? 'circle-check' : TYPE[s.type].icon)}</span>
        <div><h3 class="row-title">${esc(clean(s.name))}</h3><p class="row-meta">${when}</p><p class="row-desc">${esc(s.description.split('. ')[0].replace(/\.$/, ''))}.</p></div></li>`;
    }).join('');
  }

  // ── Sala ──────────────────────────────────
  let chat = [], lastId = 0, seenId = Number(store.get('ruta.seen') || 0), chatOpen = false;
  function bubble(m) {
    if (m.kind === 'event') return `<li class="event" data-id="${m.id}">${svg('map-pin')}<span>${esc(m.text)} · ${clock(m.ts)}</span></li>`;
    const photo = m.photo ? `<a href="/api/photo/${encodeURIComponent(m.photo)}?${q}" target="_blank" rel="noopener"><img src="/api/photo/${encodeURIComponent(m.photo)}?${q}" alt="Foto de Lean" loading="lazy"></a>` : '';
    return `<li class="bubble ${m.kind === 'lean' ? 'lean' : ''}" data-id="${m.id}"><span class="who">${esc(m.kind === 'lean' ? 'Lean' : m.author)}</span>${photo}${m.text ? `<div class="t">${esc(m.text)}</div>` : ''}<time>${clock(m.ts)}</time></li>`;
  }
  function renderChat() {
    const ol = $('chat');
    const atBottom = ol.scrollHeight - ol.scrollTop - ol.clientHeight < 80;
    ol.innerHTML = chat.length ? chat.map(bubble).join('') : '<li class="chat-empty">Todavía no hay mensajes. Escribile algo a Lean y Fito.</li>';
    if (atBottom || chatOpen) ol.scrollTop = ol.scrollHeight;
  }
  async function pollChat() {
    try {
      const r = await fetch(`/api/chat?${q}&after=${lastId}`, { cache: 'no-store' });
      if (!r.ok) return;
      const j = await r.json();
      const keep = new Set(j.ids); const maxKept = Math.max(0, ...j.ids);
      const before = chat.length;
      chat = chat.filter((m) => keep.has(m.id) || m.id > maxKept);
      if (j.messages.length) { chat.push(...j.messages); lastId = chat.at(-1).id; }
      if (j.messages.length || chat.length !== before) renderChat();
      if (chatOpen && lastId) { seenId = lastId; store.set('ruta.seen', String(seenId)); }
      const unread = chat.filter((m) => m.id > seenId && m.kind !== 'event').length;
      $('badge').hidden = !unread; $('badge').textContent = unread > 9 ? '9+' : unread;
      $('badge').setAttribute('aria-label', `${unread} mensajes nuevos`);
    } catch {}
  }
  function setupComposer() {
    const saved = store.get('ruta.name');
    const setWho = (n) => { $('name-field').hidden = true; $('who').hidden = false; $('who').textContent = `como ${n} · cambiar`; };
    if (saved) { $('name').value = saved; setWho(saved); }
    $('who').onclick = () => { $('name-field').hidden = false; $('who').hidden = true; $('name').focus(); };
    $('text').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('composer').requestSubmit(); } });
    $('composer').onsubmit = async (e) => {
      e.preventDefault();
      const name = $('name').value.trim(), text = $('text').value.trim();
      $('form-error').textContent = '';
      if (!name) { $('name-field').hidden = false; $('form-error').textContent = 'Poné tu nombre para que sepan quién escribe.'; $('name').focus(); return; }
      if (!text) { $('form-error').textContent = 'Escribí algo antes de enviar.'; $('text').focus(); return; }
      $('send').disabled = true;
      try {
        const r = await fetch(`/api/chat?${q}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, text }) });
        const j = await r.json();
        if (!r.ok) { $('form-error').textContent = j.error || 'No pude enviarlo. Probá de nuevo.'; return; }
        store.set('ruta.name', name); setWho(name);
        $('text').value = ''; await pollChat(); $('text').focus();
      } catch { $('form-error').textContent = 'Sin conexión. Tu mensaje sigue acá: probá de nuevo.'; }
      finally { $('send').disabled = false; }
    };
  }

  // ── Sheets + tabs ─────────────────────────
  let openSheet = null, opener = null;
  const setTab = (tab) => document.querySelectorAll('.tab').forEach((t) => { if (t.dataset.tab === tab) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current'); });
  function show(id, from, focusStop) {
    if (openSheet && openSheet.id !== `sheet-${id}`) hide(true);
    const el = $(`sheet-${id}`); opener = from || null;
    el.hidden = false; requestAnimationFrame(() => el.classList.add('open'));
    openSheet = el; setTab(id);
    if (id === 'sala') { chatOpen = true; pollChat(); setTimeout(() => ($('name-field').hidden ? $('text') : $('name')).focus(), reduced ? 0 : 220); }
    else {
      if (!userPickedDay) { selectedDay = dayNow(); renderDays(); renderStops(); }
      el.querySelector('[data-close]').focus();
      if (focusStop) setTimeout(() => $(`row-${focusStop}`)?.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' }), reduced ? 0 : 220);
    }
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
  $('mini').onclick = () => show('ruta', $('mini'), $('mini').dataset.stop);
  document.querySelectorAll('[data-close]').forEach((b) => b.onclick = () => hide());
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && openSheet) hide(); });

  // ── Loop ──────────────────────────────────
  async function poll() {
    try {
      const r = await fetch(`/api/public?${q}`, { cache: 'no-store' });
      if (r.status === 404) return fatal();
      data = await r.json();
    } catch { data = null; }
    renderStatus(); renderMini(); renderFito(); highlight();
    if (!userPickedDay) selectedDay = dayNow();
    renderDays(); renderStops();
  }
  function fatal() {
    $('status-sub').textContent = 'Este link ya no funciona. Pedile a Lean uno nuevo.'; $('dot').className = 'dot warn';
    $('mini').hidden = true;
  }
  async function main() {
    if (!key) return fatal();
    trip = await (await fetch('../trip.built.json', { cache: 'no-store' })).json();
    selectedDay = dayNow();
    initMap(); setupComposer(); renderChat();
    await poll(); await pollChat();
    setInterval(poll, 30e3);
    let tick = 0; setInterval(() => { tick++; if (chatOpen || tick % 3 === 0) pollChat(); }, 10e3);
  }
  main().catch((e) => { console.error(e); toast('No pude cargar el viaje. Recargá la página.'); });
})();
