/* Bitácora PWA (GitHub Pages) - Offline-first
 * - Primera vez online: sincroniza TODO y lo guarda en IndexedDB
 * - Offline: NO permite agregar/editar (cambia “Editar” por “Ver” y deshabilita “Nuevo Vuelo”)
 * - Online: permite agregar/editar y vuelve a sincronizar cache al guardar
 *
 * CONFIG:
 *  1) En Apps Script despliega el backend incluido en /apps-script (ver README)
 *  2) Copia la URL del deployment y pégala en API_BASE
 */

// ====================== CONFIG ======================
const API_BASE = "REEMPLAZA_CON_TU_URL_DE_APPS_SCRIPT_WEBAPP"; // ej: https://script.google.com/macros/s/XXXX/exec
const PAGE_SIZE = 20;

// ====================== KEYS (modelo) ======================
const KEYS = {
  fecha: "fecha",
  origen: "origen",
  destino: "destino",
  hobbs: "hobbs",
  landings: "landings",
  preflight_refuel: "preflight_refuel",
  fuel_ini_left: "fuel_ini_left",
  fuel_ini_right: "fuel_ini_right",
  refuel_left: "refuel_left",
  refuel_right: "refuel_right",
  fuel_fin_left: "fuel_fin_left",
  fuel_fin_right: "fuel_fin_right",
  aceite: "aceite",
  observaciones: "observaciones",
};

// ====================== UI state ======================
let AEROS = [];
let order = "desc";
let page = 0;
let hasMore = false;
let loading = false;

let activeFuelKey = null;
let activeFuelMode = "initfinal";
let stickMin = 0, stickMax = 8, stickStep = 0.1;
let stickRaw = 0;

// ====================== Helpers UI ======================
function $(id){ return document.getElementById(id); }
function showOverlay(on){ $("loadingOverlay").classList.toggle("hidden", !on); }
function setStatus(msg){
  const el = $("status");
  el.textContent = msg || "";
  el.style.display = msg ? "block" : "none";
}
function setFormError(msg){ $("formError").textContent = msg || ""; }

function isOnline(){ return navigator.onLine; }
function setOnlineBadge(){
  const badge = $("netBadge");
  const text = $("netBadgeText");
  const on = isOnline();
  badge.classList.toggle("online", on);
  badge.classList.toggle("offline", !on);
  text.textContent = on ? "Online" : "Offline";
  // Reglas pedidas:
  $("btnNew").disabled = !on;                 // “Nuevo” oscurecido offline
  $("btnSync").disabled = !on;                // sync solo online (opcional)
}
window.addEventListener("online", ()=>{ setOnlineBadge(); reiniciarLista(); });
window.addEventListener("offline", ()=>{ setOnlineBadge(); reiniciarLista(); });

// ====================== Date/format ======================
function formatDateDDMMYYYY(d){
  if (!d) return "";
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return "";
  const dd = String(dt.getDate()).padStart(2,"0");
  const mm = String(dt.getMonth()+1).padStart(2,"0");
  const yy = String(dt.getFullYear());
  return `${dd}/${mm}/${yy}`;
}
function toYMD(v){
  if (!v) return "";
  const dt = new Date(v);
  if (!isNaN(dt.getTime())) {
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2,"0");
    const d = String(dt.getDate()).padStart(2,"0");
    return `${y}-${m}-${d}`;
  }
  return "";
}
function toNumberOrNull(v){
  if (v == null) return null;
  const s = String(v).trim().replace(",", ".");
  if (!s || s === "—") return null;
  const n = Number(s);
  return isNaN(n) ? null : n;
}
function fmtInt(n){ return String(Math.round(n)); }
function round1(n){ return (Math.round(n*10)/10).toFixed(1); }

// ====================== IndexedDB (cache offline) ======================
const DB_NAME = "bitacora_pwa";
const DB_VER = 1;
const STORE_REC = "records";
const STORE_AER = "aerodromos";
const STORE_META = "meta";

function openDB(){
  return new Promise((resolve, reject)=>{
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = (e)=>{
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_REC)) db.createObjectStore(STORE_REC, { keyPath: "rowIndex" });
      if (!db.objectStoreNames.contains(STORE_AER)) db.createObjectStore(STORE_AER, { keyPath: "code" });
      if (!db.objectStoreNames.contains(STORE_META)) db.createObjectStore(STORE_META, { keyPath: "key" });
    };
    req.onsuccess = ()=>resolve(req.result);
    req.onerror = ()=>reject(req.error);
  });
}
async function dbPutMany(storeName, items){
  const db = await openDB();
  return new Promise((resolve, reject)=>{
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    items.forEach(it => store.put(it));
    tx.oncomplete = ()=>resolve(true);
    tx.onerror = ()=>reject(tx.error);
  });
}
async function dbClear(storeName){
  const db = await openDB();
  return new Promise((resolve, reject)=>{
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).clear();
    tx.oncomplete = ()=>resolve(true);
    tx.onerror = ()=>reject(tx.error);
  });
}
async function dbGetAll(storeName){
  const db = await openDB();
  return new Promise((resolve, reject)=>{
    const tx = db.transaction(storeName, "readonly");
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = ()=>resolve(req.result || []);
    req.onerror = ()=>reject(req.error);
  });
}
async function dbGet(storeName, key){
  const db = await openDB();
  return new Promise((resolve, reject)=>{
    const tx = db.transaction(storeName, "readonly");
    const req = tx.objectStore(storeName).get(key);
    req.onsuccess = ()=>resolve(req.result || null);
    req.onerror = ()=>reject(req.error);
  });
}
async function dbSetMeta(key, value){
  return dbPutMany(STORE_META, [{ key, value }]);
}
async function dbGetMeta(key){
  const r = await dbGet(STORE_META, key);
  return r ? r.value : null;
}

// ====================== Backend API ======================
async function apiGet(params){
  if (!API_BASE || API_BASE.includes("REEMPLAZA_")) throw new Error("Configura API_BASE en app.js");
  const url = new URL(API_BASE);
  Object.entries(params || {}).forEach(([k,v])=> url.searchParams.set(k, String(v)));
  const res = await fetch(url.toString(), { method:"GET", cache:"no-store" });
  if (!res.ok) throw new Error("HTTP " + res.status);
  return res.json();
}
async function apiPost(action, payload){
  if (!API_BASE || API_BASE.includes("REEMPLAZA_")) throw new Error("Configura API_BASE en app.js");
  const url = new URL(API_BASE);
  url.searchParams.set("action", action);
  const res = await fetch(url.toString(), {
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body: JSON.stringify(payload || {})
  });
  if (!res.ok) throw new Error("HTTP " + res.status);
  return res.json();
}

// ====================== Sync (first run + manual) ======================
async function syncAll(){
  if (!isOnline()) return;
  showOverlay(true);
  try{
    setStatus("Sincronizando…");
    const data = await apiGet({ action:"all" }); // {records:[], aerodromos:[]}
    const records = (data.records || []).map(r => normalizeRecord(r));
    const aeros = (data.aerodromos || []).map(a => ({ code:String(a.code||"").toUpperCase(), name:String(a.name||"") }));

    await dbClear(STORE_REC);
    await dbPutMany(STORE_REC, records);

    await dbClear(STORE_AER);
    await dbPutMany(STORE_AER, aeros);

    await dbSetMeta("lastSync", Date.now());

    AEROS = aeros;
    page = 0;
    $("cards").innerHTML = "";
    await cargarPagina();
    setStatus("");
  } catch(err){
    console.error(err);
    setStatus("Error al sincronizar:\n" + (err && err.message ? err.message : err));
  } finally{
    showOverlay(false);
  }
}

// ====================== Data model helpers ======================
function normalizeRecord(r){
  // asegura tipos razonables
  const o = { ...r };
  if (o.rowIndex != null) o.rowIndex = Number(o.rowIndex);
  // fecha la guardamos como ISO yyyy-mm-dd para consistencia (en cache)
  if (o.fecha) {
    const dt = new Date(o.fecha);
    if (!isNaN(dt.getTime())) o.fecha = dt.toISOString().slice(0,10);
  }
  // upper ICAO
  if (o.origen) o.origen = String(o.origen).toUpperCase();
  if (o.destino) o.destino = String(o.destino).toUpperCase();
  return o;
}

function sortRecordsByDateAsc(records){
  return records.slice().sort((a,b)=>{
    const ta = a.fecha ? new Date(a.fecha).getTime() : 0;
    const tb = b.fecha ? new Date(b.fecha).getTime() : 0;
    if (ta === tb) return (a.rowIndex||0) - (b.rowIndex||0);
    return ta - tb;
  });
}

function computeFlightTimes(records){
  // Asume records asc por fecha
  let lastH = null;
  const out = [];
  for (const r of records){
    const hobbs = toNumberOrNull(r.hobbs);
    const prev = lastH;
    const tf = (hobbs != null && prev != null) ? (hobbs - prev) : null;
    out.push({
      ...r,
      _prevHobbs: prev,
      _tf: (tf != null && tf >= 0) ? tf : null
    });
    if (hobbs != null) lastH = hobbs;
  }
  return out;
}

// ====================== List/Paging (offline from cache) ======================
async function reiniciarLista(){
  page = 0;
  hasMore = false;
  $("cards").innerHTML = "";
  actualizarTextoBotonOrden();
  await cargarPagina();
}

function actualizarTextoBotonOrden(){
  const btn = $("btnSort");
  btn.textContent = (order === "desc") ? "Más antiguos primero" : "Más recientes primero";
}
function toggleOrden(){
  order = (order === "desc") ? "asc" : "desc";
  actualizarTextoBotonOrden();
  reiniciarLista();
}

async function cargarPagina(){
  if (loading) return;
  loading = true;
  setStatus(page === 0 ? "Cargando registros…" : "Cargando más…");
  try{
    const all = await dbGetAll(STORE_REC);
    if (!all.length && isOnline()){
      // primera vez (sin cache): auto sync
      await syncAll();
      return;
    }

    let recsAsc = computeFlightTimes(sortRecordsByDateAsc(all));
    let recs = recsAsc.slice();
    if (order === "desc") recs.reverse();

    const start = page * PAGE_SIZE;
    const end = start + PAGE_SIZE;
    const slice = recs.slice(start, end);

    renderAppend(slice.map(r => ({
      rowIndex: r.rowIndex,
      fecha: formatDateDDMMYYYY(r.fecha),
      origen: r.origen || "",
      destino: r.destino || "",
      hobbs: (toNumberOrNull(r.hobbs) != null) ? round1(toNumberOrNull(r.hobbs)) : "",
      tiempo_vuelo: (r._tf != null) ? round1(r._tf) : ""
    })));

    hasMore = end < recs.length;
    $("moreWrap").classList.toggle("hidden", !hasMore);
    setStatus("");
  } catch(err){
    console.error(err);
    setStatus("Error cargando:\n" + (err && err.message ? err.message : err));
  } finally{
    loading = false;
  }
}
function cargarMas(){ if (!hasMore) return; page += 1; cargarPagina(); }

function renderAppend(items){
  const cont = $("cards");
  if ((!items || items.length === 0) && cont.innerHTML === "") {
    cont.innerHTML = '<div class="empty">No hay registros.</div>';
    return;
  }
  for (const r of items){
    const canEdit = isOnline();
    const label = canEdit ? "Editar" : "Ver";
    cont.innerHTML +=
      '<div class="card">' +
        '<div class="line-date">' + (r.fecha || "") + '</div>' +
        '<div class="line2">' +
          '<div class="route">' + (r.origen || "") + ' → ' + (r.destino || "") + '</div>' +
          '<div class="hobbs"><b>Hobbs:</b> ' + (r.hobbs || "-") + '</div>' +
        '</div>' +
        '<div class="tf"><b>Tiempo de vuelo:</b> ' + (r.tiempo_vuelo || "-") + '</div>' +
        '<div style="margin-top:14px;">' +
          '<button class="btn btn-edit" onclick="editar(' + r.rowIndex + ')">' + label + '</button>' +
        '</div>' +
      '</div>';
  }
}

// ====================== Views ======================
function showList(){
  closeAddAeroModal();
  closeViewAeroModal();
  $("editView").classList.add("hidden");
  $("listView").classList.remove("hidden");
  $("footer").style.display = "block";
}
function showEdit(){
  closeAddAeroModal();
  closeViewAeroModal();
  $("listView").classList.add("hidden");
  $("editView").classList.remove("hidden");
  $("footer").style.display = "none";
}

// ====================== Landings ======================
function getLandings(){
  const v = ($("landings").value || "").trim();
  const n = parseInt(v,10);
  return isNaN(n) ? 1 : n;
}
function setLandings(n){
  n = parseInt(n,10);
  if (isNaN(n)) n = 1;
  if (n < 0) n = 0;
  $("landings").value = String(n);
}
function incLandings(){ setLandings(getLandings()+1); }
function decLandings(){ setLandings(getLandings()-1); }

// ====================== Oil bar ======================
function oilLabelFromNorm(norm){
  const n = Number(norm);
  if (!isFinite(n)) return "";
  if (Math.abs(n - 0) < 1e-9) return "0";
  if (Math.abs(n - 0.25) < 1e-9) return "1/4";
  if (Math.abs(n - 0.5) < 1e-9) return "1/2";
  if (Math.abs(n - 0.75) < 1e-9) return "3/4";
  if (Math.abs(n - 1) < 1e-9) return "Full";
  return String(n);
}
function normFromAnyOilValue(v){
  if (v == null || v === "") return "";
  if (typeof v === "number") return v;
  const s = String(v).trim();
  if (!s) return "";
  const n = Number(s.replace(",", "."));
  if (!isNaN(n)) return n;
  const u = s.toLowerCase();
  if (u === "full") return 1;
  if (u === "0") return 0;
  if (u === "1/4" || u === "¼") return 0.25;
  if (u === "1/2" || u === "½") return 0.5;
  if (u === "3/4" || u === "¾") return 0.75;
  return "";
}
function setOilBarNorm(norm){
  if (norm === "" || norm == null) {
    $(KEYS.aceite).value = "";
    document.querySelectorAll(".oilSeg").forEach(seg => seg.classList.remove("active"));
    $("oilHint").textContent = "Selecciona un nivel.";
    return;
  }
  let n = Number(norm);
  if (!isFinite(n)) return;
  n = Math.max(0, Math.min(1, n));
  $(KEYS.aceite).value = String(n);

  document.querySelectorAll(".oilSeg").forEach(seg => {
    const sn = Number(seg.getAttribute("data-norm"));
    seg.classList.toggle("active", Math.abs(sn - n) < 1e-9);
  });
  $("oilHint").textContent = "Seleccionado: " + oilLabelFromNorm(n);
}

// ====================== Fuel stick ======================
function calcInitFinalLiters(rawVal){
  const v = Number(rawVal);
  if (!isFinite(v)) return 0;
  if (Math.abs(v) < 1e-9) return 0;
  const liters = (v * 4.54) + 4.1;
  return Math.round(liters);
}
function setFuelDisplay(id, val){
  const el = $(id);
  if (val === "" || val == null || val === "—") {
    el.value = "—";
    el.classList.add("placeholder");
  } else {
    el.value = String(val);
    el.classList.remove("placeholder");
  }
}
function clearFuelActive(){
  ["fuel_ini_left","fuel_ini_right","refuel_left","refuel_right","fuel_fin_left","fuel_fin_right"]
    .forEach(id => $(id)?.classList.remove("active"));
}
function renderScaleLabels(){
  const layer = $("scaleLayer");
  layer.innerHTML = "";
  const labels = (activeFuelMode === "refuel") ? [40, 30, 20, 10, 0] : [8,7,6,5,4,3,2,1,0];
  labels.forEach(x=>{
    const div = document.createElement("div");
    div.textContent = x;
    layer.appendChild(div);
  });
}
function setStickTitleForMode(mode){
  $("stickTitle").textContent = (mode === "refuel") ? "Cantidad" : "Stick";
}
function setStickMode(mode){
  activeFuelMode = mode;
  setStickTitleForMode(mode);
  if (mode === "refuel") { stickMin=0; stickMax=40; stickStep=1; }
  else { stickMin=0; stickMax=8; stickStep=0.1; }
  renderScaleLabels();
}
function clamp(v,min,max){ return Math.max(min, Math.min(max, v)); }
function roundToStep(v, step){
  const r = Math.round(v/step)*step;
  return parseFloat(r.toFixed(step < 1 ? 1 : 0));
}
function setKnobByPercent(p){
  p = clamp(p,0,1);
  const topPct = 10 + (80 * (1 - p));
  $("stickKnob").style.top = topPct + "%";
}
function formatStickRaw(raw){
  if (activeFuelMode === "refuel") return String(raw);
  return Number(raw).toFixed(1);
}
function updateStickValueDisplay(rawVal){
  $("stickValue").textContent = formatStickRaw(rawVal);
}
function writeActiveFieldFromRaw(rawVal){
  if (!activeFuelKey) return;
  updateStickValueDisplay(rawVal);
  if (activeFuelMode === "refuel") setFuelDisplay(activeFuelKey, fmtInt(rawVal));
  else setFuelDisplay(activeFuelKey, fmtInt(calcInitFinalLiters(rawVal)));
  updateFuelUsed();
}
function selectFuel(fieldId, mode){
  if (!isOnline() && $("editCard").classList.contains("readonly")) return;
  clearFuelActive();
  $(fieldId).classList.add("active");
  activeFuelKey = fieldId;
  setStickMode(mode);

  const existing = $(fieldId).value;
  if (existing && existing !== "—") {
    const n = toNumberOrNull(existing);
    if (n != null) {
      if (mode === "refuel") stickRaw = clamp(roundToStep(n, stickStep), stickMin, stickMax);
      else {
        let raw = 0;
        if (n > 0) raw = (n - 4.1) / 4.54;
        stickRaw = clamp(roundToStep(raw, stickStep), stickMin, stickMax);
      }
      const p = (stickRaw - stickMin) / (stickMax - stickMin || 1);
      setKnobByPercent(p);
      updateStickValueDisplay(stickRaw);
      return;
    }
  }
  stickRaw = stickMin;
  setKnobByPercent(0.5);
  $("stickValue").textContent = "—";
}

function setFromPointer(clientY){
  const box = $("stickBox");
  const rect = box.getBoundingClientRect();
  const y = clamp(clientY - rect.top, 0, rect.height);
  const p = 1 - (y / rect.height);
  let raw = stickMin + p * (stickMax - stickMin);
  raw = clamp(roundToStep(raw, stickStep), stickMin, stickMax);
  stickRaw = raw;

  const p2 = (stickRaw - stickMin) / (stickMax - stickMin || 1);
  setKnobByPercent(p2);
  writeActiveFieldFromRaw(stickRaw);
}

(function initStickDrag(){
  const box = $("stickBox");
  box.addEventListener("pointerdown", function(e){
    if ($("editCard").classList.contains("readonly")) return;
    if (!activeFuelKey) selectFuel(KEYS.fuel_ini_left, "initfinal");
    box.setPointerCapture(e.pointerId);
    setFromPointer(e.clientY);
  });
  box.addEventListener("pointermove", function(e){
    if ($("editCard").classList.contains("readonly")) return;
    if (box.hasPointerCapture && box.hasPointerCapture(e.pointerId)) setFromPointer(e.clientY);
  });
  box.addEventListener("pointerup", function(e){
    try{ box.releasePointerCapture(e.pointerId); }catch(_){}
  });
})();

function updateFuelUsed(){
  const iniL = toNumberOrNull($(KEYS.fuel_ini_left).value);
  const iniR = toNumberOrNull($(KEYS.fuel_ini_right).value);
  const finL = toNumberOrNull($(KEYS.fuel_fin_left).value);
  const finR = toNumberOrNull($(KEYS.fuel_fin_right).value);

  const show = (iniL != null && iniR != null && finL != null && finR != null);
  const wrap = $("fuelUsedWrap");
  if (!show){ wrap.classList.add("hidden"); return; }

  const useRefuel = $(KEYS.preflight_refuel).checked;
  const refL = useRefuel ? (toNumberOrNull($(KEYS.refuel_left).value) || 0) : 0;
  const refR = useRefuel ? (toNumberOrNull($(KEYS.refuel_right).value) || 0) : 0;

  let used = (iniL + iniR + refL + refR) - (finL + finR);
  if (used < 0) used = 0;

  $("fuelUsedVal").textContent = fmtInt(used) + " L";
  wrap.classList.remove("hidden");
}

// ====================== Aeródromos UI ======================
function ddEl(field){ return $("dd_" + field); }
function closeAllDropdowns(){
  ddEl("origen").classList.add("hidden");
  ddEl("destino").classList.add("hidden");
}
function aeroOpen(field){
  const v = ($(field).value || "");
  renderAeroDropdown(field, v);
}
function aeroInputChanged(field){
  renderAeroDropdown(field, $(field).value || "");
}
function renderAeroDropdown(field, q){
  closeAllDropdowns();
  const dd = ddEl(field);
  const query = String(q || "").trim().toUpperCase();
  if (!query) { dd.innerHTML = ""; dd.classList.add("hidden"); return; }

  let items = AEROS;
  items = items.filter(a => a.code.includes(query) || (a.name||"").toUpperCase().includes(query)).slice(0, 40);

  if (!items.length) {
    dd.innerHTML = '<div class="ddItem"><div><span class="ddCode">Sin resultados</span><div class="ddName">Usa + para agregar.</div></div></div>';
    dd.classList.remove("hidden");
    return;
  }
  dd.innerHTML = items.map(a => `
    <div class="ddItem" onclick="aeroSelect('${field}', '${escapeQuotes(a.code)}')">
      <div>
        <div class="ddCode">${escapeHtml(a.code)}</div>
        <div class="ddName">${escapeHtml(a.name || "")}</div>
      </div>
      <div style="color:#999; font-weight:900;">›</div>
    </div>
  `).join("");
  dd.classList.remove("hidden");
}
function aeroSelect(field, code){
  $(field).value = String(code || "").toUpperCase();
  closeAllDropdowns();
}
function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, m => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;" }[m]));
}
function escapeQuotes(s){ return String(s).replace(/'/g, "\\'"); }
document.addEventListener("click", function(e){
  const t = e.target;
  if (!t.closest || !t.closest(".aeroWrap")) closeAllDropdowns();
});

// ====================== Aeródromos: agregar/ver ======================
let addAeroTargetField = null;

function openAddAeroModal(targetField){
  if (!isOnline()) return;
  addAeroTargetField = targetField;
  $("addAeroErr").textContent = "";
  $("newAeroCode").value = ($(targetField).value || "").trim().toUpperCase();
  $("newAeroName").value = "";
  $("addAeroModal").classList.remove("hidden");
  setTimeout(()=> $("newAeroName").focus(), 50);
}
function closeAddAeroModal(){ $("addAeroModal").classList.add("hidden"); }
function closeAddAeroIfBackdrop(e){ if (e.target && e.target.id === "addAeroModal") closeAddAeroModal(); }

async function confirmAddAero(){
  if (!isOnline()) return;
  const code = ($("newAeroCode").value || "").trim().toUpperCase();
  const name = ($("newAeroName").value || "").trim();
  $("addAeroErr").textContent = "";
  if (!code) { $("addAeroErr").textContent = "Código es obligatorio."; return; }
  if (!name) { $("addAeroErr").textContent = "Nombre es obligatorio."; return; }

  showOverlay(true);
  try{
    await apiPost("addAerodromo", { code, name });
    await syncAerodromosOnly();
    closeAddAeroModal();
    if (addAeroTargetField) { $(addAeroTargetField).value = code; addAeroTargetField = null; }
  } catch(err){
    $("addAeroErr").textContent = (err && err.message) ? err.message : String(err);
  } finally{
    showOverlay(false);
  }
}

function closeViewAeroModal(){ $("viewAeroModal").classList.add("hidden"); }
function closeViewAeroIfBackdrop(e){ if (e.target && e.target.id === "viewAeroModal") closeViewAeroModal(); }

async function openViewAero(field){
  const code = ($(field).value || "").trim().toUpperCase();
  if (!code) { alert("Ingresa o selecciona un código primero."); return; }

  showOverlay(true);
  try{
    let res = null;
    if (isOnline()){
      res = await apiGet({ action:"aeroDetail", code });
    } else {
      // offline: buscamos en cache simple (solo code+name)
      const a = AEROS.find(x => x.code === code);
      if (a) {
        res = { found:true, code, fields:[ {label:"Código", value:code}, {label:"Nombre", value:a.name||""} ] };
      } else {
        res = { found:false, code };
      }
    }

    if (!res || !res.found) { alert("No encontrado en Aeródromos: " + code); return; }

    $("viewAeroTitle").textContent = "Aeródromo " + code;
    $("viewAeroBody").innerHTML = (res.fields || []).map(f => `
      <div class="kv">
        <b>${escapeHtml(f.label || "")}</b>
        <div>${escapeHtml(f.value || "")}</div>
      </div>
    `).join("");
    $("viewAeroModal").classList.remove("hidden");
  } catch(err){
    alert("Error: " + ((err && err.message) ? err.message : err));
  } finally{
    showOverlay(false);
  }
}

async function syncAerodromosOnly(){
  const list = await apiGet({ action:"aerodromos" });
  AEROS = (list.aerodromos || []).map(a => ({ code:String(a.code||"").toUpperCase(), name:String(a.name||"") }));
  await dbClear(STORE_AER);
  await dbPutMany(STORE_AER, AEROS);
}

// ====================== Edit form ======================
function resetEditUI(){
  closeAllDropdowns();
  setFormError("");

  ["fecha","origen","destino","hobbs","observaciones"].forEach(id => { if ($(id)) $(id).value = ""; });
  $(KEYS.preflight_refuel).checked = false;

  setFuelDisplay(KEYS.fuel_ini_left, "—");
  setFuelDisplay(KEYS.fuel_ini_right, "—");
  setFuelDisplay(KEYS.refuel_left, "—");
  setFuelDisplay(KEYS.refuel_right, "—");
  setFuelDisplay(KEYS.fuel_fin_left, "—");
  setFuelDisplay(KEYS.fuel_fin_right, "—");
  $("fuelUsedWrap").classList.add("hidden");

  setOilBarNorm("");
  setLandings(1);

  clearFuelActive();
  activeFuelKey = null;
  setStickMode("initfinal");
  setKnobByPercent(0.5);
  $("stickValue").textContent = "—";

  // editable by default
  setReadonlyMode(false);
}

function setReadonlyMode(on){
  $("editCard").classList.toggle("readonly", !!on);

  // inputs
  ["fecha","origen","destino","hobbs"].forEach(id => { if ($(id)) $(id).readOnly = !!on; });
  $("observaciones").readOnly = !!on;

  // checkbox
  $(KEYS.preflight_refuel).disabled = !!on;

  // landings + aero add buttons
  $("btnLandDec").disabled = !!on;
  $("btnLandInc").disabled = !!on;
  $("btnAddOrigen").disabled = !!on;
  $("btnAddDestino").disabled = !!on;

  // save button
  $("saveBtn").classList.toggle("hidden", !!on);
}

function fillEditFromObj(o){
  $(KEYS.fecha).value = toYMD(o[KEYS.fecha] || o.fecha);
  $(KEYS.origen).value = (o[KEYS.origen] || "").toString().toUpperCase();
  $(KEYS.destino).value = (o[KEYS.destino] || "").toString().toUpperCase();
  $(KEYS.hobbs).value = (o[KEYS.hobbs] ?? "").toString().replace(",", ".");

  const land = o[KEYS.landings];
  let landNum = (typeof land === "number") ? land : parseInt(String(land || ""), 10);
  if (isNaN(landNum)) landNum = 1;
  setLandings(landNum);

  $(KEYS.preflight_refuel).checked = (o[KEYS.preflight_refuel] === true || String(o[KEYS.preflight_refuel]).toUpperCase() === "TRUE");

  setFuelDisplay(KEYS.fuel_ini_left,  o[KEYS.fuel_ini_left]  ?? "—");
  setFuelDisplay(KEYS.fuel_ini_right, o[KEYS.fuel_ini_right] ?? "—");
  setFuelDisplay(KEYS.refuel_left,    o[KEYS.refuel_left]    ?? "—");
  setFuelDisplay(KEYS.refuel_right,   o[KEYS.refuel_right]   ?? "—");
  setFuelDisplay(KEYS.fuel_fin_left,  o[KEYS.fuel_fin_left]  ?? "—");
  setFuelDisplay(KEYS.fuel_fin_right, o[KEYS.fuel_fin_right] ?? "—");

  const norm = normFromAnyOilValue(o[KEYS.aceite]);
  setOilBarNorm(norm === "" ? "" : norm);

  $(KEYS.observaciones).value = o[KEYS.observaciones] || "";

  updateFuelUsed();

  // editar: foco inicial en Fecha (pedido original)
  clearFuelActive();
  activeFuelKey = null;
  setStickMode("initfinal");
  setKnobByPercent(0.5);
  $("stickValue").textContent = "—";
}

async function editar(rowIndex){
  resetEditUI();
  $("mode").value = "edit";
  $("rowIndex").value = String(rowIndex);
  $("title").textContent = isOnline() ? "Editar Registro de Vuelo" : "Ver Registro de Vuelo";
  $("saveBtn").textContent = "Guardar";
  showEdit();

  showOverlay(true);
  try{
    // offline: del cache
    const rec = await dbGet(STORE_REC, Number(rowIndex));
    if (!rec) throw new Error("No encontrado en cache (sync requerido).");
    fillEditFromObj(rec);

    // offline => readonly
    setReadonlyMode(!isOnline());

    setTimeout(()=>{ try{ $(KEYS.fecha).focus(); }catch(_){} }, 50);
  } catch(err){
    setFormError("Error cargando registro:\n" + (err && err.message ? err.message : err));
  } finally{
    showOverlay(false);
  }
}

function nuevo(){
  if (!isOnline()) return;
  resetEditUI();
  $("mode").value = "new";
  $("rowIndex").value = "";
  $("title").textContent = "Nuevo Vuelo";
  $("saveBtn").textContent = "Agregar";
  showEdit();
  setLandings(1);
  selectFuel(KEYS.fuel_ini_left, "initfinal");
  setTimeout(()=>{ try{ $(KEYS.fecha).focus(); }catch(_){} }, 50);
}

async function guardar(){
  if (!isOnline()) return;
  setFormError("");

  const mode = $("mode").value;
  const rowIndex = Number($("rowIndex").value);

  const fechaYmd = $(KEYS.fecha).value;
  if (!fechaYmd) { setFormError("Fecha es obligatoria."); return; }

  const origen = $(KEYS.origen).value.trim().toUpperCase();
  const destino = $(KEYS.destino).value.trim().toUpperCase();
  if (!origen) { setFormError("Origen es obligatorio."); return; }
  if (!destino) { setFormError("Destino es obligatorio."); return; }

  function valFuel(id){
    const v = $(id).value;
    if (!v || v === "—") return "";
    return String(v).trim().replace(",", ".");
  }

  const data = {};
  data[KEYS.fecha] = fechaYmd;
  data[KEYS.origen] = origen;
  data[KEYS.destino] = destino;
  data[KEYS.hobbs] = String($(KEYS.hobbs).value || "").trim().replace(",", ".");
  data[KEYS.landings] = String(getLandings());
  data[KEYS.preflight_refuel] = $(KEYS.preflight_refuel).checked;

  data[KEYS.fuel_ini_left] = valFuel(KEYS.fuel_ini_left);
  data[KEYS.fuel_ini_right] = valFuel(KEYS.fuel_ini_right);
  data[KEYS.refuel_left] = valFuel(KEYS.refuel_left);
  data[KEYS.refuel_right] = valFuel(KEYS.refuel_right);
  data[KEYS.fuel_fin_left] = valFuel(KEYS.fuel_fin_left);
  data[KEYS.fuel_fin_right] = valFuel(KEYS.fuel_fin_right);

  data[KEYS.aceite] = String($(KEYS.aceite).value || "").trim().replace(",", ".");
  data[KEYS.observaciones] = String($(KEYS.observaciones).value || "").trim();

  showOverlay(true);
  try{
    if (mode === "new") {
      const res = await apiPost("add", { data });
      // refrescar cache desde server en background (pero inmediato para consistencia)
      await syncAll();
    } else {
      await apiPost("save", { rowIndex, data });
      await syncAll();
    }
    volver();
  } catch(err){
    setFormError("Error al guardar:\n" + (err && err.message ? err.message : err));
  } finally{
    showOverlay(false);
  }
}

function volver(){ showList(); reiniciarLista(); }
function exportar(){ alert("Exportar (pendiente)"); }

// ====================== Startup ======================
async function initFromCache(){
  // cache aeros
  try{ AEROS = await dbGetAll(STORE_AER); } catch(_){ AEROS = []; }
  // si no hay cache y estamos online => sync
  const recs = await dbGetAll(STORE_REC);
  if (!recs.length && isOnline()){
    await syncAll();
  }
}

document.addEventListener("keydown", function(e){
  if (e.key === "Escape") {
    closeAddAeroModal();
    closeViewAeroModal();
    closeAllDropdowns();
  }
});

// expose some functions to inline onclick
window.toggleOrden = toggleOrden;
window.cargarMas = cargarMas;
window.editar = editar;
window.nuevo = nuevo;
window.guardar = guardar;
window.volver = volver;
window.exportar = exportar;

window.aeroOpen = aeroOpen;
window.aeroInputChanged = aeroInputChanged;
window.aeroSelect = aeroSelect;

window.openAddAeroModal = openAddAeroModal;
window.closeAddAeroModal = closeAddAeroModal;
window.closeAddAeroIfBackdrop = closeAddAeroIfBackdrop;
window.confirmAddAero = confirmAddAero;

window.openViewAero = openViewAero;
window.closeViewAeroModal = closeViewAeroModal;
window.closeViewAeroIfBackdrop = closeViewAeroIfBackdrop;

window.selectFuel = selectFuel;
window.incLandings = incLandings;
window.decLandings = decLandings;
window.setOilBarNorm = setOilBarNorm;

window.syncAll = syncAll;

(async function boot(){
  setOnlineBadge();

  // SW
  if ("serviceWorker" in navigator) {
    try{ await navigator.serviceWorker.register("sw.js"); } catch(e){ console.warn("SW fail", e); }
  }

  showList();
  actualizarTextoBotonOrden();

  await initFromCache();
  await reiniciarLista();

  // defaults
  setOilBarNorm("");
  setLandings(1);
})();
