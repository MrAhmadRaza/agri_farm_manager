/* ============================================================
   Dava C — Hydroponics Control
   Application logic (structure, state, rendering, persistence)
   ============================================================ */
(function(){

/* ============================================================
   0. STORAGE
   ============================================================ */
/* Bumped to v2: earlier versions seeded pillars with demo/placeholder
   plants and devices. Any v1 data left in a browser is intentionally
   ignored so nobody keeps seeing leftover placeholder data — v2 starts
   every pillar with nothing until configuration or the user adds it. */
const STORAGE_KEY = "davaC.hydroponics.data.v2";

function persist(){
  try{
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      config: CONFIG,
      greenHouses: STATE.greenHouses,
      currentGhId: STATE.currentGhId
    }));
  }catch(err){
    console.warn("Dava C: could not save data to browser storage.", err);
  }
}

function loadPersisted(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(!raw) return null;
    const data = JSON.parse(raw);
    if(!data || !data.config || !Array.isArray(data.greenHouses) || !data.greenHouses.length) return null;
    return data;
  }catch(err){
    console.warn("Dava C: could not read saved data from browser storage.", err);
    return null;
  }
}

/* ============================================================
   1. DEFAULT CONFIG
   ------------------------------------------------------------
   Each green house owns its OWN structure (section count, line
   counts, pillars per line) and its own plant defaults — nothing
   here is a single global rule shared by every green house.
   ============================================================ */
const DEFAULT_PLANT_TYPES = ["Tomato", "Lettuce","Basil","Spinach","Kale","Strawberry","Mint"];

/* No plant, no device install, no override — nothing here assigns
   anything to a single pillar. This is only the catalog of green
   houses and their structure (how many sections/lines/pillars exist).
   A pillar gets a plant or a device only if: (a) you set a default
   plant on its green house/section/line in Config, (b) you list its
   exact section/line/pillar under that green house's
   deviceInstallations in Config, or (c) you add it by hand from the
   pillar's own panel in the UI. Nothing is ever placed by the code
   itself as a placeholder or demo value. */
function makeDefaultGreenHouses(count){
  const list = [];
  for(let g=1; g<=count; g++){
    list.push({
      id: "gh"+g,
      name: "Green House "+g,
      plantType: null,
      structure: {
        sectionCount: 19,
        lineCountFirstSection: 6,
        lineCountOtherSections: 5,
        pillarsPerLine: 7
      },
      plantOverrides: { sections: {}, lines: {} },
      deviceInstallations: []
    });
  }
  return list;
}

const DEFAULT_CONFIG = {
  project: { name: "Dava C" },
  greenHouses: makeDefaultGreenHouses(8),
  severityLevels: [
    { key: "Healthy", color: "var(--sev-healthy)" },
    { key: "Low", color: "var(--sev-low)" },
    { key: "Medium", color: "var(--sev-medium)" },
    { key: "High", color: "var(--sev-high)" }
  ],
  diseases: [
    { id: "root-rot", name: "Root Rot" },
    { id: "powdery-mildew", name: "Powdery Mildew" },
    { id: "aphid", name: "Aphid Infestation" },
    { id: "nutrient-burn", name: "Nutrient Burn" },
    { id: "algae-bloom", name: "Algae Bloom" }
  ],
  deviceTypes: [
    { id: "ph", name: "pH Sensor", unit: "pH" },
    { id: "ec", name: "EC Sensor", unit: "mS/cm" },
    { id: "pump", name: "Water Pump", unit: "L/min" },
    { id: "light", name: "Grow Light", unit: "hrs/day" },
    { id: "cam", name: "Camera", unit: "" }
  ],
  plantTypes: DEFAULT_PLANT_TYPES
};

/* ============================================================
   2. STATE
   ============================================================ */
let CONFIG = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
let STATE = {
  greenHouses: [],
  currentGhId: null,
  currentView: "map",
  selectedPillarId: null,
  selectedSectionId: null,
  modalType: null // "pillar" | "section" | null
};

function severityIndex(key){ return CONFIG.severityLevels.findIndex(s=>s.key===key); }
function severityColor(key){
  const s = CONFIG.severityLevels.find(s=>s.key===key);
  return s ? s.color : "var(--sev-healthy)";
}
function deviceType(id){ return CONFIG.deviceTypes.find(d=>d.id===id); }
function diseaseName(id){ const d = CONFIG.diseases.find(d=>d.id===id); return d ? d.name : id; }

/* Effective (inherited) plant type for a section/line, given the
   greenhouse → section → line override hierarchy. Returns "" when
   nothing is configured at any level. */
function effectiveSectionPlant(gh, sectionNumber){
  return (gh.plantOverrides.sections[sectionNumber]) || gh.plantType || "";
}
function effectiveLinePlant(gh, sectionNumber, lineNumber){
  const key = sectionNumber+"-"+lineNumber;
  return gh.plantOverrides.lines[key] || effectiveSectionPlant(gh, sectionNumber) || "";
}

/* ============================================================
   3. STRUCTURE GENERATION (per green house, from CONFIG)
   ============================================================ */
function buildStructure(){
  const list = Array.isArray(CONFIG.greenHouses) ? CONFIG.greenHouses : [];
  return list.map(ghCfg=>{
    const st = ghCfg.structure || {};
    const sectionCount = Math.max(1, parseInt(st.sectionCount, 10) || 1);
    const lineCountFirst = Math.max(1, parseInt(st.lineCountFirstSection, 10) || parseInt(st.lineCountOtherSections, 10) || 1);
    const lineCountOther = Math.max(1, parseInt(st.lineCountOtherSections, 10) || lineCountFirst);
    const pillarsPerLine = Math.max(1, parseInt(st.pillarsPerLine, 10) || 1);

    const gh = {
      id: ghCfg.id,
      name: ghCfg.name || ghCfg.id,
      plantType: ghCfg.plantType || null,
      plantOverrides: {
        sections: Object.assign({}, ghCfg.plantOverrides && ghCfg.plantOverrides.sections),
        lines: Object.assign({}, ghCfg.plantOverrides && ghCfg.plantOverrides.lines)
      },
      sections: []
    };

    for(let s=1; s<=sectionCount; s++){
      const lineCount = (s===1) ? lineCountFirst : lineCountOther;
      const section = { id: gh.id+"-s"+s, number: s, lines: [] };
      for(let l=1; l<=lineCount; l++){
        const line = { id: section.id+"-l"+l, number: l, pillars: [] };
        for(let p=1; p<=pillarsPerLine; p++){
          line.pillars.push({
            id: line.id+"-p"+p,
            number: p,
            plant: null,
            plantManual: false,
            devices: [],
            diseaseRecords: [],
            deviceReadings: []
          });
        }
        section.lines.push(line);
      }
      gh.sections.push(section);
    }
    return gh;
  });
}

/* Recomputes every pillar's plant from the current green house →
   section → line hierarchy, live — no rebuild or "regenerate" step
   needed. A pillar the user has explicitly planted or explicitly
   cleared by hand (plantManual = true) is left alone; every other
   pillar always mirrors whatever the hierarchy currently resolves to,
   including right after you change a default in the UI. */
function refreshDefaultPlants(gh){
  gh.sections.forEach(sec=>{
    sec.lines.forEach(line=>{
      line.pillars.forEach(p=>{
        if(p.plantManual) return;
        const eff = effectiveLinePlant(gh, sec.number, line.number);
        if(eff){
          p.plant = { type: eff, plantedDate: (p.plant && p.plant.type===eff) ? p.plant.plantedDate : todayStr() };
        } else {
          p.plant = null;
        }
      });
    });
  });
}

/* Keeps each pillar's configuration-installed devices (id ends with
   "-cfg") in sync with the green house's deviceInstallations list,
   live: adds one the moment its exact section/line/pillar is added
   to the list, removes it the moment that entry is deleted. A device
   installed by hand from a pillar's own panel never ends in "-cfg"
   and this never touches it. */
function syncConfigDevices(gh, ghCfg){
  const installs = (ghCfg && Array.isArray(ghCfg.deviceInstallations)) ? ghCfg.deviceInstallations : [];
  const wanted = new Map();
  installs.forEach(inst=>{
    const sec = gh.sections.find(s=>s.number===inst.section);
    const line = sec && sec.lines.find(l=>l.number===inst.line);
    const pillar = line && line.pillars.find(p=>p.number===inst.pillar);
    if(!pillar) return;
    const dt = deviceType(inst.deviceTypeId);
    if(!dt) return;
    const deviceId = pillar.id+"-dev-"+inst.deviceTypeId+"-cfg";
    if(!wanted.has(pillar.id)) wanted.set(pillar.id, new Set());
    wanted.get(pillar.id).add(deviceId);
    if(!pillar.devices.find(d=>d.id===deviceId)){
      pillar.devices.push({ id: deviceId, typeId: inst.deviceTypeId });
    }
  });
  gh.sections.forEach(sec=>sec.lines.forEach(line=>line.pillars.forEach(p=>{
    const want = wanted.get(p.id);
    p.devices = p.devices.filter(d=>{
      if(!d.id.endsWith("-cfg")) return true;
      return want && want.has(d.id);
    });
  })));
}
function todayStr(){ return new Date().toISOString().slice(0,10); }

function findPillar(pillarId){
  for(const gh of STATE.greenHouses){
    for(const sec of gh.sections){
      for(const line of sec.lines){
        for(const p of line.pillars){
          if(p.id === pillarId) return { pillar: p, gh, sec, line };
        }
      }
    }
  }
  return null;
}
function pillarStatus(pillar){
  if(!pillar.diseaseRecords.length) return "Healthy";
  let worst = "Healthy", worstIdx = 0;
  pillar.diseaseRecords.forEach(r=>{
    const idx = severityIndex(r.severity);
    if(idx > worstIdx){ worstIdx = idx; worst = r.severity; }
  });
  return worst;
}

/* ============================================================
   4. INIT / RE-INIT
   ============================================================ */
function initApp(keepData){
  const newGhs = buildStructure();

  // For every pillar: if it already has recorded data (keepData and an
  // old pillar with the same id exists), carry over its disease records,
  // readings, and whether its plant is user-controlled — never
  // overwritten by config. Then, on every pass, plant and configured
  // devices are (re)synced live from the current configuration for any
  // pillar that isn't manually controlled — this is what makes changing
  // a default in the UI show up immediately, with no rebuild needed.
  newGhs.forEach(gh=>{
    const ghCfg = CONFIG.greenHouses.find(c=>c.id===gh.id);
    const oldGh = keepData ? STATE.greenHouses.find(g=>g.id===gh.id) : null;
    gh.sections.forEach(sec=>{
      const oldSec = oldGh && oldGh.sections.find(s=>s.id===sec.id);
      sec.lines.forEach(line=>{
        const oldLine = oldSec && oldSec.lines.find(l=>l.id===line.id);
        line.pillars.forEach(p=>{
          const oldP = oldLine && oldLine.pillars.find(op=>op.id===p.id);
          if(oldP){
            p.plant = oldP.plant;
            p.plantManual = !!oldP.plantManual;
            p.devices = oldP.devices;
            p.diseaseRecords = oldP.diseaseRecords;
            p.deviceReadings = oldP.deviceReadings;
          }
        });
      });
    });
    refreshDefaultPlants(gh);
    syncConfigDevices(gh, ghCfg);
  });

  STATE.greenHouses = newGhs;
  if(!STATE.greenHouses.length){
    STATE.currentGhId = null;
  } else if(!STATE.greenHouses.find(g=>g.id===STATE.currentGhId)){
    STATE.currentGhId = STATE.greenHouses[0].id;
  }
  document.getElementById("project-name").textContent = CONFIG.project.name;
  renderSidebar();
  renderTopbar();
  renderCurrentView();
  if(STATE.modalType === "section") renderModal();
  persist();
}

function boot(){
  const saved = loadPersisted();
  if(saved){
    CONFIG = saved.config;
    STATE.greenHouses = saved.greenHouses;
    STATE.currentGhId = saved.currentGhId;
    if(!STATE.greenHouses.find(g=>g.id===STATE.currentGhId)){
      STATE.currentGhId = STATE.greenHouses.length ? STATE.greenHouses[0].id : null;
    }
    document.getElementById("project-name").textContent = (CONFIG.project && CONFIG.project.name) || "";
    renderSidebar();
    renderTopbar();
    renderCurrentView();
  } else {
    initApp(false);
  }
}

/* ============================================================
   5. PLANT-HIERARCHY EDITORS (green house / section / line)
   ============================================================ */
function setGhPlantType(ghId, value){
  const cfgGh = CONFIG.greenHouses.find(g=>g.id===ghId);
  if(!cfgGh) return;
  cfgGh.plantType = value || null;
  initApp(true);
}
function setSectionPlantOverride(ghId, sectionNumber, value){
  const cfgGh = CONFIG.greenHouses.find(g=>g.id===ghId);
  if(!cfgGh) return;
  if(!cfgGh.plantOverrides) cfgGh.plantOverrides = { sections:{}, lines:{} };
  if(!cfgGh.plantOverrides.sections) cfgGh.plantOverrides.sections = {};
  if(value) cfgGh.plantOverrides.sections[sectionNumber] = value;
  else delete cfgGh.plantOverrides.sections[sectionNumber];
  initApp(true);
}
function setLinePlantOverride(ghId, sectionNumber, lineNumber, value){
  const cfgGh = CONFIG.greenHouses.find(g=>g.id===ghId);
  if(!cfgGh) return;
  if(!cfgGh.plantOverrides) cfgGh.plantOverrides = { sections:{}, lines:{} };
  if(!cfgGh.plantOverrides.lines) cfgGh.plantOverrides.lines = {};
  const key = sectionNumber+"-"+lineNumber;
  if(value) cfgGh.plantOverrides.lines[key] = value;
  else delete cfgGh.plantOverrides.lines[key];
  initApp(true);
}

/* ============================================================
   6. SIDEBAR + TOPBAR
   ============================================================ */
function renderSidebar(){
  const list = document.getElementById("gh-list");
  list.innerHTML = STATE.greenHouses.map(gh=>{
    const pillarTotal = gh.sections.reduce((a,s)=>a + s.lines.reduce((b,l)=>b+l.pillars.length,0),0);
    const active = gh.id===STATE.currentGhId ? "active" : "";
    return `<li><button class="${active}" data-gh="${gh.id}">
      <span>${gh.name}</span><span class="pill-count">${pillarTotal}</span>
    </button></li>`;
  }).join("");
  list.querySelectorAll("button").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      STATE.currentGhId = btn.getAttribute("data-gh");
      renderSidebar();
      renderTopbar();
      renderCurrentView();
    });
  });
}

function currentGh(){ return STATE.greenHouses.find(g=>g.id===STATE.currentGhId); }

function renderTopbar(){
  const gh = currentGh();
  if(!gh) return;
  document.getElementById("gh-title").textContent = gh.name;
  const lineTotal = gh.sections.reduce((a,s)=>a+s.lines.length,0);
  const pillarTotal = gh.sections.reduce((a,s)=>a+s.lines.reduce((b,l)=>b+l.pillars.length,0),0);
  document.getElementById("gh-sub").textContent = `${gh.sections.length} sections · ${lineTotal} lines · ${pillarTotal} pillars`;

  const plantSelect = document.getElementById("gh-plant-select");
  plantSelect.innerHTML = `<option value="">— No default plant —</option>` +
    CONFIG.plantTypes.map(t=>`<option value="${t}" ${gh.plantType===t?"selected":""}>${t}</option>`).join("");
  plantSelect.onchange = ()=> setGhPlantType(gh.id, plantSelect.value);
}

document.querySelectorAll("#tabs button").forEach(btn=>{
  btn.addEventListener("click", ()=>{
    document.querySelectorAll("#tabs button").forEach(b=>b.classList.remove("active"));
    btn.classList.add("active");
    STATE.currentView = btn.getAttribute("data-view");
    document.getElementById("map-view").style.display = STATE.currentView==="map" ? "" : "none";
    document.getElementById("dashboard-view").style.display = STATE.currentView==="dashboard" ? "" : "none";
    document.getElementById("config-view").style.display = STATE.currentView==="config" ? "" : "none";
    renderCurrentView();
  });
});

function renderCurrentView(){
  if(STATE.currentView==="map") renderMap();
  else if(STATE.currentView==="dashboard") renderDashboard();
  else if(STATE.currentView==="config") renderConfigView();
}

/* ============================================================
   7. MAP VIEW
   ============================================================ */
function renderMap(){
  const gh = currentGh();
  if(!gh) return;

  // legend
  const legend = document.getElementById("legend");
  legend.innerHTML = CONFIG.severityLevels.map(s=>
    `<span class="item"><span class="swatch" style="background:${s.color}"></span>${s.key}</span>`
  ).join("") + `<span class="divider"></span><span class="item"><span class="device-badge-legend"></span>Device installed</span>`;

  // jump strip
  const jump = document.getElementById("jump-strip");
  jump.innerHTML = gh.sections.map(s=>`<button data-jump="${s.id}">S${s.number}</button>`).join("");
  jump.querySelectorAll("button").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const el = document.getElementById("card-"+btn.getAttribute("data-jump"));
      if(el) el.scrollIntoView({behavior:"smooth", block:"start"});
    });
  });

  // grid
  const grid = document.getElementById("map-grid");
  grid.innerHTML = gh.sections.map(sec=>{
    const effSectionPlant = effectiveSectionPlant(gh, sec.number);
    const lines = sec.lines.map(line=>{
      const effLinePlant = effectiveLinePlant(gh, sec.number, line.number);
      const pillars = line.pillars.map(p=>{
        const status = pillarStatus(p);
        const color = severityColor(status);
        const devCount = p.devices.length;
        const dotClass = devCount > 1 ? "badge-dot multi" : "badge-dot";
        const dot = devCount ? `<span class="${dotClass}"></span>` : "";
        const emptyClass = (!p.plant && !devCount && status==="Healthy") ? "empty" : "";
        const title = `Section ${sec.number} / Line ${line.number} / Pillar ${p.number} — ${status}` + (p.plant ? ` — ${p.plant.type}` : "");
        return `<div class="pillar ${emptyClass}" style="background:${emptyClass?'':color}" data-pillar="${p.id}" title="${title}">${dot}</div>`;
      }).join("");
      const lineTitle = effLinePlant ? `Line ${line.number} default plant: ${effLinePlant}` : `Line ${line.number} — no default plant set`;
      return `<div class="line-row"><span class="line-label mono" title="${lineTitle}">L${line.number}</span><div class="pillars">${pillars}</div></div>`;
    }).join("");
    return `<div class="section-card" id="card-${sec.id}">
      <h3>
        <span class="sec-title">Section ${sec.number}<span class="count mono">${sec.lines.length} lines</span></span>
        <button class="icon-btn section-gear" data-section="${sec.id}" title="Configure plant defaults for this section &amp; its lines">⚙</button>
      </h3>
      ${effSectionPlant ? `<div class="sec-plant-hint mono">Default: ${effSectionPlant}</div>` : ""}
      ${lines}
    </div>`;
  }).join("");

  grid.querySelectorAll(".pillar").forEach(el=>{
    el.addEventListener("click", ()=>openPillarModal(el.getAttribute("data-pillar")));
  });
  grid.querySelectorAll(".section-gear").forEach(btn=>{
    btn.addEventListener("click", (e)=>{
      e.stopPropagation();
      openSectionModal(btn.getAttribute("data-section"));
    });
  });
}

/* ============================================================
   8. MODAL DISPATCH
   ============================================================ */
function closeModal(){
  document.getElementById("modal-overlay").classList.remove("open");
  STATE.selectedPillarId = null;
  STATE.selectedSectionId = null;
  STATE.modalType = null;
}
function renderModal(){
  if(STATE.modalType === "section") return renderSectionModal();
  return renderPillarModal();
}
document.getElementById("modal-overlay").addEventListener("click", (e)=>{
  if(e.target.id === "modal-overlay") closeModal();
});

/* ============================================================
   9. PILLAR MODAL (plant / devices / disease records)
   ============================================================ */
function openPillarModal(pillarId){
  STATE.modalType = "pillar";
  STATE.selectedPillarId = pillarId;
  document.getElementById("modal-overlay").classList.add("open");
  renderModal();
}

function renderPillarModal(){
  const found = findPillar(STATE.selectedPillarId);
  if(!found) return closeModal();
  const { pillar, gh, sec, line } = found;
  const status = pillarStatus(pillar);
  const statusColor = severityColor(status);
  const effPlant = effectiveLinePlant(gh, sec.number, line.number);

  const plantSection = `
    <div class="modal-section">
      <h4>Plant</h4>
      ${pillar.plant ? `
        <div class="field-row">
          <div><label class="mini">Type</label><div style="font-size:13px;">${pillar.plant.type}</div></div>
          <div><label class="mini">Planted</label><div class="mono" style="font-size:12px;">${pillar.plant.plantedDate}</div></div>
        </div>
        <button class="btn btn-ghost btn-sm" id="remove-plant-btn">Remove plant</button>
      ` : `
        <div class="field-row">
          <div>
            <label class="mini">Plant type${effPlant ? ` (default: ${effPlant})` : ""}</label>
            <select id="new-plant-type">${CONFIG.plantTypes.map(t=>`<option value="${t}" ${t===effPlant?"selected":""}>${t}</option>`).join("")}</select>
          </div>
          <div>
            <label class="mini">Planted date</label>
            <input type="date" id="new-plant-date" value="${todayStr()}">
          </div>
        </div>
        <button class="btn btn-primary btn-sm" id="add-plant-btn">Add plant</button>
      `}
      ${pillar.plantManual ? `
        <div style="margin-top:10px;font-size:11px;color:var(--ink-faint);">
          Set manually — no longer following the section/line default.
          <button class="btn btn-ghost btn-sm" id="follow-default-btn" style="margin-left:4px;">Follow default again</button>
        </div>
      ` : ""}
    </div>`;

  const availableDeviceTypes = CONFIG.deviceTypes;
  const devicesSection = `
    <div class="modal-section">
      <h4>Devices</h4>
      <div style="margin-bottom:10px;">
        ${pillar.devices.length ? pillar.devices.map(d=>{
          const dt = deviceType(d.typeId);
          return `<span class="device-tag"><span class="dot"></span>${dt?dt.name:d.typeId}<button data-remove-device="${d.id}">✕</button></span>`;
        }).join("") : `<div class="empty-note">No devices installed at this pillar.</div>`}
      </div>
      <div class="field-row">
        <select id="new-device-type">
          ${availableDeviceTypes.map(dt=>`<option value="${dt.id}">${dt.name}</option>`).join("")}
        </select>
        <button class="btn btn-ghost btn-sm" id="install-device-btn" style="flex:0 0 auto;">Install device</button>
      </div>

      ${pillar.devices.length ? `
      <div style="margin-top:14px;">
        <label class="mini">Log a reading</label>
        <div class="field-row">
          <select id="reading-device-select">
            ${pillar.devices.map(d=>{const dt=deviceType(d.typeId); return `<option value="${d.id}">${dt?dt.name:d.typeId}</option>`;}).join("")}
          </select>
          <input type="text" id="reading-value" placeholder="Value">
          <button class="btn btn-primary btn-sm" id="log-reading-btn" style="flex:0 0 auto;">Log</button>
        </div>
      </div>
      <table class="mini-table" style="margin-top:10px;">
        <thead><tr><th>Device</th><th>Value</th><th>Date</th></tr></thead>
        <tbody>
          ${[...pillar.deviceReadings].sort((a,b)=>b.timestamp.localeCompare(a.timestamp)).slice(0,6).map(r=>{
            const dev = pillar.devices.find(d=>d.id===r.deviceId);
            const dt = dev ? deviceType(dev.typeId) : null;
            return `<tr><td>${dt?dt.name:"—"}</td><td class="mono">${r.value}${r.unit?(" "+r.unit):""}</td><td class="mono">${r.timestamp}</td></tr>`;
          }).join("") || `<tr><td colspan="3" class="empty-note">No readings logged yet.</td></tr>`}
        </tbody>
      </table>` : ""}
    </div>`;

  const diseaseSection = `
    <div class="modal-section">
      <h4>Disease record</h4>
      <div class="field-row">
        <select id="new-disease-select">
          ${CONFIG.diseases.map(d=>`<option value="${d.id}">${d.name}</option>`).join("")}
        </select>
        <select id="new-disease-severity">
          ${CONFIG.severityLevels.filter(s=>s.key!=="Healthy").map(s=>`<option value="${s.key}">${s.key}</option>`).join("")}
        </select>
        <input type="date" id="new-disease-date" value="${todayStr()}">
      </div>
      <textarea id="new-disease-notes" placeholder="Notes (optional)"></textarea>
      <div style="margin-top:8px;"><button class="btn btn-primary btn-sm" id="record-disease-btn">Record disease</button></div>

      <table class="mini-table" style="margin-top:14px;">
        <thead><tr><th>Disease</th><th>Severity</th><th>Date</th><th></th></tr></thead>
        <tbody>
          ${[...pillar.diseaseRecords].sort((a,b)=>b.date.localeCompare(a.date)).map((r)=>`
            <tr>
              <td>${diseaseName(r.diseaseId)}</td>
              <td><span class="status-chip" style="background:${severityColor(r.severity)}">${r.severity}</span></td>
              <td class="mono">${r.date}</td>
              <td><button class="btn-danger-ghost btn-sm" data-remove-disease="${r.diseaseId}|${r.date}">Remove</button></td>
            </tr>`).join("") || `<tr><td colspan="4" class="empty-note">No disease records.</td></tr>`}
        </tbody>
      </table>
    </div>`;

  document.getElementById("modal").innerHTML = `
    <div class="modal-head">
      <div>
        <h3>Pillar ${pillar.number}</h3>
        <div class="path mono">${gh.name} / Section ${sec.number} / Line ${line.number}</div>
      </div>
      <button class="modal-close" id="modal-close-btn">✕</button>
    </div>
    <div class="modal-section" style="padding-bottom:10px;">
      <span class="status-chip" style="background:${statusColor}">${status}</span>
    </div>
    ${plantSection}
    ${devicesSection}
    ${diseaseSection}
  `;

  document.getElementById("modal-close-btn").addEventListener("click", closeModal);

  const addPlantBtn = document.getElementById("add-plant-btn");
  if(addPlantBtn) addPlantBtn.addEventListener("click", ()=>{
    pillar.plant = {
      type: document.getElementById("new-plant-type").value,
      plantedDate: document.getElementById("new-plant-date").value || todayStr()
    };
    pillar.plantManual = true;
    persist();
    renderModal(); renderMap();
  });
  const removePlantBtn = document.getElementById("remove-plant-btn");
  if(removePlantBtn) removePlantBtn.addEventListener("click", ()=>{
    pillar.plant = null;
    pillar.plantManual = true;
    persist();
    renderModal(); renderMap();
  });
  const followDefaultBtn = document.getElementById("follow-default-btn");
  if(followDefaultBtn) followDefaultBtn.addEventListener("click", ()=>{
    pillar.plantManual = false;
    const eff = effectiveLinePlant(gh, sec.number, line.number);
    pillar.plant = eff ? { type: eff, plantedDate: todayStr() } : null;
    persist();
    renderModal(); renderMap();
  });

  document.getElementById("install-device-btn").addEventListener("click", ()=>{
    const typeId = document.getElementById("new-device-type").value;
    const deviceId = pillar.id + "-dev-" + typeId + "-" + Date.now();
    pillar.devices.push({ id: deviceId, typeId });
    persist();
    renderModal(); renderMap();
  });
  document.getElementById("modal").querySelectorAll("[data-remove-device]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const id = btn.getAttribute("data-remove-device");
      pillar.devices = pillar.devices.filter(d=>d.id!==id);
      pillar.deviceReadings = pillar.deviceReadings.filter(r=>r.deviceId!==id);
      persist();
      renderModal(); renderMap();
    });
  });

  const logReadingBtn = document.getElementById("log-reading-btn");
  if(logReadingBtn) logReadingBtn.addEventListener("click", ()=>{
    const deviceId = document.getElementById("reading-device-select").value;
    const value = document.getElementById("reading-value").value.trim();
    if(!value) return;
    const dev = pillar.devices.find(d=>d.id===deviceId);
    const dt = dev ? deviceType(dev.typeId) : null;
    pillar.deviceReadings.push({ deviceId, value, unit: dt?dt.unit:"", timestamp: todayStr() });
    persist();
    renderModal();
  });

  document.getElementById("record-disease-btn").addEventListener("click", ()=>{
    pillar.diseaseRecords.push({
      diseaseId: document.getElementById("new-disease-select").value,
      severity: document.getElementById("new-disease-severity").value,
      date: document.getElementById("new-disease-date").value || todayStr(),
      notes: document.getElementById("new-disease-notes").value.trim()
    });
    persist();
    renderModal(); renderMap();
  });
  document.getElementById("modal").querySelectorAll("[data-remove-disease]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const [diseaseId, date] = btn.getAttribute("data-remove-disease").split("|");
      const idx = pillar.diseaseRecords.findIndex(r=>r.diseaseId===diseaseId && r.date===date);
      if(idx>-1) pillar.diseaseRecords.splice(idx,1);
      persist();
      renderModal(); renderMap();
    });
  });
}

/* ============================================================
   10. SECTION MODAL (plant defaults for a section & its lines)
   ============================================================ */
function openSectionModal(sectionId){
  STATE.modalType = "section";
  STATE.selectedSectionId = sectionId;
  document.getElementById("modal-overlay").classList.add("open");
  renderModal();
}

function renderSectionModal(){
  const gh = currentGh();
  const sec = gh && gh.sections.find(s=>s.id===STATE.selectedSectionId);
  if(!gh || !sec) return closeModal();

  const sectionOverride = gh.plantOverrides.sections[sec.number] || "";
  const sectionInheritLabel = gh.plantType
    ? `Inherit greenhouse default (${gh.plantType})`
    : "Inherit greenhouse default (none set)";

  const sectionPlantHtml = `
    <div class="modal-section">
      <h4>Section ${sec.number} default plant</h4>
      <select id="section-plant-select">
        <option value="">${sectionInheritLabel}</option>
        ${CONFIG.plantTypes.map(t=>`<option value="${t}" ${sectionOverride===t?"selected":""}>${t}</option>`).join("")}
      </select>
    </div>`;

  const effSectionPlant = sectionOverride || gh.plantType || "";

  const linesHtml = `
    <div class="modal-section">
      <h4>Lines in section ${sec.number}</h4>
      <table class="mini-table">
        <thead><tr><th>Line</th><th>Plant default</th></tr></thead>
        <tbody>
        ${sec.lines.map(line=>{
          const key = sec.number+"-"+line.number;
          const lineOverride = gh.plantOverrides.lines[key] || "";
          const inheritLabel = effSectionPlant ? `Inherit section (${effSectionPlant})` : "Inherit (none set)";
          return `<tr>
            <td class="mono">L${line.number}</td>
            <td>
              <select data-line-plant="${line.number}">
                <option value="">${inheritLabel}</option>
                ${CONFIG.plantTypes.map(t=>`<option value="${t}" ${lineOverride===t?"selected":""}>${t}</option>`).join("")}
              </select>
            </td>
          </tr>`;
        }).join("")}
        </tbody>
      </table>
    </div>`;

  document.getElementById("modal").innerHTML = `
    <div class="modal-head">
      <div>
        <h3>Section ${sec.number} — Plant defaults</h3>
        <div class="path mono">${gh.name}</div>
      </div>
      <button class="modal-close" id="modal-close-btn">✕</button>
    </div>
    <div class="modal-section" style="padding-bottom:10px;color:var(--ink-soft);font-size:12px;">
      Setting a default here pre-fills the "Add plant" form for pillars in this section or line.
      It does not change plants already recorded on individual pillars.
    </div>
    ${sectionPlantHtml}
    ${linesHtml}
  `;

  document.getElementById("modal-close-btn").addEventListener("click", closeModal);
  document.getElementById("section-plant-select").addEventListener("change", (e)=>{
    setSectionPlantOverride(gh.id, sec.number, e.target.value);
  });
  document.getElementById("modal").querySelectorAll("[data-line-plant]").forEach(sel=>{
    sel.addEventListener("change", (e)=>{
      const lineNumber = sel.getAttribute("data-line-plant");
      setLinePlantOverride(gh.id, sec.number, lineNumber, e.target.value);
    });
  });
}

/* ============================================================
   11. DASHBOARD
   ============================================================ */
function renderDashboard(){
  const scopeAll = STATE.greenHouses;
  const container = document.getElementById("dashboard-view");

  const currentScope = container.getAttribute("data-scope") || "all";
  const ghsInScope = currentScope==="all" ? scopeAll : scopeAll.filter(g=>g.id===currentScope);

  let allPillars = [];
  ghsInScope.forEach(gh=>gh.sections.forEach(sec=>sec.lines.forEach(line=>line.pillars.forEach(p=>{
    allPillars.push({ p, ghName: gh.name, secNum: sec.number, lineNum: line.number });
  }))));

  const totalPillars = allPillars.length;
  const sevCounts = {};
  CONFIG.severityLevels.forEach(s=>sevCounts[s.key]=0);
  allPillars.forEach(({p})=>{ sevCounts[pillarStatus(p)]++; });
  const diseasedCount = totalPillars - sevCounts["Healthy"];
  const deviceCount = allPillars.reduce((a,{p})=>a+p.devices.length,0);
  const plantedCount = allPillars.filter(({p})=>p.plant).length;

  const recentDiseases = [];
  allPillars.forEach(({p,ghName,secNum,lineNum})=>{
    p.diseaseRecords.forEach(r=>recentDiseases.push({...r, ghName, secNum, lineNum, pillarNum:p.number}));
  });
  recentDiseases.sort((a,b)=>b.date.localeCompare(a.date));

  const recentReadings = [];
  allPillars.forEach(({p,ghName,secNum,lineNum})=>{
    p.deviceReadings.forEach(r=>{
      const dev = p.devices.find(d=>d.id===r.deviceId);
      const dt = dev ? deviceType(dev.typeId) : null;
      recentReadings.push({...r, deviceName: dt?dt.name:"—", ghName, secNum, lineNum, pillarNum:p.number});
    });
  });
  recentReadings.sort((a,b)=>b.timestamp.localeCompare(a.timestamp));

  container.innerHTML = `
    <div style="display:flex;justify-content:flex-end;margin-bottom:14px;">
      <select class="filter" id="dash-scope">
        <option value="all" ${currentScope==="all"?"selected":""}>All green houses</option>
        ${scopeAll.map(g=>`<option value="${g.id}" ${currentScope===g.id?"selected":""}>${g.name}</option>`).join("")}
      </select>
    </div>

    <div class="stat-grid">
      <div class="stat-card"><div class="num">${totalPillars}</div><div class="lbl">Total pillars</div></div>
      <div class="stat-card"><div class="num">${plantedCount}</div><div class="lbl">Pillars with plants</div></div>
      <div class="stat-card"><div class="num">${deviceCount}</div><div class="lbl">Devices installed</div></div>
      <div class="stat-card"><div class="num">${diseasedCount}</div><div class="lbl">Pillars with active disease</div></div>
      ${CONFIG.severityLevels.filter(s=>s.key!=="Healthy").map(s=>`
        <div class="stat-card sev" style="--num-color:${s.color}"><div class="num">${sevCounts[s.key]}</div><div class="lbl">${s.key} severity</div></div>
      `).join("")}
    </div>

    <div class="panel">
      <div class="panel-head"><h4>Recent disease records</h4></div>
      <div class="panel-body">
        <table class="mini-table">
          <thead><tr><th>Location</th><th>Disease</th><th>Severity</th><th>Date</th></tr></thead>
          <tbody>
          ${recentDiseases.slice(0,12).map(r=>`
            <tr>
              <td class="mono">${r.ghName} · S${r.secNum}/L${r.lineNum}/P${r.pillarNum}</td>
              <td>${diseaseName(r.diseaseId)}</td>
              <td><span class="status-chip" style="background:${severityColor(r.severity)}">${r.severity}</span></td>
              <td class="mono">${r.date}</td>
            </tr>
          `).join("") || `<tr><td colspan="4" class="empty-note">No disease records yet.</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>

    <div class="panel">
      <div class="panel-head"><h4>Recent device readings</h4></div>
      <div class="panel-body">
        <table class="mini-table">
          <thead><tr><th>Location</th><th>Device</th><th>Value</th><th>Date</th></tr></thead>
          <tbody>
          ${recentReadings.slice(0,12).map(r=>`
            <tr>
              <td class="mono">${r.ghName} · S${r.secNum}/L${r.lineNum}/P${r.pillarNum}</td>
              <td>${r.deviceName}</td>
              <td class="mono">${r.value}${r.unit?(" "+r.unit):""}</td>
              <td class="mono">${r.timestamp}</td>
            </tr>
          `).join("") || `<tr><td colspan="4" class="empty-note">No readings logged yet.</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>
  `;

  document.getElementById("dash-scope").addEventListener("change", (e)=>{
    container.setAttribute("data-scope", e.target.value);
    renderDashboard();
  });
}

/* ============================================================
   12. CONFIG VIEW
   ============================================================ */
function renderConfigView(){
  document.getElementById("config-json").value = JSON.stringify(CONFIG, null, 2);
  document.getElementById("config-msg").className = "config-msg";
  document.getElementById("config-msg").textContent = "";
}

document.getElementById("apply-config-btn").addEventListener("click", ()=>{
  const msg = document.getElementById("config-msg");
  try{
    const parsed = JSON.parse(document.getElementById("config-json").value);
    if(!parsed.project || !Array.isArray(parsed.greenHouses) || !parsed.greenHouses.length ||
       !parsed.severityLevels || !parsed.diseases || !parsed.deviceTypes || !Array.isArray(parsed.plantTypes)){
      throw new Error("Config is missing one or more required top-level keys (project, greenHouses[], severityLevels, diseases, deviceTypes, plantTypes[]).");
    }
    parsed.greenHouses.forEach((gh, idx)=>{
      if(!gh.id) gh.id = "gh"+(idx+1);
      if(!gh.name) gh.name = gh.id;
      if(!gh.structure) gh.structure = {};
      if(!gh.plantOverrides) gh.plantOverrides = { sections: {}, lines: {} };
      if(!gh.plantOverrides.sections) gh.plantOverrides.sections = {};
      if(!gh.plantOverrides.lines) gh.plantOverrides.lines = {};
      if(!Array.isArray(gh.deviceInstallations)) gh.deviceInstallations = [];
    });
    CONFIG = parsed;
    initApp(true);
    msg.className = "config-msg ok";
    msg.textContent = "Configuration applied. Each green house's structure was rebuilt from its own settings; existing pillar data was preserved where possible, and any newly-created pillars were given their configured default plant/devices.";
  }catch(err){
    msg.className = "config-msg err";
    msg.textContent = "Could not apply configuration: " + err.message;
  }
});
document.getElementById("reset-config-btn").addEventListener("click", ()=>{
  CONFIG = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  initApp(false);
  renderConfigView();
});
document.getElementById("regenerate-config-btn").addEventListener("click", ()=>{
  const ok = confirm("This clears every recorded plant, device, disease record and reading on every pillar, then rebuilds all green houses purely from the current configuration (default plants + configured device installs). This cannot be undone. Continue?");
  if(!ok) return;
  initApp(false);
  const msg = document.getElementById("config-msg");
  msg.className = "config-msg ok";
  msg.textContent = "All green houses were regenerated from the current configuration. Every pillar now reflects only its configured default plant and device installs — nothing random or manually recorded remains.";
});

/* ============================================================
   13. EXPORT / IMPORT
   ============================================================ */
document.getElementById("export-btn").addEventListener("click", ()=>{
  const payload = { config: CONFIG, greenHouses: STATE.greenHouses };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {type:"application/json"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "dava-c-hydroponics-data.json";
  a.click();
  URL.revokeObjectURL(url);
});
document.getElementById("import-btn").addEventListener("click", ()=>{
  document.getElementById("import-input").click();
});
document.getElementById("import-input").addEventListener("change", (e)=>{
  const file = e.target.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try{
      const payload = JSON.parse(reader.result);
      if(payload.config) CONFIG = payload.config;
      if(payload.greenHouses) STATE.greenHouses = payload.greenHouses;
      if(!STATE.greenHouses.find(g=>g.id===STATE.currentGhId)){
        STATE.currentGhId = STATE.greenHouses.length ? STATE.greenHouses[0].id : null;
      }
      renderSidebar(); renderTopbar(); renderCurrentView();
      persist();
    }catch(err){
      alert("Could not import file: " + err.message);
    }
  };
  reader.readAsText(file);
  e.target.value = "";
});

/* ============================================================
   14. BOOT
   ============================================================ */
boot();

})();
