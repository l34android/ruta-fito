/* Gran Fondo 7 Lagos — one-screen live view. Course from race.json, live data from /api/granfondo (incl. Karoo sensors). */
(() => {
  const $ = (id) => document.getElementById(id);
  const key = new URLSearchParams(location.search).get('k');
  const q = `k=${encodeURIComponent(key || '')}`;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const svg = (n) => `<svg class="icon" aria-hidden="true"><use href="#i-${n}"/></svg>`;
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmt = (n, d = 1) => (n == null ? '—' : Number(n).toLocaleString('es-AR', { minimumFractionDigits: d, maximumFractionDigits: d }));
  const clock = (ts) => { const d = new Date(ts - 3 * 3.6e6); return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`; };
  const hm = (min) => `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`;
  const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch {} } };

  let race, map, rider, data, followRider = true;

  // ── Map ───────────────────────────────────
  function initMap() {
    map = L.map('map', { zoomControl: false });
    if (matchMedia('(min-width: 900px)').matches) L.control.zoom({ position: 'bottomright' }).addTo(map);
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 17, attribution: 'Imágenes &copy; Esri' }).addTo(map);
    const ll = race.route.map(([lon, lat]) => [lat, lon]);
    L.polyline(ll, { color: '#000', weight: 8, opacity: .85 }).addTo(map);
    L.polyline(ll, { color: '#32d74b', weight: 4 }).addTo(map);
    for (const c of race.climbs) {
      const seg = slice(c.startKm, c.endKm);
      if (seg.length > 1) L.polyline(seg, { color: '#ffd60a', weight: 5 }).addTo(map);
    }
    const end = (latlng, icon, label) => L.marker(latlng, { icon: L.divIcon({ className: '', html: `<div class="endpoint">${svg(icon)}</div>`, iconSize: [32, 32], iconAnchor: [16, 16] }), title: label, alt: label, keyboard: false }).addTo(map);
    end(ll[0], 'map-pin', `Largada: ${race.start.label}`);
    end(ll.at(-1), 'flag', `Llegada: ${race.finish.label}`);
    fitCourse();
    map.on('dragstart', () => { followRider = false; });
  }
  // Frame the course in the map area left free by the floating panels.
  function fitCourse() {
    const wide = innerWidth >= 900;
    const top = $('hud').getBoundingClientRect().bottom + 8;
    const bottom = innerHeight - $('sensors').getBoundingClientRect().top + 8;
    map.fitBounds(L.latLngBounds(race.route.map(([lon, lat]) => [lat, lon])), { paddingTopLeft: [wide ? 440 : 16, wide ? 16 : top], paddingBottomRight: [16, wide ? 96 : bottom] });
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

  // ── Top panel ─────────────────────────────
  function renderHud() {
    const v = data?.live || { started: false, km: 0 };
    $('total').textContent = fmt(race.totalKm, 0);
    $('km').textContent = fmt(v.km || 0);
    const pct = v.pct || 0;
    $('fill').style.width = `${pct}%`;
    $('progress').setAttribute('aria-valuenow', Math.round(pct));
    $('progress').setAttribute('aria-valuetext', `${fmt(v.km || 0)} de ${fmt(race.totalKm, 0)} km`);
    $('m-eta').textContent = v.eta ? v.eta.clock : '—';
    $('m-time').textContent = v.started ? hm(v.elapsedMin) : '—';
    $('m-avg').textContent = v.avgKmh ? `${fmt(v.avgKmh)} km/h` : '—';

    $('climb').classList.toggle('on', !!v.inClimb);
    $('climb-text').textContent = v.finished ? `Llegó a ${race.finish.label}`
      : v.inClimb ? `Subiendo: faltan ${fmt(v.inClimb.leftKm)} km al ${fmt(v.inClimb.grade)} %`
      : v.nextClimb ? `Próxima subida en ${fmt(v.nextClimb.inKm)} km: ${fmt(v.nextClimb.lenKm)} km al ${fmt(v.nextClimb.grade)} %`
      : 'No quedan subidas';

    const dot = $('dot'), lt = $('live-text');
    if (!data) { dot.className = 'dot warn'; lt.textContent = 'Sin conexión'; }
    else if (v.finished) { dot.className = 'dot ok'; lt.textContent = `Llegó · ${hm(v.elapsedMin)}`; }
    else if (!v.started) { dot.className = 'dot'; lt.textContent = 'Antes de largar'; }
    else if (v.ageMin > 10) { dot.className = 'dot warn'; lt.textContent = `Sin señal hace ${v.ageMin} min`; }
    else { dot.className = 'dot ok'; lt.textContent = 'En vivo'; }
  }

  // ── Karoo sensors ─────────────────────────
  function renderSensors() {
    const s = data?.sensors;
    const set = (id, val, d = 0) => { const el = $(id); el.querySelector('.v').textContent = val == null ? '—' : fmt(val, d); el.classList.toggle('off', val == null); };
    set('s-hr', s?.hr); set('s-power', s?.power); set('s-cadence', s?.cadence); set('s-speed', s?.speedKmh, 1);
    $('sensors-note').textContent = !s ? 'Los datos del Karoo aparecen cuando Lean empieza a grabar'
      : s.ageSec > 60 ? `Último dato del Karoo hace ${s.ageSec < 3600 ? `${Math.round(s.ageSec / 60)} min` : 'más de una hora'}`
      : `Karoo en vivo · hace ${s.ageSec} s`;
  }

  function renderRider() {
    const p = data?.position;
    if (!p) { if (rider) { map.removeLayer(rider); rider = null; } return; }
    const stale = (data.live?.ageMin || 0) > 10;
    const icon = L.divIcon({ className: '', html: `<div class="rider${stale ? ' stale' : ''}">${svg('bike')}</div>`, iconSize: [44, 44], iconAnchor: [22, 22] });
    if (!rider) rider = L.marker([p.lat, p.lon], { icon, zIndexOffset: 1000, title: 'Lean', alt: 'Posición de Lean', keyboard: false }).addTo(map);
    else { rider.setLatLng([p.lat, p.lon]); rider.setIcon(icon); }
  }

  // ── Perfil sheet ──────────────────────────
  function renderProfile() {
    const v = data?.live || {};
    const km = v.started ? v.km : null;
    const P = race.profile || [];
    const box = $('profile');
    if (!P.length || !box.clientWidth) return;
    const W = Math.round(box.clientWidth), H = 170, pad = { l: 44, r: 6, t: 10, b: 24 };
    const maxE = Math.max(...P.map((p) => p[1])), minE = Math.min(...P.map((p) => p[1]));
    const x = (k) => pad.l + (k / race.totalKm) * (W - pad.l - pad.r);
    const y = (e) => pad.t + (1 - (e - minE) / Math.max(1, maxE - minE)) * (H - pad.t - pad.b);
    const pts = P.map((p) => `${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join(' L');
    const area = `M${x(0)},${H - pad.b} L${pts} L${x(race.totalKm)},${H - pad.b} Z`;
    const climbs = race.climbs.map((c) => `<rect x="${x(c.startKm).toFixed(1)}" y="${pad.t}" width="${Math.max(2, x(c.endKm) - x(c.startKm)).toFixed(1)}" height="${H - pad.t - pad.b}" fill="#ffd60a" opacity=".22"/>`).join('');
    const ticks = (W < 500 ? [0, 50, 100] : [0, 25, 50, 75, 100]).map((k) => `<text x="${x(k)}" y="${H - 6}" fill="#c7c7cc" font-size="12" text-anchor="middle">${k} km</text>`).join('');
    const step = P[1][0] - P[0][0];
    const e = km != null ? (P[Math.min(P.length - 1, Math.round(km / step))] || P.at(-1))[1] : null;
    const me = km != null ? `<line x1="${x(km)}" x2="${x(km)}" y1="${pad.t}" y2="${H - pad.b}" stroke="#32d74b" stroke-width="2"/><circle cx="${x(km)}" cy="${y(e)}" r="6" fill="#32d74b" stroke="#000" stroke-width="3"/>` : '';
    box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
      <text x="0" y="${pad.t + 10}" fill="#c7c7cc" font-size="12">${Math.round(maxE)} m</text>
      <text x="0" y="${H - pad.b}" fill="#c7c7cc" font-size="12">${Math.round(minE)} m</text>
      ${climbs}<path d="${area}" fill="#2c2c2e"/><path d="M${pts}" fill="none" stroke="#f5f5f7" stroke-width="1.5"/>${me}${ticks}</svg>`;
    $('gain').textContent = `${fmt(race.totalKm, 0)} km · +${fmt(race.gain, 0)} m de desnivel`;

    $('climbs').innerHTML = race.climbs.map((c) => {
      const state = km == null ? '' : km > c.endKm ? 'done' : km >= c.startKm ? 'now' : '';
      const tag = state === 'done' ? 'Hecha' : state === 'now' ? 'Ahora' : km != null ? `en ${fmt(c.startKm - km)} km` : `km ${fmt(c.startKm, 0)}`;
      return `<li class="${state}">${svg('mountain')}<span class="c-main">${fmt(c.lenKm)} km al ${fmt(c.grade)} %${c.official ? ' · oficial' : ''}</span><span class="c-meta">${tag}</span></li>`;
    }).join('');

    const l = data?.links || {}, items = [];
    if (l.garmin) items.push(`<a class="btn btn-secondary" href="${esc(l.garmin)}" target="_blank" rel="noopener">${svg('external-link')}Garmin LiveTrack</a>`);
    if (l.karoo) items.push(`<a class="btn btn-secondary" href="${esc(l.karoo)}" target="_blank" rel="noopener">${svg('external-link')}Karoo Live Track</a>`);
    $('links').innerHTML = items.join(''); $('links').hidden = !items.length;
  }

  // ── Aliento sheet ─────────────────────────
  let chat = [], lastId = 0, chatOpen = false, unread = 0, firstLoad = true;
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
      if (j.messages.length) { chat.push(...j.messages); lastId = chat.at(-1).id; if (!chatOpen && !firstLoad) unread += j.messages.length; }
      firstLoad = false;
      $('badge').hidden = !unread; $('badge').textContent = unread;
      if (j.messages.length || n0 !== chat.length || !n0) {
        const ol = $('chat');
        ol.innerHTML = chat.length ? chat.slice(-40).map(bubble).join('') : '<li class="chat-empty">Dejale el primer mensaje de aliento.</li>';
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
        if (!r.ok) { $('form-error').textContent = j.error || 'No se pudo enviar. Probá de nuevo.'; return; }
        store.set('ruta.name', name); setWho(name); $('text').value = ''; await pollChat(); $('text').focus();
      } catch { $('form-error').textContent = 'Sin conexión. Tu mensaje sigue acá: probá de nuevo.'; }
      finally { $('send').disabled = false; }
    };
  }

  // ── Sheets + tabs ─────────────────────────
  let openSheet = null, opener = null;
  const setTab = (tab) => document.querySelectorAll('.tab').forEach((t) => { if (t.dataset.tab === tab) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current'); });
  function show(id, from) {
    if (openSheet && openSheet.id !== `sheet-${id}`) hide(true);
    const el = $(`sheet-${id}`); opener = from || null;
    el.hidden = false; requestAnimationFrame(() => { el.classList.add('open'); if (id === 'perfil') renderProfile(); });
    openSheet = el; setTab(id);
    if (id === 'aliento') { chatOpen = true; unread = 0; $('badge').hidden = true; pollChat(); setTimeout(() => ($('name-field').hidden ? $('text') : $('name')).focus(), reduced ? 0 : 220); }
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
    if (tab === 'mapa') { hide(); if (data?.position) { followRider = true; map.panTo([data.position.lat, data.position.lon]); } }
    else if (openSheet?.id === `sheet-${tab}`) hide(); else show(tab, t);
  });
  document.querySelectorAll('[data-close]').forEach((b) => b.onclick = () => hide());
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && openSheet) hide(); });

  // ── Loop ──────────────────────────────────
  async function poll() {
    try {
      const r = await fetch(`/api/granfondo?${q}`, { cache: 'no-store' });
      if (r.status === 404) { $('live-text').textContent = 'Link no válido'; $('dot').className = 'dot warn'; return; }
      data = await r.json();
    } catch { data = null; }
    renderHud(); renderSensors(); renderRider();
    if (followRider && data?.position && data.live?.started) map.panTo([data.position.lat, data.position.lon], { animate: !reduced });
    if (openSheet?.id === 'sheet-perfil') renderProfile();
  }
  async function main() {
    if (!key) { $('live-text').textContent = 'Falta el link completo'; return; }
    race = await (await fetch('race.json', { cache: 'no-store' })).json();
    setupComposer(); renderHud(); renderSensors();
    initMap();
    await poll(); pollChat();
    setInterval(poll, 15e3); setInterval(pollChat, 20e3);
    let rt; addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { if (openSheet?.id === 'sheet-perfil') renderProfile(); }, 200); });
  }
  main().catch((e) => { console.error(e); $('live-text').textContent = 'No se pudo cargar'; });
})();
