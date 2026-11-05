'use strict';
/* =====================================================================
   Auditoría SSOMA IA – v3 PETAR
   - Resuelve contradicción Gloves vs No-Gloves en guantes de cuero bicolores
   - Evalúa Traje de Cuero (descarne) vs Casaca común (No-Vest)
   - Exige Careta Facial y Casco en trabajos en caliente
   - Detecta haces y conos de chispas como Zona de Peligro (Línea de Fuego)
   ===================================================================== */
const S = 640;
const P = 160;
const NM = 32;
const Q = 320;

ort.env.wasm.wasmPaths = new URL('lib/', location.href).href;
ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;

const $ = (id) => document.getElementById(id);
const estado = (msg) => { $('estado').textContent = msg; };

const CATEGORIAS = {
  persona:     ['person', 'persona', 'worker', 'trabajador'],
  casco:       ['helmet', 'hardhat', 'hard-hat', 'casco'],
  chaleco:     ['vest', 'chaleco'],
  guantes:     ['glove', 'guante'],
  botas:       ['shoe', 'boot', 'bota', 'calzado', 'zapato'],
  traje_cuero: ['leather', 'leather-suit', 'mandil', 'traje-cuero', 'cuero'],
  traje_tyvek: ['tyvek', 'impermeable', 'traje-tyvek'],
  careta:      ['shield', 'face-shield', 'careta', 'welding-mask'],
  respirador:  ['respirator', 'full-face', 'mask', 'respirador'],
  maquina:     ['truck', 'excavator', 'loader', 'dozer', 'machinery', 'vehicle', 'bus', 'car', 'camion', 'maquina'],
};
const COCO_NOMBRES = { 0: 'person', 2: 'car', 5: 'bus', 7: 'truck' };
const COCO_CLASES = new Set([0, 2, 5, 7]);
const EPP_LISTA = ['casco', 'chaleco', 'guantes', 'botas', 'traje_cuero', 'traje_tyvek', 'careta', 'respirador'];

function petarActual() {
  const el = document.querySelector('input[name="petar"]:checked');
  return el ? el.value : 'esmerilado';
}

function actualizarEtiquetasKPI() {
  const modo = petarActual();
  if (modo === 'esmerilado') {
    $('lbl_torso').textContent = 'Sin traje cuero';
    $('lbl_facial').textContent = 'Sin careta';
  } else if (modo === 'lavado') {
    $('lbl_torso').textContent = 'Sin traje imperm.';
    $('lbl_facial').textContent = 'Sin careta/visor';
  } else if (modo === 'pegado') {
    $('lbl_torso').textContent = 'Sin traje químico';
    $('lbl_facial').textContent = 'Sin Full-Face';
  } else {
    $('lbl_torso').textContent = 'Sin chaleco';
    $('lbl_facial').textContent = 'Sin prot. facial';
  }
}

function categoria(nombre) {
  const n = String(nombre).toLowerCase().replace(/[_ ]/g, '-');
  if (n.startsWith('no-') || n.startsWith('sin-')) {
    for (const k of EPP_LISTA) if (CATEGORIAS[k].some((c) => n.includes(c))) return 'sin_' + k;
    return 'sin_otro';
  }
  for (const [cat, claves] of Object.entries(CATEGORIAS)) {
    if (claves.some((c) => n.includes(c))) return cat;
  }
  return null;
}

// ---------- IndexedDB ----------
function abrirDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('seguridad-minera', 1);
    r.onupgradeneeded = () => {
      if (!r.result.objectStoreNames.contains('modelos')) r.result.createObjectStore('modelos');
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function dbLeer(clave) {
  let db;
  try {
    db = await abrirDB();
    return await new Promise((res, rej) => {
      const tx = db.transaction('modelos', 'readonly');
      const q = tx.objectStore('modelos').get(clave);
      let valor = null;
      q.onsuccess = () => { valor = q.result || null; };
      q.onerror = () => rej(q.error || new Error('No se pudo leer el modelo.'));
      tx.oncomplete = () => res(valor);
      tx.onerror = () => rej(tx.error || new Error('Falló la lectura de IndexedDB.'));
      tx.onabort = () => rej(tx.error || new Error('Lectura de IndexedDB cancelada.'));
    });
  } catch (e) { console.warn('IndexedDB: no se pudo leer', e); return null; }
  finally { if (db) db.close(); }
}
async function dbGuardar(clave, valor) {
  let db;
  try {
    db = await abrirDB();
    await new Promise((res, rej) => {
      const tx = db.transaction('modelos', 'readwrite');
      tx.objectStore('modelos').put(valor, clave);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error || new Error('Falló la escritura en IndexedDB.'));
      tx.onabort = () => rej(tx.error || new Error('Escritura en IndexedDB cancelada.'));
    });
    return true;
  } catch (e) { console.warn('IndexedDB: no se pudo guardar', e); return false; }
  finally { if (db) db.close(); }
}

let sesCoco = null, sesEpp = null, eppNC = null;
let ultimaImg = null;

function crearSesion(src) {
  return ort.InferenceSession.create(src, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
}
function nombresEpp() {
  return $('clases').value.split(',').map((s) => s.trim()).filter(Boolean);
}
function actualizarInfo() {
  const n = nombresEpp().length;
  $('infoModelos').textContent =
    `COCO: ${sesCoco ? 'cargado ✅' : 'no cargado'} · EPP: ${sesEpp ? 'cargado ✅' : 'NO cargado'}` +
    (eppNC !== null && eppNC !== n ? ` · ⚠️ modelo de ${eppNC} clases` : '');
  estado(sesCoco ? (sesEpp ? 'Listo ✅ (Auditoría v3 PETAR activa)' : 'Listo COCO') : 'Error modelo COCO');
}

async function iniciar() {
  actualizarEtiquetasKPI();
  renderizarRegistro();
  try {
    estado('Cargando modelo de personas y vehículos…');
    sesCoco = await crearSesion('modelos/coco.onnx');
  } catch (e) {
    estado('No se pudo cargar modelos/coco.onnx: ' + e.message);
    return;
  }
  try {
    const r = await fetch('modelos/epp.onnx');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const buf = await r.arrayBuffer();
    sesEpp = await crearSesion(new Uint8Array(buf));
    await dbGuardar('epp', buf);
  } catch (e) {}
  if (!sesEpp) {
    const buf = await dbLeer('epp');
    if (buf) { try { sesEpp = await crearSesion(new Uint8Array(buf)); } catch (e) {} }
  }
  $('btnVivo').disabled = false;
  actualizarInfo();
}

// ---------- Preprocesamiento ----------
const cv640 = document.createElement('canvas');
cv640.width = cv640.height = S;
const ctx640 = cv640.getContext('2d', { willReadFrequently: true });
const entradaFloat = new Float32Array(3 * S * S);

function preparar(src, W, H) {
  const s = Math.min(S / W, S / H);
  const nw = Math.round(W * s), nh = Math.round(H * s);
  const px = Math.round((S - nw) / 2 - 0.1), py = Math.round((S - nh) / 2 - 0.1);
  ctx640.fillStyle = 'rgb(114,114,114)';
  ctx640.fillRect(0, 0, S, S);
  ctx640.drawImage(src, 0, 0, W, H, px, py, nw, nh);
  const d = ctx640.getImageData(0, 0, S, S).data;
  const n = S * S, f = entradaFloat;
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    f[i] = d[j] / 255; f[n + i] = d[j + 1] / 255; f[2 * n + i] = d[j + 2] / 255;
  }
  return { data: f, raw: d, s, px, py, nw, nh, W, H };
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
  } else {
    const K = A, C = B; nc = null;
    for (let i = 0; i < K; i++) {
      const o = i * C, sc = d[o + 4], cl = Math.round(d[o + 5]);
      if (sc < conf || (permitidas && !permitidas.has(cl))) continue;
      res.push({ x1: d[o], y1: d[o + 1], x2: d[o + 2], y2: d[o + 3], score: sc, cls: cl, coef: d.slice(o + 6, o + 6 + NM) });
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
  const input = new ort.Tensor('float32', lb.data, [1, 3, S, S]);
  let out;
  try {
    out = await ses.run({ [ses.inputNames[0]]: input });
    let det = out[ses.outputNames[0]], protos = out[ses.outputNames[1]];
    if (det.dims.length === 4) [det, protos] = [protos, det];
    const { cands, nc } = decodificar(det, conf, permitidas);
    return { dets: nms(cands, 0.5).map((c) => armarDeteccion(c, protos, lb, nombres)), nc };
  } finally {
    const liberados = new Set();
    const liberar = (t) => {
      if (t && !liberados.has(t) && typeof t.dispose === 'function') { liberados.add(t); t.dispose(); }
    };
    if (out) Object.values(out).forEach(liberar);
    liberar(input);
  }
}

// ---------- Reglas de Seguridad y Corrección de Falsos Positivos ----------
const centro = (b) => [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
function dentro(p, b, tercioSup) {
  let [x1, y1, x2, y2] = b;
  if (tercioSup) { const h = b[3] - b[1]; y2 = y1 + h * 0.35; y1 -= h * 0.10; }
  return p[0] >= x1 && p[0] <= x2 && p[1] >= y1 && p[1] <= y2;
}

// Verifica si dos cajas se tocan o pertenecen a la misma extremidad/guante
function cajasConectadas(a, b) {
  const mx = Math.max(a[2] - a[0], b[2] - b[0]) * 0.35;
  const my = Math.max(a[3] - a[1], b[3] - b[1]) * 0.35;
  const w = Math.max(0, Math.min(a[2] + mx, b[2] + mx) - Math.max(a[0] - mx, b[0] - mx));
  const h = Math.max(0, Math.min(a[3] + my, b[3] + my) - Math.max(a[1] - my, b[1] - my));
  return w > 0 && h > 0;
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

// Detecta haces y conos de chispas incandescentes
const bufferChispas = new Uint8Array(P * P);
function detectarChispas(lb, zona) {
  const d = lb.raw;
  let puntosChispa = 0;
  const chispas = bufferChispas;
  chispas.fill(0);
  for (let y = 1; y < P - 1; y++) {
    const sy = y * 4;
    if (sy < lb.py + 8 || sy >= lb.py + lb.nh - 8) continue;
    for (let x = 1; x < P - 1; x++) {
      const sx = x * 4;
      if (sx < lb.px + 8 || sx >= lb.px + lb.nw - 8) continue;
      const idx = (sy * S + sx) * 4;
      const r = d[idx], g = d[idx + 1], b = d[idx + 2];
      const luma = (r * 0.299) + (g * 0.587) + (b * 0.114);
      // Núcleo incandescente de alta luminancia o halo naranja con dominancia roja.
      if (luma > 230 || (luma > 160 && r > 210 && g > 120 && b < 100)) {
        chispas[y * P + x] = 1;
        puntosChispa++;
      }
    }
  }
  if (puntosChispa >= 6) {
    for (let i = 0; i < P * P; i++) if (chispas[i]) zona[i] = 1;
    return true;
  }
  return false;
}

// Evalúa si el torso de la persona tiene color de cuero de descarne (amarillo/ocre) o casaca común
function torsoPareceCuero(pMask, lb) {
  const d = lb.raw;
  let tot = 0, cuero = 0;
  for (let y = 0; y < P; y++) {
    for (let x = 0; x < P; x++) {
      if (!pMask[y * P + x]) continue;
      const idx = (y * 4 * S + x * 4) * 4;
      const r = d[idx], g = d[idx + 1], b = d[idx + 2];
      tot++;
      // Rango cromático típico del cuero/descarne amarillo-ocre de soldador
      if (r > 110 && g > 80 && (r - b) > 30 && r >= g * 0.85) cuero++;
    }
  }
  return tot > 20 && (cuero / tot) > 0.08;
}

const bufferZona = new Uint8Array(P * P);
function analizar(dets, lb, margenPct) {
  const modo = petarActual();
  const PP = P * P, zona = bufferZona;
  zona.fill(0);
  let hayFocoPeligro = false;
  const personasRaw = dets.filter((d) => d.cat === 'persona');

  // 1. Filtra falsos positivos de guantes:
  //    a) Elimina "Gloves" en la cabeza (ej. capucha azul)
  for (let i = dets.length - 1; i >= 0; i--) {
    const d = dets[i];
    if (d.cat === 'guantes') {
      const c = centro(d.box);
      const enCabeza = personasRaw.some((p) => {
        const h = p.box[3] - p.box[1];
        return c[0] >= p.box[0] && c[0] <= p.box[2] && c[1] >= p.box[1] && c[1] <= p.box[1] + h * 0.28;
      });
      if (enCabeza) dets.splice(i, 1);
    }
  }

  //    b) Resuelve contradicción Gloves vs No-Gloves en guantes de cuero bicolores (puño azul + palma cuero naranja)
  const guantesValidos = dets.filter((d) => d.cat === 'guantes');
  for (let i = dets.length - 1; i >= 0; i--) {
    const d = dets[i];
    if (d.cat === 'sin_guantes') {
      const pegadoAGuante = guantesValidos.some((g) => cajasConectadas(d.box, g.box));
      if (pegadoAGuante) {
        // Une la máscara de la palma de cuero al guante válido y elimina la falsa infracción
        const g = guantesValidos.find((x) => cajasConectadas(d.box, x.box));
        for (let k = 0; k < Q * Q; k++) if (d.maskHi[k]) g.maskHi[k] = 1;
        dets.splice(i, 1);
      }
    }
  }

  // 2. Construye Zona de Peligro (Maquinaria o Chispas de Esmerilado)
  for (const d of dets) {
    if (d.cat !== 'maquina') continue;
    hayFocoPeligro = true;
    for (let i = 0; i < PP; i++) if (d.mask[i]) zona[i] = 1;
  }
  if (modo === 'esmerilado' && detectarChispas(lb, zona)) {
    hayFocoPeligro = true;
  }
  if (hayFocoPeligro) {
    const r = Math.round((margenPct / 100) * lb.W * lb.s / 4);
    if (r > 0) dilatar(zona, r);
  }

  const listaClases = nombresEpp().map((c) => categoria(c));
  const modeloTieneCuero = listaClases.includes('traje_cuero');
  const modeloTieneCareta = listaClases.includes('careta') || listaClases.includes('respirador');

  const personas = [];
  for (const p of personasRaw) {
    const b = p.box;
    const hay = (cat, sup) => dets.some((d) => d.cat === cat && dentro(centro(d.box), b, sup));
    let enZona = false;
    for (let i = 0; i < PP; i++) if (p.mask[i] && zona[i]) { enZona = true; break; }

    const lejos = (b[3] - b[1]) < 0.14 * lb.H;
    const tieneCasco = hay('casco', true) && !hay('sin_casco', false);
    const faltaGuantes = hay('sin_guantes', false) && !hay('guantes', false);
    const faltaBotas = hay('sin_botas', false);

    const faltas = [];
    let sinCasco = false, sinTorso = false, sinFacial = false, sinGuantes = false, sinBotas = false;

    if (!tieneCasco && !lejos) {
      sinCasco = true;
      faltas.push('casco');
    }
    if (faltaGuantes && !lejos) {
      sinGuantes = true;
      faltas.push('guantes');
    }
    if (faltaBotas && !lejos) {
      sinBotas = true;
      faltas.push('botas');
    }

    if (modo === 'esmerilado') {
      // Verifica si lleva traje de cuero (por clase ONNX o por cobertura de descarne sin No-Vest)
      const tieneCuero = modeloTieneCuero
        ? hay('traje_cuero', false)
        : (!hay('sin_chaleco', false) && torsoPareceCuero(p.mask, lb));
      const tieneCareta = modeloTieneCareta ? (hay('careta', true) || hay('respirador', true)) : false;

      if (!tieneCuero && !lejos) { sinTorso = true; faltas.push('traje cuero'); }
      if (!tieneCareta && !lejos) { sinFacial = true; faltas.push('careta facial'); }
    } else if (modo === 'lavado') {
      const tieneTyvek = listaClases.includes('traje_tyvek') ? hay('traje_tyvek', false) : false;
      const tieneCareta = modeloTieneCareta ? (hay('careta', true) || hay('respirador', true)) : false;
      if (!tieneTyvek && !lejos) { sinTorso = true; faltas.push('traje imperm.'); }
      if (!tieneCareta && !lejos) { sinFacial = true; faltas.push('careta'); }
    } else if (modo === 'pegado') {
      const tieneTyvek = listaClases.includes('traje_tyvek') ? hay('traje_tyvek', false) : false;
      const tieneResp = modeloTieneCareta ? hay('respirador', true) : false;
      if (!tieneTyvek && !lejos) { sinTorso = true; faltas.push('traje químico'); }
      if (!tieneResp && !lejos) { sinFacial = true; faltas.push('Full-Face'); }
    } else {
      const tieneChaleco = hay('chaleco', false) && !hay('sin_chaleco', false);
      if (!tieneChaleco && !lejos) { sinTorso = true; faltas.push('chaleco'); }
    }

    personas.push({
      box: b, maskHi: p.maskHi, enZona, lejos, faltas,
      sinCasco, sinTorso, sinFacial, sinGuantes, sinBotas
    });
  }

  return { zona, personas };
}

// ---------- Dibujo ----------
const vistaCanvas = document.createElement('canvas');
const vctx = vistaCanvas.getContext('2d');
const capa = document.createElement('canvas');
capa.width = capa.height = Q;
const cctx = capa.getContext('2d');
const imgCapa = cctx.createImageData(Q, Q);
const bufferZonaHi = new Uint8Array(Q * Q);

const RGB = {
  ok: [34, 197, 94], falta: [245, 158, 11], zona: [239, 68, 68], lejos: [234, 179, 8],
  maquina: [56, 189, 248], epp: [56, 189, 248], infra: [245, 158, 11]
};
const hex = (c) => `rgb(${c[0]},${c[1]},${c[2]})`;
const CAT_EPP = {
  casco: RGB.epp, chaleco: RGB.epp, guantes: RGB.epp, botas: RGB.epp,
  traje_cuero: RGB.epp, traje_tyvek: RGB.epp, careta: RGB.epp, respirador: RGB.epp,
  sin_casco: RGB.infra, sin_guantes: RGB.infra, sin_botas: RGB.infra
};

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
  ctx.fillStyle = 'rgba(0,0,0,.78)';
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
        borde = x < d || y < d || x >= Q - d || y >= Q - d ||
          !mask[i - d] || !mask[i + d] || !mask[i - d * Q] || !mask[i + d * Q];
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

  let alertas = 0;
  for (const p of an.personas) {
    const msgs = [];
    if (p.enZona) msgs.push('LÍNEA DE FUEGO');
    if (p.faltas.length) msgs.push('sin: ' + p.faltas.join(', '));
    p.rgb = p.enZona ? RGB.zona : p.faltas.length ? RGB.falta : p.lejos ? RGB.lejos : RGB.ok;
    p.txt = msgs.length ? msgs.join(' · ') : p.lejos ? 'tercero/fondo: verificar' : 'OK';
    if (msgs.length) alertas++;
  }

  const img = imgCapa, px = img.data;
  px.fill(0);
  const zonaHi = bufferZonaHi;
  for (let i = 0; i < Q * Q; i++) zonaHi[i] = an.zona[((i / Q | 0) >> 1) * P + ((i % Q) >> 1)];
  pintarPoligono(px, zonaHi, RGB.zona, 75, 1);
  for (const d of dets) if (d.cat === 'maquina') pintarPoligono(px, d.maskHi, RGB.maquina, 50, 1);
  for (const p of an.personas) pintarPoligono(px, p.maskHi, p.rgb, 95, 1);
  if (verMascaras) {
    for (const d of dets) if (CAT_EPP[d.cat]) pintarPoligono(px, d.maskHi, CAT_EPP[d.cat], 150, 1);
  }
  cctx.putImageData(img, 0, 0);
  vctx.imageSmoothingEnabled = true;
  vctx.drawImage(capa, lb.px / 2, lb.py / 2, lb.nw / 2, lb.nh / 2, 0, 0, W, H);

  ocupados = [];
  const fs = Math.max(12, Math.round(W / 48));
  if (verMascaras) {
    for (const d of dets) if (CAT_EPP[d.cat]) {
      const lbl = (d.cat === 'sin_chaleco' && petarActual() === 'esmerilado') ? 'Sin-Traje-Cuero' : d.nombre;
      etiqueta(vctx, lbl, d.box[0] * k, d.box[1] * k, hex(CAT_EPP[d.cat]), Math.round(fs * 0.75));
    }
  }
  for (const p of an.personas) etiqueta(vctx, p.txt, p.box[0] * k, p.box[1] * k, hex(p.rgb), Math.round(fs * 0.88), true);
  etiqueta(vctx, `Modo: ${petarActual().toUpperCase()} · Personas: ${an.personas.length} · Alertas: ${alertas}`, 6, fs + 10, '#fff', Math.round(fs * 1.1));

  const vista = $('vista');
  if (vista.firstElementChild !== vistaCanvas) { vista.innerHTML = ''; vista.appendChild(vistaCanvas); }
  return alertas;
}

// ---------- Registro Acumulado del Turno ----------
function leerRegistroLocal() {
  try {
    const valor = JSON.parse(localStorage.getItem('ssoma_turno') || '[]');
    return Array.isArray(valor) ? valor : [];
  } catch (e) { console.warn('No se pudo restaurar el registro local.', e); return []; }
}
function guardarRegistroLocal() {
  try { localStorage.setItem('ssoma_turno', JSON.stringify(registro)); return true; }
  catch (e) { console.warn('No se pudo guardar el registro local.', e); return false; }
}
let registro = leerRegistroLocal();
let ultimaInferencia = null;

function renderizarRegistro() {
  $('nReg').textContent = registro.length;
  $('registro').innerHTML = '';
  registro.slice(-15).reverse().forEach((r) => {
    const div = document.createElement('div');
    div.textContent = `[${r.hora}] ${r.actividad.toUpperCase()} · Pers:${r.personas} · Alertas:${r.alertas} · Zona:${r.en_zona} · ${r.temp_c}°C · ${r.tag_vigia}`;
    $('registro').appendChild(div);
  });
}

$('btnGuardarRegistro').onclick = async () => {
  if (!ultimaInferencia) return;
  const hAct = new Date();
  const turnoStr = (hAct.getHours() >= 19 || hAct.getHours() < 7) ? 'Noche' : 'Día';
  const gps = await new Promise((resolve) => {
    if (!navigator.geolocation) return resolve({ lat: 'N/D', lon: 'N/D' });
    try {
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude.toFixed(5), lon: pos.coords.longitude.toFixed(5) }),
        () => resolve({ lat: 'N/D', lon: 'N/D' }),
        { timeout: 3000, maximumAge: 60000 }
      );
    } catch (e) { resolve({ lat: 'N/D', lon: 'N/D' }); }
  });
  const fila = {
    fecha: hAct.toLocaleDateString('es-PE'),
    hora: hAct.toLocaleTimeString('es-PE'),
    turno: turnoStr,
    actividad: petarActual(),
    temp_c: $('tempC').value || 'N/D',
    tag_vigia: $('tagVigia').value || 'Inspección de rutina',
    obs_voz: $('obsVoz').value || '-',
    lat: gps.lat,
    lon: gps.lon,
    ...ultimaInferencia
  };
  registro.push(fila);
  const persistido = guardarRegistroLocal();
  renderizarRegistro();
  estado(persistido ? 'Inspección guardada en el turno ✅' : 'Registro añadido, pero el almacenamiento local está lleno o no disponible.');
};

$('btnLimpiar').onclick = () => {
  if (!confirm('¿Borrar los registros acumulados de este turno?')) return;
  registro = [];
  try { localStorage.removeItem('ssoma_turno'); } catch (e) { console.warn('No se pudo limpiar el registro local.', e); }
  renderizarRegistro();
};

$('btnCopiarReporte').onclick = () => {
  if (!ultimaInferencia) return;
  const txt = `🚨 Auditoría SSOMA [${new Date().toLocaleTimeString('es-PE')}]\nFrente: ${petarActual().toUpperCase()}\nPersonas: ${ultimaInferencia.personas} | Alertas: ${ultimaInferencia.alertas} | Línea de fuego: ${ultimaInferencia.en_zona}\nTemp: ${$('tempC').value || 'N/D'} °C\nCausa: ${$('tagVigia').value || 'Por verificar'}\nObs: ${$('obsVoz').value || '-'}`;
  navigator.clipboard.writeText(txt).then(() => estado('Reporte copiado al portapapeles ✅'));
};

$('btnCsv').onclick = () => {
  if (!registro.length) { estado('Aún no hay inspecciones guardadas en el turno'); return; }
  const cab = [...new Set(registro.flatMap((r) => Object.keys(r)))];
  const csv = [cab.join(','), ...registro.map((r) => cab.map((c) => `"${String(r[c] ?? '').replace(/"/g, '""')}"`).join(','))].join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = `SSOMA_Turno_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
};

$('btnMic').onclick = () => {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return alert('El navegador no soporta dictado por voz.');
  const rec = new SR();
  rec.lang = 'es-PE';
  const btn = $('btnMic');
  const restaurar = () => { btn.style.background = 'var(--panel)'; };
  rec.onerror = (e) => {
    restaurar();
    const motivo = e.error === 'not-allowed' || e.error === 'service-not-allowed'
      ? 'Permiso de micrófono denegado.'
      : e.error === 'network' ? 'El dictado requiere conexión de red.' : `Error de dictado (${e.error || 'desconocido'}).`;
    estado(motivo);
  };
  rec.onresult = (e) => { $('obsVoz').value += ($('obsVoz').value ? ' ' : '') + e.results[0][0].transcript; };
  rec.onend = restaurar;
  try { rec.start(); btn.style.background = 'var(--danger)'; }
  catch (e) { restaurar(); estado(`No se pudo iniciar el dictado (${e.name || 'error'}).`); }
};

// ---------- Proceso Principal ----------
const snap = document.createElement('canvas');
const sctx = snap.getContext('2d');
let colaProcesamiento = Promise.resolve();
function procesar(src, W0, H0) {
  const tarea = colaProcesamiento.then(() => procesarInterno(src, W0, H0));
  colaProcesamiento = tarea.catch(() => {});
  return tarea;
}

async function procesarInterno(src, W0, H0) {
  if (!sesCoco) return;
  actualizarEtiquetasKPI();
  const k = Math.min(1, 1920 / Math.max(W0, H0));
  const W = Math.round(W0 * k), H = Math.round(H0 * k);
  if (snap.width !== W || snap.height !== H) { snap.width = W; snap.height = H; }
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

  const an = analizar(dets, lb, +$('margen').value);
  const alertas = dibujar(snap, lb, dets, an, $('verMascaras').checked);

  const n = {
    personas: an.personas.length,
    alertas,
    en_zona: an.personas.filter((p) => p.enZona).length,
    sin_casco: an.personas.filter((p) => p.sinCasco).length,
    sin_torso: an.personas.filter((p) => p.sinTorso).length,
    sin_facial: an.personas.filter((p) => p.sinFacial).length,
    sin_guantes: an.personas.filter((p) => p.sinGuantes).length,
    sin_botas: an.personas.filter((p) => p.sinBotas).length,
  };

  $('kPersonas').textContent = n.personas;
  $('kAlertas').textContent = n.alertas;
  $('kZona').textContent = n.en_zona;
  $('k_casco').textContent = n.sin_casco;
  $('k_torso').textContent = n.sin_torso;
  $('k_facial').textContent = n.sin_facial;
  $('k_guantes').textContent = n.sin_guantes;
  $('k_botas').textContent = n.sin_botas;

  if (!vivo) {
    ultimaInferencia = n;
    $('panelVigia').style.display = 'block';
  }
  return n;
}

document.querySelectorAll('input[name="petar"]').forEach((el) => {
  el.onchange = () => {
    actualizarEtiquetasKPI();
    if (ultimaImg && !vivo) procesar(ultimaImg, ultimaImg.width, ultimaImg.height);
  };
});

async function desdeArchivo(ev) {
  const f = ev.target.files[0];
  ev.target.value = '';
  if (!f) return;
  if (vivo) detenerVivo();
  if (!sesCoco) { estado('Espera a que carguen los modelos…'); return; }
  estado('Analizando frente…');
  try {
    ultimaImg = await createImageBitmap(f);
    const t0 = performance.now();
    await procesar(ultimaImg, ultimaImg.width, ultimaImg.height);
    estado(`Analizado en ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  } catch (e) {
    estado('No se pudo analizar la imagen: ' + e.message);
  }
}
$('inCamara').onchange = desdeArchivo;
$('inGaleria').onchange = desdeArchivo;

let vivo = false, stream = null, frameHandle = null, inferenciaOcupada = false;
const video = $('video');
function detenerVivo() {
  vivo = false;
  if (frameHandle !== null) {
    if (video.cancelVideoFrameCallback) video.cancelVideoFrameCallback(frameHandle);
    else if (!video.requestVideoFrameCallback) cancelAnimationFrame(frameHandle);
    frameHandle = null;
  }
  if (stream) stream.getTracks().forEach((t) => t.stop());
  stream = null;
  video.srcObject = null;
  $('btnVivo').textContent = '🎥 En vivo';
  $('btnVivo').classList.remove('activo');
}
$('btnVivo').onclick = async () => {
  if (vivo) { detenerVivo(); estado('Modo en vivo detenido'); return; }
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false,
    });
  } catch (e) {
    estado('No se pudo abrir la cámara (' + e.name + '). Usa 📷 Foto.');
    return;
  }
  try {
    video.srcObject = stream;
    await video.play();
    vivo = true;
    $('btnVivo').textContent = '⏹️ Detener';
    $('btnVivo').classList.add('activo');
    const callback = async () => {
      if (!vivo) return;
      programarFrame();
      if (inferenciaOcupada || !video.videoWidth) return;
      inferenciaOcupada = true;
      const t0 = performance.now();
      try {
        await procesar(video, video.videoWidth, video.videoHeight);
        estado(`En vivo · ${(1000 / Math.max(1, performance.now() - t0)).toFixed(1)} cuadros/s`);
      } catch (e) { estado(`Error durante el análisis: ${e.message}`); }
      finally { inferenciaOcupada = false; }
    };
    function programarFrame() {
      if (!vivo) return;
      frameHandle = video.requestVideoFrameCallback
        ? video.requestVideoFrameCallback(callback)
        : requestAnimationFrame(callback);
    }
    programarFrame();
  } catch (e) {
    detenerVivo();
    estado(`No se pudo iniciar la reproducción de cámara (${e.name || 'error'}).`);
  }
};

$('inModelo').onchange = async (ev) => {
  const f = ev.target.files[0];
  ev.target.value = '';
  if (!f) return;
  estado('Cargando modelo EPP…');
  try {
    const buf = await f.arrayBuffer();
    sesEpp = await crearSesion(new Uint8Array(buf));
    eppNC = null;
    await dbGuardar('epp', buf);
    actualizarInfo();
  } catch (e) {
    estado('Archivo no válido: ' + e.message);
  }
};
for (const id of ['conf', 'confCoco', 'margen']) {
  $(id).oninput = () => { $(id + 'V').textContent = $(id).value; };
}
$('clases').onchange = actualizarInfo;

iniciar();
