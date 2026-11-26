const UA = { 'User-Agent': 'ruta-fito-diag/1 (github l34android/ruta-fito)' };
const qs = ['Piedra del Águila, Neuquén', 'Villa El Chocón, Neuquén', 'Choele Choel, Río Negro', 'Plaza Moreno, La Plata', 'Isla 92, Choele Choel'];
const out = {};
for (const q of qs) {
  const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=ar&q=${encodeURIComponent(q)}`, { headers: UA });
  const j = await r.json(); out[q] = j[0] ? [+j[0].lat, +j[0].lon, j[0].display_name.slice(0, 60)] : null;
  console.log(q, '=>', JSON.stringify(out[q]));
  await new Promise((s) => setTimeout(s, 1100));
}
const P = (q) => out[q] ? [out[q][1], out[q][0]] : null;
const legs = {
  v1: [[-71.33771, -40.15299], P('Piedra del Águila, Neuquén'), P('Villa El Chocón, Neuquén'), P('Choele Choel, Río Negro')],
  v2: [P('Choele Choel, Río Negro'), [-65.6663, -39.28162], [-64.10458, -38.97338], [-62.33326, -38.70085], [-61.92812, -38.07857]],
  v3: [[-61.92812, -38.07857], [-60.31249, -36.9097], [-59.88442, -36.79619], [-58.88974, -35.70025], P('Plaza Moreno, La Plata')],
};
for (const [k, pts] of Object.entries(legs)) {
  if (pts.some((p) => !p)) { console.log(k, 'missing point'); continue; }
  const r = await fetch(`https://router.project-osrm.org/route/v1/driving/${pts.map((p) => p.join(',')).join(';')}?overview=false`);
  const j = await r.json();
  const rt = j.routes?.[0];
  console.log(k, rt ? `${Math.round(rt.distance / 1000)} km ${Math.round(rt.duration / 60)} min legs ${rt.legs.map((l) => Math.round(l.distance / 1000) + 'km/' + Math.round(l.duration / 60) + 'm').join(' ')}` : JSON.stringify(j).slice(0, 200));
}
