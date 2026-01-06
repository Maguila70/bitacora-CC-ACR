const API_URL = "https://script.google.com/macros/s/AKfycbzccbd9ojEI0dPlboUnip5Cv3t9WgVOHmtfdkbAnWrSvA7hShOiLuY2LVT0cLqJpa-YyA/exec";
const LS={get:(k,d=null)=>{try{const v=localStorage.getItem(k);return v==null?d:JSON.parse(v)}catch(e){return d}},
set:(k,v)=>localStorage.setItem(k,JSON.stringify(v))};
let RECORDS=LS.get("records",[]), AEROS=LS.get("aeros",[]);
function isOnline(){return navigator.onLine===true}
function updateBadge(){const dot=document.getElementById("statusDot");const txt=document.getElementById("statusText");
if(isOnline()){dot.className="dot online";txt.textContent="Online";}else{dot.className="dot offline";txt.textContent="Offline";}
document.getElementById("btnNew").disabled=!isOnline();
document.getElementById("btnNew").style.opacity=isOnline()?"1":"0.55";
}
function setLastSync(v){document.getElementById("lastSyncLine").textContent="Última sincronización: "+(v||"—");}
async function apiGet(action){const u=new URL(API_URL);u.searchParams.set("action",action);
const r=await fetch(u.toString(),{cache:"no-store"});const t=await r.text();let j;try{j=JSON.parse(t)}catch(e){throw new Error(t)}
if(!r.ok||j?.ok===false)throw new Error(j?.error||("HTTP "+r.status));return j}
async function syncAll(){if(!isOnline())return;
document.getElementById("status").textContent="Sincronizando…";
try{const d=await apiGet("all");
AEROS=(d.aerodromos||d.aeros||[]);RECORDS=(d.registros||d.records||d.items||[]);
LS.set("aeros",AEROS);LS.set("records",RECORDS);
const ts=new Date();const s=ts.toLocaleString("es-CL",{hour12:false});
LS.set("lastSync",s);setLastSync(s);render();document.getElementById("status").textContent="";}
catch(e){document.getElementById("status").textContent="Error: "+(e.message||e);}}
function ymdToDDMM(ymd){if(!ymd)return "";const m=String(ymd).match(/^(\d{4})-(\d{2})-(\d{2})$/);if(!m)return String(ymd);return `${m[3]}/${m[2]}/${m[1]}`;}
function render(){const c=document.getElementById("cards");c.innerHTML="";
if(!RECORDS.length){c.innerHTML='<div class="empty">No hay registros.</div>';return;}
for(const r of RECORDS){const f=ymdToDDMM(r.fecha||r.date||"");const o=(r.origen||"").toUpperCase();const d=(r.destino||"").toUpperCase();
const hob=r.hobbs??"";const btn=isOnline()?"Editar":"Ver";
c.insertAdjacentHTML("beforeend",`<div class="card">
<div class="line-date">${f}</div>
<div class="line2"><div class="route">${o} → ${d}</div><div class="hobbs"><b>Hobbs:</b> ${hob||"-"}</div></div>
<div style="margin-top:14px;"><button class="btn btn-edit" onclick="alert('Editor completo incluido en versión larga; avísame si tu API usa add/update específicos para reactivarlo.')">${btn}</button></div>
</div>`);}
}
document.addEventListener("DOMContentLoaded",()=>{
updateBadge();setLastSync(LS.get("lastSync",""));
render();
if(isOnline() && !RECORDS.length) syncAll();
window.addEventListener("online",()=>{updateBadge();syncAll();});
window.addEventListener("offline",updateBadge);
});
