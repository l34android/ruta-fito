/* Seguinos: read-only family view. Needs ?k=<token>; data comes from the Worker's /public endpoint. */
(() => {
  const CFG = window.RUTA_CONFIG || {};
  const TYPE = {
    salida: { icon: 'map-pin', label: 'Salida' },
    descanso: { icon: 'trees', label: 'Descanso' },
    nafta: { icon: 'gas-station', label: 'Nafta' },
    noche: { icon: 'bed', label: 'Noche' },
    destino: { icon: 'flag', label: 'Destino' },
  };
  const ACCENT = '#32d74b', MUTED = '#636366';
  const $ = (id) => document.getElementById(id);
  const svg = (name, cls = 'icon') => `<svg class="${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const clock = (ts) => { const d = new Date(ts - 3 * 3.6e6); return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`; };
  const arDate = () => new Date(Date.now() - 3 * 3.6e6).toISOString().slice(0, 10);
  const cleanName = (n) => n.replace(/ \(destino\)$/, '');
  const key = new URLSearchParams(location.search).get('k');

  let trip, map, me, data = null, selectedDay = null, userPicked = false;
  const lines = {}, pins = {};

  function fail(title, text) {
    document.querySelector('main').innerHTML = `<section class="card empty-state"><h1>${esc(title)}</h1><p>${esc(text)}</p></section>`;
    $('signal-text').textContent = 'Sin datos'; $('signal').className = 'signal warn';
  }

  function initMap() {
    map = L.map('map', { zoomControl: true });
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 16, attribution: 'Tiles &copy; Esri &middot; HERE, Garmin, &copy; OpenStreetMap',
    }).addTo(map);
    const all = [];
    for (const d of trip.days) {
      const ll = d.route.map(([lon, lat]) => [lat, lon]); all.push(...ll);
      lines[d.id] = L.polyline(ll, { color: MUTED, weight: 5, lineCap: 'round' }).addTo(map);
      d.stops.forEach((s, i) => {
        if (d.id !== trip.days[0].id && i === 0) return;
        pins[s.id] = L.marker([s.lat, s.lon], { icon: pin(s, false), title: s.name, alt: `${TYPE[s.type].label}: ${s.name}` })
          .bindPopup(`<strong>${esc(cleanName(s.name))}</strong>${esc(s.description)}`).addTo(map);
      });
    }
    map.fitBounds(L.latLngBounds(all), { padding: [28, 28] });
  }
  const pin = (s, hl) => L.divIcon({ className: '', html: `<div class="pin${hl ? ' is-next' : ''}">${svg(TYPE[s.type].icon)}</div>`, iconSize: [36, 36], iconAnchor: [18, 18] });

  function planFor(dayId) { return data?.plans?.find((p) => p.dayId === dayId); }
  function stopById(id) { return trip.days.flatMap((d) => d.stops).find((s) => s.id === id); }

  function renderNow() {
    const dayId = data.dayId || (trip.days.find((d) => d.date === arDate()) || trip.days[0]).id;
    const day = trip.days.find((d) => d.id === dayId);
    const plan = planFor(dayId);
    const here = plan?.live ? plan.stops.findIndex((x) => x.state === 'here') : -1;
    let icon = 'route', title, sub;
    if (data.arrived) {
      const end = day.stops[day.stops.length - 1];
      icon = TYPE[end.type].icon;
      title = end.type === 'destino' ? `¡Llegaron a ${cleanName(end.name)}!` : `Descansando en ${end.name}`;
      sub = end.type === 'destino' ? 'Viaje completo.' : 'Mañana sigue la ruta.';
    } else if (data.hiddenNearHome) {
      icon = 'map-pin'; title = 'Preparando la salida'; sub = 'La ubicación aparece cuando estén en la ruta.';
    } else if (!data.hasPosition) {
      icon = 'map-pin'; title = 'Todavía no salieron'; sub = `Salida prevista: ${day.label}, ${day.departure}.`;
    } else if (here > 0) {
      const s = day.stops[here];
      icon = TYPE[s.type].icon; title = `Parados en ${cleanName(s.name)}`;
      sub = `Desde las ${clock(plan.stops[here].arrivedAt)}. ${s.type === 'descanso' ? 'Fito está estirando las patas.' : s.type === 'nafta' ? 'Cargando nafta.' : ''}`;
    } else if (data.next) {
      const s = stopById(data.next.id);
      icon = 'route'; title = `En ruta hacia ${cleanName(s.name)}`;
      sub = `Llegan ~${data.next.etaClock}.`;
    } else { title = 'En ruta'; sub = ''; }
    $('now-icon').innerHTML = svg(icon);
    $('now-title').textContent = title;
    $('now-sub').textContent = sub;

    const endName = cleanName(day.stops[day.stops.length - 1].name);
    $('eta-label').textContent = `llegada a ${endName}`;
    $('eta-end').textContent = plan ? clock(plan.endEta) : day.plannedEnd;
    const offset = trip.days.slice(0, trip.days.findIndex((d) => d.id === dayId)).reduce((a, d) => a + d.totalKm, 0);
    $('km-done').textContent = data.km != null && data.hasPosition ? Math.round(offset + data.km) : (data.hiddenNearHome ? 0 : '—');
    const done = (data.plans || []).flatMap((p) => p.stops.slice(1).filter((x) => x.state === 'visited' || x.state === 'here')).length;
    const total = trip.days.reduce((a, d) => a + d.stops.length - 1, 0);
    $('stops-done').textContent = `${done}/${total}`;
  }

  function renderSignal() {
    const el = $('signal'), t = $('signal-text');
    if (!data.hasPosition) { el.className = 'signal'; t.textContent = data.hiddenNearHome ? 'En casa' : 'Sin ubicación todavía'; return; }
    const age = data.position.ageMin;
    if (age > 20) { el.className = 'signal warn'; t.textContent = `Última señal hace ${age} min`; }
    else { el.className = 'signal ok'; t.textContent = age <= 1 ? 'En vivo' : `En vivo · hace ${age} min`; }
  }

  function renderTabs() {
    const wrap = $('tabs'); wrap.innerHTML = '';
    for (const d of trip.days) {
      const b = document.createElement('button');
      b.className = 'segment'; b.type = 'button'; b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(d.id === selectedDay)); b.textContent = d.label;
      b.onclick = () => { userPicked = true; selectedDay = d.id; renderTabs(); renderTimeline(); highlight(); };
      wrap.appendChild(b);
    }
  }

  function renderTimeline() {
    const d = trip.days.find((x) => x.id === selectedDay);
    const plan = planFor(d.id);
    $('stops').innerHTML = d.stops.map((s, i) => {
      const ps = plan?.stops?.[i];
      const live = plan?.live;
      let state = live ? ps.state : 'pending', when;
      if (live && ps.state === 'visited' && ps.arrivedAt) when = `Pararon a las ${clock(ps.arrivedAt)}${ps.leftAt ? ` · ${Math.round((ps.leftAt - ps.arrivedAt) / 60e3)} min` : ''}`;
      else if (live && ps.state === 'here') when = `Están acá desde las ${clock(ps.arrivedAt)}`;
      else if (live && ps.state === 'skipped') when = 'No pararon';
      else if (i === 0) when = `Salida ${d.departure}`;
      else when = `${live ? 'Llegan' : 'Previsto'} ~${clock(ps?.eta || ps?.planned)}`;
      return `<li class="row${state === 'here' ? ' is-here' : ''}${state === 'visited' ? ' is-visited' : ''}${state === 'skipped' ? ' is-done' : ''}">
        <span class="type-tile" title="${TYPE[s.type].label}">${svg(state === 'visited' ? 'circle-check' : TYPE[s.type].icon)}</span>
        <div>
          <h3 class="row-title">${esc(cleanName(s.name))}</h3>
          <p class="row-meta">${esc(when)} · ${TYPE[s.type].label}</p>
          <p class="row-desc">${esc(s.description.split('. ')[0].replace(/\.$/, ''))}.</p>
        </div>
      </li>`;
    }).join('');
  }

  function highlight() {
    for (const [id, l] of Object.entries(lines)) { l.setStyle({ color: id === selectedDay ? ACCENT : MUTED }); if (id === selectedDay) l.bringToFront(); }
    const nextId = data?.next?.id;
    for (const [id, m] of Object.entries(pins)) m.setIcon(pin(stopById(id), id === nextId));
  }

  function renderMe() {
    if (!data.hasPosition) { if (me) { map.removeLayer(me); me = null; } return; }
    const ll = [data.position.lat, data.position.lon];
    const icon = L.divIcon({ className: '', html: `<div class="me${data.position.ageMin > 20 ? ' is-stale' : ''}"></div>`, iconSize: [22, 22], iconAnchor: [11, 11] });
    if (!me) { me = L.marker(ll, { icon, zIndexOffset: 1000, title: 'Lean y Fito', alt: 'Posición de Lean y Fito' }).addTo(map); map.setView(ll, 9); }
    else { me.setLatLng(ll); me.setIcon(icon); }
  }

  async function poll() {
    try {
      const r = await fetch(`${CFG.workerUrl}/public?k=${encodeURIComponent(key)}`, { cache: 'no-store' });
      if (r.status === 404) return fail('Este link ya no funciona', 'Pedile a Lean que te mande uno nuevo.');
      data = await r.json();
    } catch { $('signal').className = 'signal warn'; $('signal-text').textContent = 'Sin conexión, reintentando'; return; }
    if (!userPicked) selectedDay = data.dayId || (trip.days.find((d) => d.date === arDate()) || trip.days[0]).id;
    renderTabs(); renderNow(); renderSignal(); renderTimeline(); highlight(); renderMe();
  }

  async function main() {
    if (!key || !CFG.workerUrl) return fail('Falta el link completo', 'Abrí el link tal cual te lo mandó Lean.');
    trip = await (await fetch('trip.built.json', { cache: 'no-store' })).json();
    selectedDay = (trip.days.find((d) => d.date === arDate()) || trip.days[0]).id;
    initMap(); await poll(); setInterval(poll, 60e3);
  }
  main().catch((e) => { console.error(e); fail('No pude cargar el viaje', 'Probá recargar la página en un ratito.'); });
})();
