/* ============================================================
   Vigil — KSP Crime Intelligence Prototype
   Pure client-side app. Loads data/data.json, no backend needed.
   ============================================================ */

const START_DATE = new Date("2025-08-01T00:00:00");

let DATA = null;
let map, markerLayer, heatLayer, clusterGroup;
let network = null;
let currentTab = "map";

const dayOffset = (dateStr) => Math.floor((new Date(dateStr) - START_DATE) / 86400000);
const dateFromOffset = (n) => {
  const d = new Date(START_DATE.getTime() + n * 86400000);
  return d.toISOString().slice(0, 10);
};

const CRIME_HEAD_COLORS = {
  1: "#C9A227", // Property - gold
  2: "#C1432F", // Body - red
  3: "#B24C8C", // Women - magenta
  4: "#3E8E93", // Cyber - teal
  5: "#7A5CC9", // NDPS - purple
  6: "#6C7A8F", // Public order - slate
};

fetch("data/data.json")
  .then(r => r.json())
  .then(json => {
    DATA = json;
    init();
  })
  .catch(err => {
    document.body.innerHTML = `<div style="padding:40px;color:#E7EAF1;font-family:sans-serif">
      Could not load data/data.json. If you're opening this file directly (file://), serve it over
      a local web server instead — e.g. run <code>python3 -m http.server</code> in this folder and
      open http://localhost:8000. Error: ${err}</div>`;
  });

function init() {
  populateFilters();
  setupTabs();
  buildMap();
  setupToggles();
  setupSliders(); // triggers the first render(); map must already exist
  render(); // safety net in case slider setup didn't already render
}

/* ---------------- Filters ---------------- */

function populateFilters() {
  const distSel = document.getElementById("filterDistrict");
  DATA.districts.forEach(d => {
    const opt = document.createElement("option");
    opt.value = d.id; opt.textContent = d.name;
    distSel.appendChild(opt);
  });

  const headSel = document.getElementById("filterCrimeHead");
  DATA.crimeHeads.forEach(h => {
    const opt = document.createElement("option");
    opt.value = h.id; opt.textContent = h.name;
    headSel.appendChild(opt);
  });

  const maxDay = Math.max(...DATA.cases.map(c => dayOffset(c.registeredDate)));
  document.getElementById("dateFrom").max = maxDay;
  document.getElementById("dateTo").max = maxDay;
  document.getElementById("dateTo").value = maxDay;

  [distSel, headSel, "filterStatus"].forEach(() => {});
  document.getElementById("filterDistrict").addEventListener("change", render);
  document.getElementById("filterCrimeHead").addEventListener("change", render);
  document.getElementById("filterStatus").addEventListener("change", render);
}

function setupSliders() {
  const from = document.getElementById("dateFrom");
  const to = document.getElementById("dateTo");
  const update = () => {
    if (+from.value > +to.value) { to.value = from.value; }
    document.getElementById("dateFromLbl").textContent = dateFromOffset(+from.value);
    document.getElementById("dateToLbl").textContent = dateFromOffset(+to.value);
    render();
  };
  from.addEventListener("input", update);
  to.addEventListener("input", update);
  update();
}

function getFiltered() {
  const dist = document.getElementById("filterDistrict").value;
  const head = document.getElementById("filterCrimeHead").value;
  const status = document.getElementById("filterStatus").value;
  const from = +document.getElementById("dateFrom").value;
  const to = +document.getElementById("dateTo").value;

  return DATA.cases.filter(c => {
    if (dist !== "all" && String(c.districtId) !== dist) return false;
    if (head !== "all" && String(c.crimeHeadId) !== head) return false;
    if (status !== "all" && c.status !== status) return false;
    const off = dayOffset(c.registeredDate);
    if (off < from || off > to) return false;
    return true;
  });
}

/* ---------------- Tabs ---------------- */

function setupTabs() {
  document.querySelectorAll(".tab").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
      btn.classList.add("active");
      currentTab = btn.dataset.tab;
      document.getElementById("panel-" + currentTab).classList.add("active");
      if (currentTab === "map" && map) setTimeout(() => map.invalidateSize(), 50);
      if (currentTab === "network") renderNetwork(getFiltered());
      if (currentTab === "predict") renderPredictions(getFiltered());
      if (currentTab === "method") renderMethodology();
    });
  });
}

function setupToggles() {
  document.getElementById("btnMarkers").addEventListener("click", () => {
    document.getElementById("btnMarkers").classList.add("active");
    document.getElementById("btnHeat").classList.remove("active");
    if (map.hasLayer(heatLayer)) map.removeLayer(heatLayer);
    if (!map.hasLayer(clusterGroup)) map.addLayer(clusterGroup);
  });
  document.getElementById("btnHeat").addEventListener("click", () => {
    document.getElementById("btnHeat").classList.add("active");
    document.getElementById("btnMarkers").classList.remove("active");
    if (map.hasLayer(clusterGroup)) map.removeLayer(clusterGroup);
    if (!map.hasLayer(heatLayer)) map.addLayer(heatLayer);
  });
}

/* ---------------- Master render ---------------- */

function render() {
  const filtered = getFiltered();
  updateTicker(filtered);
  renderMap(filtered);
  if (currentTab === "network") renderNetwork(filtered);
  if (currentTab === "predict") renderPredictions(filtered);
}

function updateTicker(filtered) {
  document.getElementById("statTotal").textContent = filtered.length.toLocaleString();
  document.getElementById("statOpen").textContent =
    filtered.filter(c => c.status === "Under Investigation").length.toLocaleString();
  const distSet = new Set(filtered.map(c => c.districtId));
  document.getElementById("statDistricts").textContent = distSet.size;
  document.getElementById("statLinked").textContent = countRepeatEntities(filtered).toLocaleString();
}

function countRepeatEntities(cases) {
  const counts = {};
  cases.forEach(c => c.accused.forEach(a => { counts[a.entityKey] = (counts[a.entityKey] || 0) + 1; }));
  return Object.values(counts).filter(n => n > 1).length;
}

/* ---------------- Map view ---------------- */

function buildMap() {
  map = L.map("map", { zoomControl: true }).setView([15.0, 76.0], 7);
  L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
    attribution: "&copy; OpenStreetMap, &copy; CARTO",
    subdomains: "abcd", maxZoom: 19,
  }).addTo(map);
  map.attributionControl.setPrefix(false);

  clusterGroup = L.markerClusterGroup({ maxClusterRadius: 45 });
  heatLayer = L.heatLayer([], { radius: 22, blur: 18, maxZoom: 12 });
  map.addLayer(clusterGroup);
}

function renderMap(filtered) {
  clusterGroup.clearLayers();
  const heatPoints = [];

  filtered.forEach(c => {
    const color = CRIME_HEAD_COLORS[c.crimeHeadId] || "#8892A8";
    const subhead = DATA.crimeSubHeads.find(s => s.id === c.crimeSubHeadId);
    const marker = L.circleMarker([c.lat, c.lng], {
      radius: 6, color, fillColor: color, fillOpacity: 0.85, weight: 1,
    });
    marker.bindPopup(popupHtml(c, subhead));
    marker.on("click", () => decodeAnatomy(c.crimeNo));
    clusterGroup.addLayer(marker);
    heatPoints.push([c.lat, c.lng, 0.6]);
  });

  heatLayer.setLatLngs(heatPoints);
}

function popupHtml(c, subhead) {
  const unit = DATA.units.find(u => u.id === c.unitId);
  return `
    <div class="popup-cno">${c.crimeNo}</div>
    <div class="popup-title">${subhead ? subhead.name : "—"} · ${c.caseCategory}</div>
    <div class="popup-meta">${unit ? unit.name : ""}<br>
    Registered ${c.registeredDate} · ${c.status}<br>
    Accused: ${c.accused.length} · Gravity: ${c.gravity}</div>
  `;
}

/* ---------------- Crime-number anatomy decoder ---------------- */

function decodeAnatomy(crimeNo) {
  // Format: 1-digit category + 4-digit district + 4-digit unit + 4-digit year + 5-digit serial
  const cat = crimeNo.slice(0, 1);
  const districtId = crimeNo.slice(1, 5);
  const unitId = crimeNo.slice(5, 9);
  const year = crimeNo.slice(9, 13);
  const serial = crimeNo.slice(13);
  const catNames = { "1": "FIR", "2": "PAR", "3": "UDR", "4": "PAR", "8": "Zero FIR" };
  const district = DATA.districts.find(d => String(d.id) === String(+districtId));
  const unit = DATA.units.find(u => String(u.id) === String(+unitId));

  document.getElementById("anatomyBox").innerHTML = `
    <div class="anatomy-part"><span>Full number</span><b>${crimeNo}</b></div>
    <div class="anatomy-part"><span>Category</span><b>${cat} (${catNames[cat] || "—"})</b></div>
    <div class="anatomy-part"><span>District</span><b>${district ? district.name : districtId}</b></div>
    <div class="anatomy-part"><span>Station</span><b>${unit ? unit.name : unitId}</b></div>
    <div class="anatomy-part"><span>Year</span><b>${year}</b></div>
    <div class="anatomy-part"><span>Serial</span><b>${+serial}</b></div>
  `;
}

/* ---------------- Network / link analysis view ---------------- */

function renderNetwork(filtered) {
  const container = document.getElementById("network");
  const nodesMap = new Map();
  const edges = [];
  const entityCaseCount = {};

  filtered.forEach(c => c.accused.forEach(a => {
    entityCaseCount[a.entityKey] = (entityCaseCount[a.entityKey] || 0) + 1;
  }));

  // Limit to a readable subgraph: all repeat entities + their cases, plus a sample of single cases
  const repeatKeys = new Set(Object.keys(entityCaseCount).filter(k => entityCaseCount[k] > 1));
  const relevantCases = filtered.filter(c => c.accused.some(a => repeatKeys.has(a.entityKey)));
  const sampleSingles = filtered.filter(c => !relevantCases.includes(c)).slice(0, 60);
  const caseSubset = relevantCases.concat(sampleSingles);

  caseSubset.forEach(c => {
    const caseNodeId = "case-" + c.id;
    if (!nodesMap.has(caseNodeId)) {
      nodesMap.set(caseNodeId, {
        id: caseNodeId, label: c.crimeNo.slice(-6), shape: "dot",
        size: 7, color: "#3E8E93", title: c.crimeNo, kind: "case", caseRef: c.id,
      });
    }
    c.accused.forEach(a => {
      const isRepeat = repeatKeys.has(a.entityKey);
      const nodeId = "acc-" + a.entityKey;
      if (!nodesMap.has(nodeId)) {
        nodesMap.set(nodeId, {
          id: nodeId,
          label: a.name,
          shape: "dot",
          size: isRepeat ? 10 + Math.min(entityCaseCount[a.entityKey], 8) : 5,
          color: isRepeat ? "#C1432F" : "#8892A8",
          title: `${a.name} · ${entityCaseCount[a.entityKey]} FIR(s)`,
          kind: "accused",
          entityKey: a.entityKey,
        });
      }
      edges.push({ from: nodeId, to: caseNodeId, color: { color: "#26304A" }, width: 1 });
    });
  });

  const nodes = new vis.DataSet(Array.from(nodesMap.values()));
  const edgeSet = new vis.DataSet(edges);

  if (network) network.destroy();
  network = new vis.Network(container, { nodes, edges: edgeSet }, {
    autoResize: true,
    physics: { stabilization: { iterations: 120 }, barnesHut: { gravitationalConstant: -6000, springLength: 90 } },
    interaction: { hover: true },
    nodes: { font: { color: "#E7EAF1", size: 11, face: "IBM Plex Sans" }, borderWidth: 1 },
    edges: { smooth: false },
  });

  network.on("click", (params) => {
    if (!params.nodes.length) return;
    const node = nodesMap.get(params.nodes[0]);
    if (node.kind === "case") {
      const c = DATA.cases.find(cc => cc.id === node.caseRef);
      decodeAnatomy(c.crimeNo);
      showCaseDetail(c);
    } else {
      showEntityDetail(node.entityKey, filtered);
      const c = filtered.find(cc => cc.accused.some(a => a.entityKey === node.entityKey));
      if (c) decodeAnatomy(c.crimeNo);
    }
  });
}

function showEntityDetail(entityKey, filtered) {
  const cases = filtered.filter(c => c.accused.some(a => a.entityKey === entityKey));
  const name = cases[0]?.accused.find(a => a.entityKey === entityKey)?.name || "Unknown";
  const detail = document.getElementById("networkDetail");
  if (cases.length <= 1) {
    detail.innerHTML = `<h3>${name}</h3><p class="hint">Appears in a single FIR in the current filter.</p>`;
    return;
  }
  const rows = cases.map(c => {
    const unit = DATA.units.find(u => u.id === c.unitId);
    const subhead = DATA.crimeSubHeads.find(s => s.id === c.crimeSubHeadId);
    return `<div class="case-row">
      <div class="cno">${c.crimeNo}</div>
      <div class="meta">${subhead?.name || ""} · ${unit?.name || ""} · ${c.registeredDate}</div>
    </div>`;
  }).join("");
  detail.innerHTML = `
    <h3>${name}</h3>
    <p class="hint">Same identity, matched across <b>${cases.length}</b> FIRs at <b>${new Set(cases.map(c => c.unitId)).size}</b> different stations — the kind of link a single station-level record would never surface on its own.</p>
    ${rows}
  `;
}

function showCaseDetail(c) {
  const unit = DATA.units.find(u => u.id === c.unitId);
  const subhead = DATA.crimeSubHeads.find(s => s.id === c.crimeSubHeadId);
  document.getElementById("networkDetail").innerHTML = `
    <h3>${c.crimeNo}</h3>
    <p class="hint">${subhead?.name || ""} · ${unit?.name || ""} · ${c.registeredDate} · ${c.status}</p>
    <p class="hint">${c.briefFacts}</p>
  `;
}

/* ---------------- Predictive risk view ---------------- */

function renderPredictions(filtered) {
  const to = +document.getElementById("dateTo").value;
  const nowDay = to;
  const TAU = 10; // decay time constant, days — near-repeat effect fades over ~1-2 weeks

  const byUnit = {};
  filtered.forEach(c => {
    const age = nowDay - dayOffset(c.registeredDate);
    if (age < 0 || age > 45) return; // only look at recent history when scoring risk
    const key = c.unitId;
    byUnit[key] = byUnit[key] || { score: 0, recent14: 0, subheadCounts: {} };
    const w = Math.exp(-age / TAU);
    byUnit[key].score += w;
    if (age <= 14) byUnit[key].recent14 += 1;
    const sh = DATA.crimeSubHeads.find(s => s.id === c.crimeSubHeadId)?.name || "crime";
    byUnit[key].subheadCounts[sh] = (byUnit[key].subheadCounts[sh] || 0) + 1;
  });

  const rows = Object.entries(byUnit)
    .map(([unitId, v]) => {
      const unit = DATA.units.find(u => u.id === +unitId);
      const topSubhead = Object.entries(v.subheadCounts).sort((a, b) => b[1] - a[1])[0];
      return { unit, score: v.score, recent14: v.recent14, topSubhead };
    })
    .filter(r => r.unit && r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 12);

  const maxScore = rows.length ? rows[0].score : 1;
  const list = document.getElementById("predictList");

  if (!rows.length) {
    list.innerHTML = `<p class="hint" style="color:var(--muted)">No recent case activity in the selected filters/date range to score.</p>`;
    return;
  }

  list.innerHTML = rows.map((r, i) => `
    <div class="risk-row">
      <div class="risk-rank">${i + 1}</div>
      <div class="risk-bar-wrap"><div class="risk-bar" style="width:${Math.round(100 * r.score / maxScore)}%"></div></div>
      <div class="risk-body">
        <div class="risk-station">${r.unit.name}</div>
        <div class="risk-reason">${r.recent14} ${r.topSubhead ? r.topSubhead[0].toLowerCase() : "incident"} case(s) in the last 14 days nearby, recency-weighted — pattern consistent with near-repeat clustering.</div>
      </div>
      <div class="risk-score">${r.score.toFixed(1)}</div>
    </div>
  `).join("");
}

/* ---------------- Methodology / bias audit ---------------- */

function renderMethodology() {
  document.getElementById("methodGrid").innerHTML = `
    <div class="method-card">
      <h3>Data</h3>
      <p>All records on this page are synthetically generated to match the structure of the official
      FIR schema (CaseMaster, Accused, Victim, ComplainantDetails, ArrestSurrender, ActSectionAssociation).
      No real citizen or case data is used anywhere in this prototype.</p>
    </div>
    <div class="method-card">
      <h3>Link analysis</h3>
      <p>Accused persons are matched across FIRs using a name + age-band + gender key, standing in for
      real entity resolution. This surfaces the same person sitting in unlinked records at different
      police stations — the "data silo" problem named in the brief.</p>
    </div>
    <div class="method-card">
      <h3>Predictive risk score</h3>
      <p>A transparent, explainable formula — recency-weighted local case density (near-repeat
      victimization theory) — not a black-box model. Every score comes with a plain-language reason,
      by design, so an investigating officer can see exactly why an area was flagged.</p>
    </div>
    <div class="method-card excluded">
      <h3>Deliberately excluded</h3>
      <p>The official schema includes <b>CasteID</b> and <b>ReligionID</b> on ComplainantDetails. This
      prototype does not generate, store, display, or use either field anywhere — not in the data, the
      visualizations, or the risk model. Predictive policing tools trained on demographic attributes
      risk reinforcing existing patrol bias; excluding them is a design decision, not an omission.</p>
      <ul>
        <li>No caste or religion fields in the dataset</li>
        <li>No demographic attribute is a model input</li>
        <li>Risk scores are location- and time-pattern based only</li>
      </ul>
    </div>
  `;
}
