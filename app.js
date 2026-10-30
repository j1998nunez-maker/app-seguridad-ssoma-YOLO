'use strict';
/* =====================================================================
   Seguridad Minera IA – Auditoría SSOMA
   Motor Edge AI (ONNX Runtime Web) con Matriz Dinámica de EPP y Reportabilidad
   ===================================================================== */
const S = 640;   // tamaño de entrada
const P = 160;   // resolución prototipos
const NM = 32;   // coeficientes máscara

ort.env.wasm.wasmPaths = new URL('lib/', location.href).href;
ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;

const $ = (id) => document.getElementById(id);
const estado = (msg) => { $('estado').textContent = msg; };

// ---------- Categorías y Matriz de EPP ----------
const CATEGORIAS = {
  persona:     ['person', 'persona', 'worker', 'trabajador'],
  casco:       ['helmet', 'hardhat', 'hard-hat', 'casco'],
  chaleco:     ['vest', 'chaleco'],
  guantes:     ['glove', 'guante'],
  botas:       ['shoe', 'boot', 'bota', 'calzado', 'zapato'],
  traje_cuero: ['leather_suit', 'mandil', 'traje_cuero'],
  traje_tyvek: ['tyvek', 'traje_impermeable'],
  careta:      ['face_shield', 'careta'],
  respirador:  ['respirator', 'full_face', 'respirador'],
  maquina:     ['truck', 'excavator', 'loader', 'dozer', 'machinery', 'vehicle', 'bus', 'maquina'],
};
const COCO_NOMBRES = { 0: 'person', 2: 'car', 5: 'bus', 7: 'truck' };
const COCO_CLASES = new Set([0, 2, 5, 7]);

const EPP = [
  { k: 'casco',       txt: 'casco',       sup: true,  ausencia: true },
  { k: 'chaleco',     txt: 'chaleco',     sup: false, ausencia: true },
  { k: 'guantes',     txt: 'guantes',     sup: false, ausencia: false },
  { k: 'botas',       txt: 'botas',       sup: false, ausencia: false },
  { k: 'traje_cuero', txt: 'traje cuero', sup: false, ausencia: true },
  { k: 'traje_tyvek', txt: 'traje tyvek', sup: false, ausencia: true },
  { k: 'careta',      txt: 'careta fac.', sup: true,  ausencia: true },
  { k: 'respirador',  txt: 'respirador',  sup: true,  ausencia: true }
];

// EVALUACIÓN DINÁMICA ESTRICTA POR PETAR
function exigidoDinamico(k) {
  const base = !$('ex_' + k) || $('ex_' + k).checked;
  if (!base) return false;

  const petar = document.querySelector('input[name="petar"]:checked').value;
  
  if (petar === 'estandar') {
    return ['casco', 'chaleco', 'guantes', 'botas'].includes(k);
  }
  if (petar === 'esmerilado') {
    // Exige obligatoriamente equipo de trabajo en caliente. Anula el chaleco estándar.
    return ['casco', 'traje_cuero', 'careta', 'respirador', 'guantes'].includes(k);
  }
  if (petar === 'lavado') {
    // Exige traje impermeable y careta para salpicaduras.
    return ['casco', 'traje_tyvek', 'careta', 'guantes', 'botas'].includes(k);
  }
  if (petar === 'pegado') {
    // Máxima prioridad a la protección respiratoria por solventes.
    return ['casco', 'traje_tyvek', 'respirador', 'guantes', 'botas'].includes(k);
  }
  return false;
}

function categoria(nombre) {
  const n = String(nombre).toLowerCase().replace(/[_ ]/g, '-');
  if (n.startsWith('no-') || n.startsWith('sin-')) {
    for (const e of EPP) if (CATEGORIAS[e.k].some((c) => n.includes(c))) return 'sin_' + e.k;
    return 'sin_otro';
  }
  for (const [cat, claves] of Object.entries(CATEGORIAS)) {
    if (claves.some((c) => n.includes(c))) return cat;
  }
  return null;
}

// ---------- Base de Datos Local (Modelos) ----------
function abrirDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('seguridad-minera', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('modelos');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function dbLeer(clave) {
  try {
    const db = await abrirDB();
    return await new Promise((res) => {
      const q = db.transaction('modelos').objectStore('modelos').get(clave);
      q.onsuccess = () => res(q.result || null);
      q.onerror = () => res(null);
    });
  } catch (e) { return null; }
}
async function dbGuardar(clave, valor) {
  try {
    const db = await abrirDB();
    db.transaction('modelos', 'readwrite').objectStore('modelos').put(valor, clave);
  } catch (e) { }
}

let sesCoco = null, sesEpp = null, eppNC = null;
function crearSesion(src) {
  return ort.InferenceSession.create(src, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
}
function nombresEpp() {
  return $('clases').value.split(',').map((s) => s.trim()).filter(Boolean);
}
function actualizarInfo() {
  const n = nombresEpp().length;
  $('infoModelos').textContent = `COCO: ${sesCoco ? '✅' : '❌'} · EPP: ${sesEpp ? '✅' : '❌'}`;
  estado(sesCoco ? (sesEpp ? 'Listo ✅ (COCO + EPP)' : 'Listo COCO. Carga modelo EPP') : 'Error modelo COCO');
}

async function iniciar() {
  try {
    estado('Cargando motor neuronal…');
    sesCoco = await crearSesion('modelos/coco.onnx');
  } catch (e) { return estado('Falla coco.onnx: ' + e.message); }
  
  try {
    const r = await fetch('modelos/epp.onnx');
    if (r.ok) sesEpp = await crearSesion(new Uint8Array(await r.arrayBuffer()));
  } catch (e) { }
  
  if (!sesEpp) {
    const buf = await dbLeer('epp');
    if (buf) { try { sesEpp = await crearSesion(new Uint8Array(buf)); } catch (e) {} }
  }
  $('btnVivo').disabled = false;
  actualizarInfo();
  renderizarRegistro(); // Carga historial del turno al abrir
}

// ---------- Preprocesamiento y Decodificación ----------
const cv640 = document.createElement('canvas');
cv640.width = cv640.height = S;
const ctx640 = cv640.getContext('2d', { willReadFrequently: true });

function preparar(src, W, H) {
  const s = Math.min(S / W, S / H);
  const nw = Math.round(W * s), nh = Math.round(H * s);
  const px = Math.round((S - nw) / 2 - 0.1), py = Math.round((S - nh) / 2 - 0.1);
  ctx640.fillStyle = 'rgb(114,114,114)';
  ctx640.fillRect(0, 0, S, S);
  ctx640.drawImage(src, 0, 0, W, H, px, py, nw, nh);
  const d = ctx640.getImageData(0, 0, S, S).data;
  const n = S * S, f = new Float32Array(3 * n);
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    f[i] = d[j] / 255; f[n + i] = d[j + 1] / 255; f[2 * n + i] = d[j + 2] / 255;
  }
  return { tensor: new ort.Tensor('float32', f, [1, 3, S, S]), s, px, py, nw, nh, W, H };
}

function decodificar(t, conf, permitidas) {
  const d = t.data, A = t.dims[1], B = t.dims[2], res = [];
  let nc;
  if (A < B) {
    const N = B; nc = A - 4 - NM;
    for (let i = 0; i < N; i++) {
      let mejor = -1, ms = conf;
      for (let j = 0; j < nc; j++) {
        const v = d[(4 + j) * N + i];
        if (v > ms && (!permitidas || permitidas.has(j))) { ms = v; mejor = j; }
      }
      if (mejor < 0) continue;
      const cx = d[i], cy = d[N + i], w = d[2 * N + i], h = d[3 * N + i];
      const coef = new Float32Array(NM);
      for (let k = 0; k < NM; k++) coef[k] = d[(4 + nc + k) * N + i];
      res.push({ x1: cx - w / 2, y1: cy - h / 2, x2: cx + w / 2, y2: cy + h / 2, score: ms, cls: mejor, coef });
    }
  }
  return { cands: res, nc };
}

function iou(a, b) {
  const w = Math.max(0, Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1));
  const h = Math.max(0, Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1));
  const inter = w * h;
  return inter / ((a.x2 - a.x1) * (a.y2 - a.y1) + (b.x2 - b.x1) * (b.y2 - b.y1) - inter + 1e-6);
}

function nms(cands, umbral) {
  cands.sort((a, b) => b.score - a.score);
  const top = cands.slice(0, 300), keep = [];
  for (const a of top) {
    if (keep.every((b) => b.cls !== a.cls || iou(a, b) < umbral)) keep.push(a);
    if (keep.length >= 100) break;
  }
  return keep;
}

const Q = 320;
function armarDeteccion(c, protos, lb, nombres) {
  const pd = protos.data, PP = P * P, m = new Uint8Array(PP);
  const bx1 = Math.max(0, Math.floor(c.x1 / 4)), by1 = Math.max(0, Math.floor(c.y1 / 4));
  const bx2 = Math.min(P, Math.ceil(c.x2 / 4)), by2 = Math.min(P, Math.ceil(c.y2 / 4));
  const ex1 = Math.max(0, bx1 - 1), ey1 = Math.max(0, by1 - 1), ex2 = Math.min(P, bx2 + 1), ey2 = Math.min(P, by2 + 1);
  const ew = ex2 - ex1, eh = ey2 - ey1, v = new Float32Array(Math.max(0, ew * eh));
  
  for (let y = ey1; y < ey2; y++) {
    for (let x = ex1; x < ex2; x++) {
      const p = y * P + x;
      let s = 0;
      for (let k = 0; k < NM; k++) s += c.coef[k] * pd[k * PP + p];
      v[(y - ey1) * ew + (x - ex1)] = s;
      if (s > 0 && x >= bx1 && x < bx2 && y >= by1 && y < by2) m[p] = 1;
    }
  }
  const f = Q / P, mh = new Uint8Array(Q * Q);
  const qx1 = Math.max(0, Math.floor(c.x1 / 2)), qy1 = Math.max(0, Math.floor(c.y1 / 2));
  const qx2 = Math.min(Q, Math.ceil(c.x2 / 2)), qy2 = Math.min(Q, Math.ceil(c.y2 / 2));
  for (let y = qy1; y < qy2; y++) {
    const sy = Math.min(eh - 1, Math.max(0, (y + 0.5) / f - 0.5 - ey1));
    const y0 = Math.floor(sy), y1 = Math.min(eh - 1, y0 + 1), wy = sy - y0;
    for (let x = qx1; x < qx2; x++) {
      const sx = Math.min(ew - 1, Math.max(0, (x + 0.5) / f - 0.5 - ex1));
      const x0 = Math.floor(sx), x1 = Math.min(ew - 1, x0 + 1), wx = sx - x0;
      const a = v[y0 * ew + x0] * (1 - wx) + v[y0 * ew + x1] * wx;
      const b = v[y1 * ew + x0] * (1 - wx) + v[y1 * ew + x1] * wx;
      if (a * (1 - wy) + b * wy > 0) mh[y * Q + x] = 1;
    }
  }
  const cl = (val, max) => Math.max(0, Math.min(max, val));
  const box = [
    cl((c.x1 - lb.px) / lb.s, lb.W), cl((c.y1 - lb.py) / lb.s, lb.H),
    cl((c.x2 - lb.px) / lb.s, lb.W), cl((c.y2 - lb.py) / lb.s, lb.H),
  ];
  const nombre = (nombres && nombres[c.cls]) || ('clase-' + c.cls);
  return { nombre, cat: categoria(nombre), conf: c.score, mask: m, maskHi: mh, box };
}

async function inferir(ses, lb, conf, permitidas, nombres) {
  const out = await ses.run({ [ses.inputNames[0]]: lb.tensor });
  let det = out[ses.outputNames[0]], protos = out[ses.outputNames[1]];
  if (det.dims.length === 4) [det, protos] = [protos, det];
  const { cands, nc } = decodificar(det, conf, permitidas);
  return { dets: nms(cands, 0.5).map((c) => armarDeteccion(c, protos, lb, nombres)), nc };
}

// ---------- Lógica Espacial ----------
const centro = (b) => [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
function dentro(p, b, tercioSup) {
  let [x1, y1, x2, y2] = b;
  if (tercioSup) { const h = b[3] - b[1]; y2 = y1 + h * 0.35; y1 -= h * 0.10; }
  return p[0] >= x1 && p[0] <= x2 && p[1] >= y1 && p[1] <= y2;
}

function dilatar(m, r) {
  const src = m.slice(), off = [];
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r * r) off.push(dx, dy);
  for (let y = 0; y < P; y++) {
    for (let x = 0; x < P; x++) {
      const i = y * P + x;
      if (!src[i]) continue;
      const borde = x === 0 || y === 0 || x === P - 1 || y === P - 1 ||
        !src[i - 1] || !src[i + 1] || !src[i - P] || !src[i + P];
      if (!borde) continue;
      for (let k = 0; k < off.length; k += 2) {
        const X = x + off[k], Y = y + off[k + 1];
        if (X >= 0 && X < P && Y >= 0 && Y < P) m[Y * P + X] = 1;
      }
    }
  }
}

function analizar(dets, lb, margenPct, eppActivo) {
  const PP = P * P, zona = new Uint8Array(PP);
  let hayMaquina = false;
  for (const d of dets) {
    if (d.cat !== 'maquina') continue;
    hayMaquina = true;
    for (let i = 0; i < PP; i++) if (d.mask[i]) zona[i] = 1;
  }
  if (hayMaquina) {
    const r = Math.round((margenPct / 100) * lb.W * lb.s / 4);
    if (r > 0) dilatar(zona, r);
  }
  const personas = [];
  for (const p of dets.filter((d) => d.cat === 'persona')) {
    const b = p.box;
    const hay = (cat, sup) => dets.some((d) => d.cat === cat && dentro(centro(d.box), b, sup));
    let enZona = false;
    for (let i = 0; i < PP; i++) if (p.mask[i] && zona[i]) { enZona = true; break; }
    if (!eppActivo) {
      personas.push({ box: b, maskHi: p.maskHi, enZona, lejos: false, epp: null });
      continue;
    }
    const tiene = {}, falta = {};
    for (const e of EPP) { tiene[e.k] = hay(e.k, e.sup); falta[e.k] = hay('sin_' + e.k, false); }
    const explicito = EPP.some((e) => exigidoDinamico(e.k) && falta[e.k]);
    const lejos = (b[3] - b[1]) < 0.12 * lb.H && !explicito;
    const epp = {};
    for (const e of EPP) {
      if (!exigidoDinamico(e.k)) continue;
      if (falta[e.k]) epp[e.k] = false;
      else if (tiene[e.k]) epp[e.k] = true;
      else epp[e.k] = (e.ausencia && !lejos) ? false : null;
    }
    personas.push({ box: b, maskHi: p.maskHi, enZona, lejos, epp });
  }
  const huerfanas = dets.filter((d) => EPP.some((e) => d.cat === 'sin_' + e.k && exigidoDinamico(e.k)) &&
    !personas.some((p) => dentro(centro(d.box), p.box, false)));
  return { zona, personas, huerfanas };
}

// ---------- Dibujo ----------
const vistaCanvas = document.createElement('canvas');
const vctx = vistaCanvas.getContext('2d');
const capa = document.createElement('canvas');
capa.width = capa.height = Q;
const cctx = capa.getContext('2d');

const RGB = { ok: [34, 197, 94], falta: [245, 158, 11], zona: [239, 68, 68], lejos: [234, 179, 8], maquina: [56, 189, 248], epp: [56, 189, 248], infra: [245, 158, 11], nd: [148, 163, 184] };
const hex = (c) => `rgb(${c[0]},${c[1]},${c[2]})`;
const CAT_EPP = { casco: RGB.epp, chaleco: RGB.epp, guantes: RGB.epp, botas: RGB.epp, sin_casco: RGB.infra, sin_chaleco: RGB.infra, sin_guantes: RGB.infra, sin_botas: RGB.infra, sin_otro: RGB.infra };

let ocupados = [];
function etiqueta(ctx, txt, x, y, color, fs, evitar) {
  ctx.font = `600 ${fs}px system-ui, sans-serif`;
  const w = ctx.measureText(txt).width + 8;
  x = Math.max(0, Math.min(x, ctx.canvas.width - w));
  let yy = Math.max(fs + 6, y);
  if (evitar) {
    const choca = (yv) => ocupados.some((r) => x < r.x + r.w && x + w > r.x && yv - fs - 6 < r.y + r.h && yv + 2 > r.y);
    for (let i = 0; i < 8 && choca(yy); i++) yy += fs + 8;
  }
  ocupados.push({ x, y: yy - fs - 6, w, h: fs + 8 });
  ctx.fillStyle = 'rgba(0,0,0,.7)';
  ctx.fillRect(x, yy - fs - 6, w, fs + 8);
  ctx.fillStyle = color;
  ctx.fillText(txt, x + 4, yy - 3);
}

function pintarPoligono(px, mask, rgb, alfaRelleno, grosor) {
  for (let y = 0; y < Q; y++) {
    for (let x = 0; x < Q; x++) {
      const i = y * Q + x;
      if (!mask[i]) continue;
      let borde = false;
      for (let d = 1; d <= grosor && !borde; d++) {
        borde = x < d || y < d || x >= Q - d || y >= Q - d || !mask[i - d] || !mask[i + d] || !mask[i - d * Q] || !mask[i + d * Q];
      }
      const j = i * 4, a = borde ? 255 : alfaRelleno;
      if (a >= px[j + 3]) { px[j] = rgb[0]; px[j + 1] = rgb[1]; px[j + 2] = rgb[2]; px[j + 3] = a; }
    }
  }
}

function dibujar(src, lb, dets, an, verMascaras) {
  const k = Math.min(1, 1280 / lb.W);
  const W = Math.round(lb.W * k), H = Math.round(lb.H * k);
  if (vistaCanvas.width !== W || vistaCanvas.height !== H) { vistaCanvas.width = W; vistaCanvas.height = H; }
  vctx.drawImage(src, 0, 0, W, H);

  let alertas = an.huerfanas.length;
  for (const p of an.personas) {
    const faltas = [];
    if (p.enZona) faltas.push('ZONA PELIGRO');
    const faltaEpp = p.epp ? EPP.filter((e) => p.epp[e.k] === false).map((e) => e.txt) : [];
    if (faltaEpp.length) faltas.push('sin: ' + faltaEpp.join(', '));
    const sinEval = p.epp === null;
    p.rgb = p.enZona ? RGB.zona : faltas.length ? RGB.falta : sinEval ? RGB.nd : p.lejos ? RGB.lejos : RGB.ok;
    p.txt = faltas.length ? faltas.join(', ') : sinEval ? 'EPP no evaluado' : p.lejos ? 'lejos: verificar' : 'OK';
    if (faltas.length) alertas++;
  }

  const img = cctx.createImageData(Q, Q), px = img.data;
  const zonaHi = new Uint8Array(Q * Q);
  for (let i = 0; i < Q * Q; i++) zonaHi[i] = an.zona[((i / Q | 0) >> 1) * P + ((i % Q) >> 1)];
  pintarPoligono(px, zonaHi, RGB.zona, 70, 0);
  for (const d of dets) if (d.cat === 'maquina') pintarPoligono(px, d.maskHi, RGB.maquina, 50, 1);
  for (const p of an.personas) pintarPoligono(px, p.maskHi, p.rgb, 95, 1);
  if (verMascaras) for (const d of dets) if (CAT_EPP[d.cat]) pintarPoligono(px, d.maskHi, CAT_EPP[d.cat], 150, 1);
  cctx.putImageData(img, 0, 0);
  vctx.imageSmoothingEnabled = true;
  vctx.drawImage(capa, lb.px / 2, lb.py / 2, lb.nw / 2, lb.nh / 2, 0, 0, W, H);

  ocupados = [];
  const fs = Math.max(12, Math.round(W / 48));
  for (const d of dets.filter((x) => x.cat === 'maquina')) etiqueta(vctx, d.nombre, d.box[0] * k, d.box[1] * k, hex(RGB.maquina), fs);
  for (const d of an.huerfanas) etiqueta(vctx, d.nombre, d.box[0] * k, d.box[3] * k + fs + 6, hex(RGB.infra), Math.round(fs * 0.85));
  if (verMascaras) {
    for (const d of dets) if (CAT_EPP[d.cat] && !an.huerfanas.includes(d)) etiqueta(vctx, d.nombre, d.box[0] * k, d.box[1] * k, hex(CAT_EPP[d.cat]), Math.round(fs * 0.75));
  }
  for (const p of an.personas) etiqueta(vctx, p.txt, p.box[0] * k, p.box[1] * k, hex(p.rgb), Math.round(fs * 0.9), true);
  etiqueta(vctx, `Personas: ${an.personas.length}  Alertas: ${alertas}`, 6, fs + 10, '#fff', Math.round(fs * 1.2));

  const vista = $('vista');
  if (vista.firstElementChild !== vistaCanvas) { vista.innerHTML = ''; vista.appendChild(vistaCanvas); }
  return alertas;
}

// ---------- Control de Contexto y Storage ----------
let registro = JSON.parse(localStorage.getItem('ssoma_turno') || '[]');
let ultimaInferencia = null; // Memoria de la foto procesada

function renderizarRegistro() {
  $('registro').innerHTML = '';
  registro.slice(-12).reverse().forEach(r => {
    const div = document.createElement('div');
    div.textContent = `[${r.hora}] ${r.actividad} | Alertas: ${r.alertas} | Temp: ${r.temp_c}°C | Tag: ${r.tag_vigia}`;
    $('registro').appendChild(div);
  });
}

$('btnGuardarRegistro').onclick = () => {
  if (!ultimaInferencia) return;
  const hAct = new Date();
  const turnoStr = (hAct.getHours() >= 19 || hAct.getHours() < 7) ? 'Noche' : 'Día';
  
  const fila = {
    fecha: hAct.toLocaleDateString('es-PE'), hora: hAct.toLocaleTimeString('es-PE'),
    turno: turnoStr, actividad: document.querySelector('input[name="petar"]:checked').value,
    temp_c: $('tempC').value || 'N/D', tag_vigia: $('tagVigia').value || 'Sin justificación',
    obs_voz: $('obsVoz').value || '-',
    personas: ultimaInferencia.personas, alertas: ultimaInferencia.alertas, en_zona: ultimaInferencia.en_zona,
    sin_casco: ultimaInferencia.sin_casco, sin_chaleco: ultimaInferencia.sin_chaleco,
    sin_guantes: ultimaInferencia.sin_guantes, sin_botas: ultimaInferencia.sin_botas
  };

  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition((pos) => {
      fila.lat = pos.coords.latitude.toFixed(5); fila.lon = pos.coords.longitude.toFixed(5);
      finalizarGuardado(fila);
    }, () => { fila.lat = 'N/D'; fila.lon = 'N/D'; finalizarGuardado(fila); }, { timeout: 3000 });
  } else {
    fila.lat = 'N/D'; fila.lon = 'N/D'; finalizarGuardado(fila);
  }
};

function finalizarGuardado(fila) {
  registro.push(fila);
  localStorage.setItem('ssoma_turno', JSON.stringify(registro));
  renderizarRegistro();
  estado('Inspección consolidada localmente ✅');
  $('tagVigia').value = ''; $('tempC').value = ''; $('obsVoz').value = '';
  $('panelVigia').style.display = 'none';
}

// Generador de texto rápido para WhatsApp/Correo
$('btnCopiarReporte').onclick = () => {
  if (!ultimaInferencia) return;
  const txt = `🚨 Auditoría SSOMA [${new Date().toLocaleTimeString('es-PE')}]\nFrente: ${document.querySelector('input[name="petar"]:checked').value.toUpperCase()}\nPersonas Expuestas: ${ultimaInferencia.personas}\nAlertas EPP: ${ultimaInferencia.alertas}\nTemperatura: ${$('tempC').value || 'N/D'}°C\nHallazgo: ${$('tagVigia').value || 'N/A'}\nNotas: ${$('obsVoz').value || '-'}`;
  navigator.clipboard.writeText(txt).then(() => estado('Reporte SSOMA copiado al portapapeles.'));
};

$('btnCsv').onclick = () => {
  if (!registro.length) { estado('El turno actual no tiene inspecciones.'); return; }
  const cab = Object.keys(registro[0]);
  const csv = [cab.join(','), ...registro.map((r) => cab.map((c) => `"${r[c]}"`).join(','))].join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = `SSOMA_Turno_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
};

// Dictado por voz
$('btnMic').onclick = () => {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return alert('El navegador no soporta dictado por voz.');
  const rec = new SR();
  rec.lang = 'es-PE';
  rec.start();
  $('btnMic').style.background = 'var(--danger)';
  rec.onresult = (e) => { $('obsVoz').value += ($('obsVoz').value ? ' ' : '') + e.results[0][0].transcript; };
  rec.onend = () => $('btnMic').style.background = 'transparent';
};

// ---------- Proceso Central ----------
const snap = document.createElement('canvas');
const sctx = snap.getContext('2d');

async function procesar(src, W0, H0) {
  if (!sesCoco) return;
  const k = Math.min(1, 1920 / Math.max(W0, H0));
  const W = Math.round(W0 * k), H = Math.round(H0 * k);
  snap.width = W; snap.height = H;
  sctx.drawImage(src, 0, 0, W, H);
  const lb = preparar(snap, W, H);

  let dets = [];
  if (sesEpp) {
    const r = await inferir(sesEpp, lb, +$('conf').value, null, nombresEpp());
    if (r.nc !== null && r.nc !== eppNC) { eppNC = r.nc; actualizarInfo(); }
    dets = dets.concat(r.dets);
  }
  const rc = await inferir(sesCoco, lb, +$('confCoco').value, COCO_CLASES, COCO_NOMBRES);
  dets = dets.concat(rc.dets.filter((d) => d.cat === 'persona' || d.cat === 'maquina'));

  const an = analizar(dets, lb, +$('margen').value, !!sesEpp);
  const alertas = dibujar(snap, lb, dets, an, $('verMascaras').checked);

  const n = { personas: an.personas.length, alertas, en_zona: an.personas.filter((p) => p.enZona).length };
  for (const e of EPP) {
    n['sin_' + e.k] = (sesEpp && exigidoDinamico(e.k))
      ? an.personas.filter((p) => p.epp && p.epp[e.k] === false).length + an.huerfanas.filter((d) => d.cat === 'sin_' + e.k).length
      : 'n/d';
  }
  $('kPersonas').textContent = n.personas; $('kAlertas').textContent = n.alertas;
  $('kZona').textContent = n.en_zona;
  
  // Evita error si el HTML no tiene la caja para el KPI específico (ej. careta)
  for (const e of EPP) {
    if ($('k_' + e.k)) {
      $('k_' + e.k).textContent = n['sin_' + e.k] === 'n/d' ? '–' : n['sin_' + e.k];
    }
  }
  
  if (!vivo) {
    ultimaInferencia = n;
    $('panelVigia').style.display = 'block'; // Activa el formulario del vigía
  }
  return n;
}

// ---------- Interfaz de Hardware ----------
async function desdeArchivo(ev) {
  const f = ev.target.files[0]; ev.target.value = ''; if (!f) return;
  if (vivo) detenerVivo();
  if (!sesCoco) { estado('Espera a que carguen los modelos…'); return; }
  estado('Auditoría en proceso…');
  try {
    const img = await createImageBitmap(f);
    const t0 = performance.now();
    await procesar(img, img.width, img.height);
    estado(`Completado en ${((performance.now() - t0) / 1000).toFixed(1)} s` + (sesEpp ? '' : ' · (Sin modelo EPP)'));
  } catch (e) { estado('Error de lectura: ' + e.message); }
}
$('inCamara').onchange = desdeArchivo; $('inGaleria').onchange = desdeArchivo;

let vivo = false, stream = null;
const video = $('video');
function detenerVivo() {
  vivo = false;
  if (stream) stream.getTracks().forEach((t) => t.stop());
  stream = null;
  $('btnVivo').textContent = '🎥 En vivo'; $('btnVivo').classList.remove('activo');
}
$('btnVivo').onclick = async () => {
  if (vivo) { detenerVivo(); estado('Cámara detenida'); return; }
  try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
  } catch (e) { return estado('Error cámara. El modo en vivo requiere HTTPS.'); }
  video.srcObject = stream; await video.play(); vivo = true;
  $('btnVivo').textContent = '⏹️ Detener'; $('btnVivo').classList.add('activo');
  $('panelVigia').style.display = 'none'; // Se oculta en vivo para no estorbar
  while (vivo) {
    const t0 = performance.now();
    if (video.videoWidth) await procesar(video, video.videoWidth, video.videoHeight);
    estado(`Vigilando · ${(1000 / (performance.now() - t0)).toFixed(1)} FPS`);
    await new Promise((r) => setTimeout(r, 30));
  }
};

// ---------- Archivos Locales ----------
$('inModelo').onchange = async (ev) => {
  const f = ev.target.files[0]; ev.target.value = ''; if (!f) return;
  estado('Procesando modelo EPP…');
  try {
    const buf = await f.arrayBuffer();
    sesEpp = await crearSesion(new Uint8Array(buf));
    eppNC = null; await dbGuardar('epp', buf);
    actualizarInfo(); estado('Modelo cargado (disponible offline)');
  } catch (e) { estado('Modelo inválido: ' + e.message); }
};
for (const id of ['conf', 'confCoco', 'margen']) { $(id).oninput = () => { $(id + 'V').textContent = $(id).value; }; }
$('clases').onchange = actualizarInfo;

iniciar();