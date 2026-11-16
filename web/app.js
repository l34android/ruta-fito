/* Ruta Fito webapp: static trip data + live status from the Worker. Icons: Tabler sprite in index.html. */
(() => {
  const CFG = window.RUTA_CONFIG || {};
  const TYPE = {
    salida: { icon: 'map-pin', label: 'Salida' },
    descanso: { icon: 'trees', label: 'Descanso con verde' },
    nafta: { icon: 'gas-station', label: 'Carga de nafta' },
    noche: { icon: 'bed', label: 'Noche' },
    destino: { icon: 'flag', label: 'Destino' },
  };
  const ACCENT = '#32d74b', MUTED = '#636366';
  const $ = (id) => document.getElementById(id);
  const svg = (name, cls = 'icon') => `<svg class="${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const waze = (s) => `https://waze.com/ul?ll=${s.lat.toFixed(6)}%2C${s.lon.toFixed(6)}&navigate=yes`;
  const arDate = () => new Date(Date.now() - 3 * 3.6e6).toISOString().slice(0, 10);
  const clock = (ts) => { const d = new Date(ts - 3 * 3.6e6); return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`; };
  const planFor = (dayId) => status?.plans?.find((p) => p.dayId === dayId);
  const fmtDuration = (min) => `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min`;

  let trip, map, meMarker, follow = true, status = null, selectedDay = 'd1', userPickedDay = false;
  const stopMarkers = {}, routeLines = {};

  function toast(msg) {
    const t = $('toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toast.timer); toast.timer = setTimeout(() => t.classList.remove('show'), 3200);
  }

  function pinIcon(stop, isNext) {
    const size = isNext ? 44 : 36;
    return L.divIcon({ className: '', html: `<div class="pin${isNext ? ' is-next' : ''}">${svg(TYPE[stop.type].icon)}</div>`, iconSize: [36, 36], iconAnchor: [18, 18], popupAnchor: [0, -size / 2] });
  }

  function initMap() {
    map = L.map('map', { zoomControl: true, preferCanvas: false });
    const esri = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/';
    L.tileLayer(esri + 'World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', { maxZoom: 16, attribution: 'Tiles &copy; Esri &middot; HERE, Garmin, &copy; OpenStreetMap' }).addTo(map);
    const all = [];
    for (const d of trip.days) {
      const latlngs = d.route.map(([lon, lat]) => [lat, lon]);
      all.push(...latlngs);
      routeLines[d.id] = L.polyline(latlngs, { color: MUTED, weight: 5, opacity: 1, lineCap: 'round' }).addTo(map);
      d.stops.forEach((s, i) => {
        if (d.id !== trip.days[0].id && i === 0) return; // shared with the previous day's overnight stop
        const m = L.marker([s.lat, s.lon], { icon: pinIcon(s, false), title: s.name, alt: `${TYPE[s.type].label}: ${s.name}`, keyboard: true })
          .bindPopup(`<strong>${esc(s.name)}</strong>${esc(d.label)} · ${esc(s.plannedArrival)} · km ${Math.round(s.km)}<br>${esc(s.description)}<br><a href="${waze(s)}" target="_blank" rel="noopener">Abrir en Waze</a>`)
          .addTo(map);
        stopMarkers[s.id] = { marker: m, stop: s };
      });
    }
    map.fitBounds(L.latLngBounds(all), { padding: [32, 32] });
    map.on('dragstart', () => setFollow(false));
    highlightRoute();
  }

  function highlightRoute() {
    for (const [id, line] of Object.entries(routeLines)) {
      line.setStyle({ color: id === selectedDay ? ACCENT : MUTED });
      if (id === selectedDay) line.bringToFront();
    }
  }

  function setFollow(v) {
    follow = v; $('follow').setAttribute('aria-pressed', String(v));
    if (v && status?.hasPosition) map.setView([status.position.lat, status.position.lon], 11);
  }

  function renderTabs() {
    const wrap = $('tabs'); wrap.innerHTML = '';
    for (const d of trip.days) {
      const b = document.createElement('button');
      b.className = 'segment'; b.type = 'button'; b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(d.id === selectedDay));
      b.textContent = d.label;
      b.onclick = () => { userPickedDay = true; selectedDay = d.id; renderTabs(); renderStops(); highlightRoute(); };
      wrap.appendChild(b);
    }
  }

  function renderStops() {
    const d = trip.days.find((x) => x.id === selectedDay);
    $('day-stats').innerHTML = `
      <div><dt>Distancia</dt><dd>${d.totalKm} km</dd></div>
      <div><dt>Manejando</dt><dd>${fmtDuration(d.driveMin)}</dd></div>
      <div><dt>${planFor(d.id)?.live ? 'Llegada en vivo' : 'Llegada estimada'}</dt><dd>${planFor(d.id)?.live ? clock(planFor(d.id).endEta) : esc(d.plannedEnd)}</dd></div>`;
    const ol = $('stops'); ol.innerHTML = '';
    const nextId = currentNext()?.id;
    const plan = planFor(d.id);
    d.stops.forEach((s, i) => {
      const li = document.createElement('li');
      const ps = plan?.live ? plan.stops[i] : null;
      const state = ps?.state || (status?.hasPosition && status.dayId === d.id && s.km < status.km - 1 ? 'visited' : 'pending');
      const isNext = s.id === nextId;
      li.className = `row${state === 'visited' || state === 'skipped' ? ' is-done' : ''}`;
      li.id = s.id; li.tabIndex = 0;
      let when = esc(s.plannedArrival);
      if (ps?.state === 'visited' && ps.arrivedAt) when = `Llegaste ${clock(ps.arrivedAt)}${ps.leftAt ? ` · ${Math.round((ps.leftAt - ps.arrivedAt) / 60e3)} min` : ''}`;
      else if (ps?.state === 'here') when = `Estás acá desde ${clock(ps.arrivedAt)}`;
      else if (ps?.state === 'skipped') when = 'Salteada';
      else if (ps?.eta) {
        const diff = Math.round((ps.eta - ps.planned) / 60e3);
        when = `${clock(ps.eta)}${Math.abs(diff) >= 5 ? ` (${diff > 0 ? '+' : '−'}${Math.abs(diff)} min)` : ''}`;
      }
      const meta = [
        isNext ? '<span class="is-next-label">Próxima</span>' : null,
        when, `km ${Math.round(s.km)}`,
        s.fuel ? 'Cargar nafta' : (s.aca ? 'ACA' : null),
        s.dwellMin && state !== 'visited' ? `${s.dwellMin} min de parada` : null,
        s.detourKm ? `desvío ${s.detourKm} km` : null,
      ].filter(Boolean).join(' · ');
      li.innerHTML = `
        <span class="type-tile${isNext ? ' is-next' : ''}" title="${TYPE[s.type].label}">${svg(TYPE[s.type].icon)}</span>
        <div>
          <h3 class="row-title">${esc(s.name)}</h3>
          <p class="row-meta">${meta}</p>
          <p class="row-desc">${esc(s.description)}</p>
          <p class="note">${svg('dog')}<span>${esc(s.fito)}</span></p>
        </div>
        <a class="icon-btn" href="${waze(s)}" target="_blank" rel="noopener" title="Abrir en Waze" aria-label="Abrir ${esc(s.name)} en Waze">${svg('brand-waze')}</a>`;
      const focus = () => { setFollow(false); map.setView([s.lat, s.lon], 13); stopMarkers[s.id]?.marker.openPopup(); };
      li.addEventListener('click', (e) => { if (!e.target.closest('a')) focus(); });
      li.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.target.closest('a')) focus(); });
      ol.appendChild(li);
    });
  }

  // The stop to show as "next": live from the Worker, else today's first stop from the plan.
  function currentNext() {
    const all = trip.days.flatMap((d) => d.stops);
    if (status?.hasPosition && status.next) return all.find((s) => s.id === status.next.id);
    if (status?.arrived) { const d = trip.days.find((x) => x.id === status.dayId); return d.stops[d.stops.length - 1]; }
    const d = trip.days.find((x) => x.date === arDate()) || trip.days[0];
    return d.stops[1];
  }

  function renderNext() {
    const stop = currentNext();
    let km = Math.round(stop.km), eta = stop.plannedArrival, min = '—';
    if (status?.hasPosition && status.next) { km = status.next.remainingKm; eta = status.next.etaClock; min = status.next.etaMin; }
    else if (status?.arrived) { km = 0; eta = 'Llegaron'; min = 0; }
    $('next-icon').innerHTML = svg(TYPE[stop.type].icon); $('next-icon').classList.add('is-next');
    $('next-name').textContent = stop.name;
    $('next-type').textContent = [TYPE[stop.type].label, stop.aca ? 'ACA' : null, stop.detourKm ? `desvío ${stop.detourKm} km` : null].filter(Boolean).join(' · ');
    $('next-km').textContent = km; $('next-eta').textContent = eta; $('next-min').textContent = min;
    $('next-desc').textContent = stop.description;
    $('next-fito').textContent = stop.fito;
    $('next-waze').href = waze(stop);
    $('next-waze').setAttribute('aria-label', `Abrir ${stop.name} en Waze`);
    for (const [id, { marker, stop: s }] of Object.entries(stopMarkers)) marker.setIcon(pinIcon(s, id === stop.id));
    renderInsights();
    renderSignal();
  }

  // Plan vivo: end-of-day arrival vs plan, nightfall and fuel.
  function renderInsights() {
    const ul = $('insights');
    const items = [];
    const plan = status?.dayId ? planFor(status.dayId) : null;
    const day = plan ? trip.days.find((d) => d.id === plan.dayId) : null;
    if (plan?.live && day) {
      const end = day.stops[day.stops.length - 1].name.replace(/ \(destino\)$/, '');
      const d = plan.delayMin;
      const vs = d >= 5 ? `${d} min más tarde que el plan` : d <= -5 ? `${-d} min antes que el plan` : 'en horario';
      items.push({ icon: 'clock', warn: false, text: `Llegás a ${end} ${clock(plan.endEta)}, ${vs}.` });
      items.push(plan.afterDark
        ? { icon: 'moon', warn: true, text: `Oscurece ${clock(plan.sunset)}: llegarías de noche. Acortá alguna parada larga.` }
        : { icon: 'sunset', warn: false, text: `Oscurece ${clock(plan.sunset)}. Llegás con luz.` });
    }
    const f = status?.fuel;
    if (status?.hasPosition && f?.next) {
      const warn = f.risk !== 'ok' || f.mustFillAtNext;
      const text = f.risk === 'high' ? `Nafta: ${f.sinceKm} km desde la última carga. Cargá en la primera estación que veas.`
        : warn ? `Nafta: llegás a ${f.next.name} con ${f.next.atKm} km desde la última carga. Cargá ahí sí o sí.`
        : `Nafta: ${f.sinceKm} km desde la última carga. Próxima: ${f.next.name}, en ${f.next.inKm} km.`;
      items.push({ icon: 'gas-station', warn, text });
    }
    ul.innerHTML = items.map((i) => `<li class="insight${i.warn ? ' is-warn' : ''}">${svg(i.warn ? 'alert-triangle' : i.icon)}<span>${esc(i.text)}</span></li>`).join('');
    ul.hidden = !items.length;
  }

  function renderSignal() {
    const el = $('signal'), txt = $('signal-text');
    let cls = 'signal warn', msg;
    if (!CFG.workerUrl) msg = 'Modo plan, sin avisos en vivo';
    else if (!status) msg = 'No pude conectar con el servidor';
    else if (!status.hasPosition) msg = 'Esperando tu ubicación del bot';
    else if (status.position.ageMin > 20) msg = `Sin señal hace ${status.position.ageMin} min`;
    else { cls = 'signal ok'; msg = `En vivo · km ${Math.round(status.km)} · ${status.speedKmh} km/h`; }
    el.className = cls; txt.textContent = msg;
  }

  function renderMe() {
    if (!status?.hasPosition) return;
    const ll = [status.position.lat, status.position.lon];
    const icon = L.divIcon({ className: '', html: `<div class="me${status.position.ageMin > 20 ? ' is-stale' : ''}"></div>`, iconSize: [22, 22], iconAnchor: [11, 11] });
    if (!meMarker) meMarker = L.marker(ll, { icon, zIndexOffset: 1000, title: 'Estás acá', alt: 'Tu posición' }).addTo(map);
    else { meMarker.setLatLng(ll); meMarker.setIcon(icon); }
    if (follow) map.setView(ll, Math.max(map.getZoom(), 10));
  }

  async function poll() {
    if (CFG.workerUrl) {
      try {
        const r = await fetch(`${CFG.workerUrl}/status`, { cache: 'no-store' });
        status = await r.json();
        if (status.hasPosition && status.dayId && status.dayId !== selectedDay && !userPickedDay) { selectedDay = status.dayId; renderTabs(); highlightRoute(); }
      } catch { status = null; }
    }
    renderNext(); renderMe(); renderStops();
  }

  async function main() {
    trip = await (await fetch('trip.built.json', { cache: 'no-store' })).json();
    const today = trip.days.find((d) => d.date === arDate()); if (today) selectedDay = today.id;
    initMap(); renderTabs(); renderStops(); renderNext();
    $('follow').onclick = () => setFollow(!follow);
    $('copy-waze').onclick = async () => {
      const d = trip.days.find((x) => x.id === selectedDay);
      const txt = d.stops.slice(1).map((s, i) => `${i + 1}. ${s.name} — ${s.lat.toFixed(5)}, ${s.lon.toFixed(5)}`).join('\n');
      try { await navigator.clipboard.writeText(`${d.label}\n${txt}`); toast('Listo, copié las paradas. Pegalas en Waze con "Agregar parada".'); }
      catch { toast('No pude copiarlas. Usá el botón de Waze de cada parada.'); }
    };
    if (CFG.bot) $('bot-link').href = `https://t.me/${CFG.bot}`; else $('bot-link').hidden = true;
    if (location.hash) document.querySelector(location.hash)?.click();
    poll(); setInterval(poll, 60e3);
  }
  main().catch((e) => { $('signal-text').textContent = 'No pude cargar la ruta. Probá recargar.'; console.error(e); });
})();
