/* Ruta Fito webapp: static trip data + live status from the Worker. */
(() => {
  const CFG = window.RUTA_CONFIG || {};
  const ICON = { salida: '🚩', descanso: '🌳', nafta: '⛽', noche: '🛏️', destino: '🏁' };
  const TYPE_LABEL = { salida: 'Salida', descanso: 'Descanso', nafta: 'Nafta', noche: 'Noche', destino: 'Destino' };
  const DAY_COLOR = { d1: '#5eead4', d2: '#c4b5fd' };
  const $ = (id) => document.getElementById(id);
  const waze = (s) => `https://waze.com/ul?ll=${s.lat.toFixed(6)}%2C${s.lon.toFixed(6)}&navigate=yes`;
  const arDate = () => new Date(Date.now() - 3 * 3.6e6).toISOString().slice(0, 10);

  let trip, map, meMarker, follow = true, status = null, selectedDay = 'd1';
  const stopMarkers = {};

  function toast(msg) {
    const t = $('toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 2600);
  }

  function initMap() {
    map = L.map('map', { zoomControl: true, attributionControl: true, preferCanvas: true });
    // Esri dark gray canvas: free, no API key (attribution required).
    const esri = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/';
    L.tileLayer(esri + 'World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 16, attribution: 'Tiles &copy; Esri &middot; HERE, Garmin, &copy; OpenStreetMap',
    }).addTo(map);
    L.tileLayer(esri + 'World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}', { maxZoom: 16, pane: 'overlayPane', opacity: .9 }).addTo(map);
    const all = [];
    for (const d of trip.days) {
      const latlngs = d.route.map(([lon, lat]) => [lat, lon]);
      all.push(...latlngs);
      L.polyline(latlngs, { color: '#000', weight: 9, opacity: .55 }).addTo(map);
      L.polyline(latlngs, { color: DAY_COLOR[d.id] || '#5eead4', weight: 5, opacity: .95 }).addTo(map);
      d.stops.forEach((s, i) => {
        if (d.id === 'd2' && i === 0) return; // same point as d1 overnight
        const icon = L.divIcon({ className: '', html: `<div class="pin t-${s.type}" aria-hidden="true">${ICON[s.type] || '📍'}</div>`, iconSize: [40, 40], iconAnchor: [20, 20] });
        const m = L.marker([s.lat, s.lon], { icon, title: s.name, keyboard: true, alt: `${TYPE_LABEL[s.type]}: ${s.name}` })
          .bindPopup(`<b>${s.name}</b><br>${d.label} · ${s.plannedArrival} · km ${Math.round(s.km)}<br>${s.description}<br><a href="${waze(s)}" target="_blank" rel="noopener">Abrir en Waze</a>`)
          .addTo(map);
        stopMarkers[s.id] = m;
      });
    }
    map.fitBounds(L.latLngBounds(all), { padding: [30, 30] });
    map.on('dragstart', () => setFollow(false));
  }

  function setFollow(v) {
    follow = v; $('follow').setAttribute('aria-pressed', String(v));
    if (v && status?.hasPosition) map.setView([status.position.lat, status.position.lon], 11);
  }

  function renderTabs() {
    $('tabs').innerHTML = '';
    for (const d of trip.days) {
      const b = document.createElement('button');
      b.className = 'tab'; b.type = 'button'; b.role = 'tab'; b.dataset.day = d.id;
      b.setAttribute('aria-selected', String(d.id === selectedDay));
      b.textContent = d.label;
      b.onclick = () => { poll.userPicked = true; selectedDay = d.id; renderTabs(); renderStops(); };
      $('tabs').appendChild(b);
    }
  }

  function renderStops() {
    const d = trip.days.find((x) => x.id === selectedDay);
    const h = Math.floor(d.driveMin / 60), m = d.driveMin % 60;
    $('day-summary').textContent = `${d.totalKm} km · ${h} h ${m} min de manejo · salida ${d.departure} · llegada estimada ${d.plannedEnd}`;
    const ol = $('stops'); ol.innerHTML = '';
    const nextId = status?.next?.id;
    const curDay = status?.dayId;
    d.stops.forEach((s) => {
      const li = document.createElement('li');
      const done = curDay === d.id && status?.hasPosition && s.km < status.km - 1;
      li.className = `stop${done ? ' done' : ''}${s.id === nextId ? ' is-next' : ''}`;
      li.id = s.id; li.tabIndex = 0;
      li.innerHTML = `
        <div class="badge t-${s.type}" aria-hidden="true">${ICON[s.type] || '📍'}</div>
        <div>
          <h2>${s.name}${s.aca ? '<span class="chip chip-aca">ACA</span>' : ''}${s.detourKm ? `<span class="chip chip-detour">desvío ${s.detourKm} km</span>` : ''}</h2>
          <div class="meta">${TYPE_LABEL[s.type]} · ${s.plannedArrival} · km ${Math.round(s.km)}${s.legKm ? ` · tramo ${s.legKm} km / ${Math.floor(s.legMin / 60)}h${String(s.legMin % 60).padStart(2, '0')}` : ''}${s.dwellMin ? ` · parada ${s.dwellMin} min` : ''}</div>
          <p>${s.description}</p>
          <p class="fito"><span aria-hidden="true">🐕</span> ${s.fito}</p>
          <div class="actions"><a class="btn" href="${waze(s)}" target="_blank" rel="noopener" aria-label="Abrir ${s.name} en Waze">🧭 Waze</a></div>
        </div>`;
      const focus = () => { setFollow(false); map.setView([s.lat, s.lon], 13); stopMarkers[s.id]?.openPopup(); };
      li.addEventListener('click', (e) => { if (!e.target.closest('a')) focus(); });
      li.addEventListener('keydown', (e) => { if (e.key === 'Enter') focus(); });
      ol.appendChild(li);
    });
  }

  function planFallbackNext() {
    // Without live position: show the first upcoming stop of today's (or the first) day.
    const d = trip.days.find((x) => x.date === arDate()) || trip.days[0];
    return { day: d, stop: d.stops[1] };
  }

  function renderNext() {
    const sig = $('signal');
    let stop, km = '—', eta = '—', min = '—';
    if (status?.hasPosition && status.next) {
      stop = trip.days.flatMap((d) => d.stops).find((s) => s.id === status.next.id);
      km = status.next.remainingKm; eta = status.next.etaClock; min = status.next.etaMin;
    } else if (status?.arrived) {
      const d = trip.days.find((x) => x.id === status.dayId); stop = d.stops[d.stops.length - 1];
      km = 0; eta = '✔'; min = 0;
    } else {
      const f = planFallbackNext(); stop = f.stop; eta = stop.plannedArrival; km = Math.round(stop.km);
    }
    $('next-name').textContent = `${ICON[stop.type] || '📍'} ${stop.name}`;
    $('next-km').textContent = km; $('next-eta').textContent = eta; $('next-min').textContent = min;
    $('next-desc').textContent = stop.description;
    $('next-fito').textContent = `🐕 ${stop.fito}`;
    $('next-waze').href = waze(stop);
    $('next-waze').setAttribute('aria-label', `Abrir ${stop.name} en Waze`);
    for (const [id, m] of Object.entries(stopMarkers)) m.getElement()?.firstElementChild?.classList.toggle('next', id === stop.id);

    if (!CFG.workerUrl) { sig.textContent = 'Modo plan (sin servidor)'; sig.className = 'signal warn'; }
    else if (!status) { sig.textContent = 'Sin conexión al servidor'; sig.className = 'signal warn'; }
    else if (!status.hasPosition) { sig.textContent = 'Esperando ubicación del bot'; sig.className = 'signal warn'; }
    else if (status.position.ageMin > 20) { sig.textContent = `Sin señal hace ${status.position.ageMin} min`; sig.className = 'signal warn'; }
    else { sig.textContent = `En vivo · km ${Math.round(status.km)} · ${status.speedKmh} km/h`; sig.className = 'signal ok'; }
  }

  function renderMe() {
    if (!status?.hasPosition) return;
    const ll = [status.position.lat, status.position.lon];
    const stale = status.position.ageMin > 20;
    const icon = L.divIcon({ className: '', html: `<div class="me${stale ? ' stale' : ''}" aria-hidden="true"></div>`, iconSize: [26, 26], iconAnchor: [13, 13] });
    if (!meMarker) meMarker = L.marker(ll, { icon, zIndexOffset: 1000, title: 'Estás acá', alt: 'Tu posición' }).addTo(map);
    else { meMarker.setLatLng(ll); meMarker.setIcon(icon); }
    if (follow) map.setView(ll, Math.max(map.getZoom(), 10));
  }

  async function poll() {
    if (!CFG.workerUrl) { renderNext(); return; }
    try {
      const r = await fetch(`${CFG.workerUrl}/status`, { cache: 'no-store' });
      status = await r.json();
      if (status.hasPosition && status.dayId && status.dayId !== selectedDay && !poll.userPicked) { selectedDay = status.dayId; renderTabs(); }
    } catch { status = null; }
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
      try { await navigator.clipboard.writeText(`${d.label}\n${txt}`); toast('Paradas copiadas: pegalas en Waze → Agregar parada'); }
      catch { toast('No pude copiar; usá los botones Waze de cada parada'); }
    };
    if (CFG.bot) $('bot-link').href = `https://t.me/${CFG.bot}`; else $('bot-link').hidden = true;
    if (location.hash) { const s = document.querySelector(location.hash); s?.click(); }
    poll(); setInterval(poll, 60e3);
  }
  main().catch((e) => { $('signal').textContent = 'Error cargando la ruta'; console.error(e); });
})();
