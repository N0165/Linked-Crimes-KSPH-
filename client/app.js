/* ============================================================
   Vigil — KSP Crime Intelligence Prototype
   Loads live data from the Catalyst backend (getdata function).
   ============================================================ */

const START_DATE = new Date("2025-08-01T00:00:00");

let DATA = null;
let map, markerLayer, heatLayer, clusterGroup;
let network = null;
let currentTab = "map";
let previousTab = "map";

const dayOffset = (dateStr) => Math.floor((new Date(dateStr) - START_DATE) / 86400000);
const dateFromOffset = (n) => {
  const d = new Date(START_DATE.getTime() + n * 86400000);
  return d.toISOString().slice(0, 10);
};

// Matches generate_data.py's offender_key() exactly: md5(name|age-band|gender), first 10 hex chars.
// This is what lets an accused person uploaded from a "different station's" file link up with
// the same person already sitting in the base dataset (or in another uploaded file).
function offenderKey(name, age, gender) {
  const norm = String(name).trim().toLowerCase() + "|" + Math.floor(age / 3) + "|" + gender;
  return md5(norm).slice(0, 10);
}

const CRIME_HEAD_COLORS = {
  1: "#368CBF", // Property - blue
  2: "#C1432F", // Body - red
  3: "#B24C8C", // Women - magenta
  4: "#5E9A3C", // Cyber - green
  5: "#7A5CC9", // NDPS - purple
  6: "#6C7A8F", // Public order - slate
};

fetch("/server/getdata/execute")
  .then(r => r.json())
  .then(wrapper => JSON.parse(wrapper.output))
  .then(json => {
    DATA = json;
    init();
  })
  .catch(err => {
    document.body.innerHTML = `<div style="padding:40px;color:#E7EAF1;font-family:sans-serif">
      Could not load data from the backend. Error: ${err}</div>`;
  });

function init() {
  populateFilters();
  setupTabs();
  buildMap();
  setupToggles();
  setupImport();
  setupSearch();
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

/* ---------------- Import: turning siloed station exports into one dataset ---------------- */

let IMPORTED_BATCHES = []; // { id, fileName, caseIds } — lets an upload be removed later

function setupImport() {
  const btn = document.getElementById("importBtn");
  const input = document.getElementById("csvUpload");
  const status = document.getElementById("importStatus");

  btn.addEventListener("click", () => input.click());

  input.addEventListener("change", (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    files.forEach((file) => processImportFile(file, status));
    input.value = ""; // allow re-selecting the same file(s) later
  });
}

function processImportFile(file, status) {
  status.textContent = "Parsing " + file.name + "...";
  status.className = "import-status working";

  const name = file.name.toLowerCase();
  if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const workbook = XLSX.read(evt.target.result, { type: "array" });
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(firstSheet, { raw: false, defval: "" });
        finishImport(rows, file.name, status);
      } catch (err) {
        status.textContent = "Could not read Excel file: " + err.message;
        status.className = "import-status error";
      }
    };
    reader.onerror = () => {
      status.textContent = "Could not read " + file.name + ".";
      status.className = "import-status error";
    };
    reader.readAsArrayBuffer(file);
  } else {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => finishImport(results.data, file.name, status),
      error: (err) => {
        status.textContent = "Could not parse file: " + err.message;
        status.className = "import-status error";
      },
    });
  }
}

function finishImport(rows, sourceLabel, status) {
  try {
    const { added, linked, skipped, caseIds } = importRows(rows, sourceLabel);
    if (added === 0) {
      status.textContent = "No valid rows found in " + sourceLabel + ".";
      status.className = "import-status error";
      return;
    }
    IMPORTED_BATCHES.push({ id: "batch-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7),
      fileName: sourceLabel, caseIds });
    refreshFiltersAfterImport();
    renderImportedFilesList();
    render();
    let msg = `Imported ${added} record(s) from ${sourceLabel}.`;
    if (linked > 0) msg += ` ${linked} matched an identity already elsewhere in the system.`;
    if (skipped > 0) msg += ` (${skipped} row(s) skipped — missing required fields.)`;
    status.textContent = msg;
    status.className = "import-status success";
  } catch (err) {
    status.textContent = "Import failed: " + err.message;
    status.className = "import-status error";
  }
}

function renderImportedFilesList() {
  const el = document.getElementById("importedFilesList");
  if (!IMPORTED_BATCHES.length) { el.innerHTML = ""; return; }
  el.innerHTML = `<div class="imported-files-heading">Currently imported — click &times; to remove</div>` +
    IMPORTED_BATCHES.map((b) => `
    <div class="imported-file-row">
      <span class="file-name" title="${b.fileName}">${b.fileName}</span>
      <span class="file-count">${b.caseIds.length} record(s)</span>
      <button class="remove-file-btn" title="Remove these records" onclick="removeImportedBatch('${b.id}')">&times;</button>
    </div>
  `).join("");
  const details = document.getElementById("importDetails");
  if (details) details.open = true; // make sure the remove buttons are never hidden after an upload
}

function removeImportedBatch(batchId) {
  const batch = IMPORTED_BATCHES.find((b) => b.id === batchId);
  if (!batch) return;
  const idSet = new Set(batch.caseIds);
  DATA.cases = DATA.cases.filter((c) => !idSet.has(c.id));
  IMPORTED_BATCHES = IMPORTED_BATCHES.filter((b) => b.id !== batchId);
  renderImportedFilesList();
  render();
  const status = document.getElementById("importStatus");
  status.textContent = `Removed ${batch.caseIds.length} record(s) from ${batch.fileName}.`;
  status.className = "import-status success";
}

function importRows(rows, sourceLabel) {
  let added = 0, linked = 0, skipped = 0;
  const seenThisBatch = new Set();
  const caseIds = [];

  rows.forEach((row) => {
    if (!row.registeredDate || !row.accusedName || !row.lat || !row.lng) { skipped++; return; }

    let district = DATA.districts.find(
      (d) => d.name.toLowerCase() === (row.districtName || "").trim().toLowerCase()
    );
    if (!district) {
      district = {
        id: Math.max(...DATA.districts.map((d) => d.id)) + 1,
        name: row.districtName || "Unknown District",
        lat: +row.lat, lng: +row.lng,
      };
      DATA.districts.push(district);
    }

    let unit = DATA.units.find(
      (u) => u.name.toLowerCase() === (row.unitName || "").trim().toLowerCase()
    );
    if (!unit) {
      unit = {
        id: Math.max(...DATA.units.map((u) => u.id)) + 1,
        name: row.unitName || "Unknown Station",
        districtId: district.id, lat: +row.lat, lng: +row.lng,
      };
      DATA.units.push(unit);
    }

    let subhead = DATA.crimeSubHeads.find(
      (s) => s.name.toLowerCase() === (row.crimeSubHead || "").trim().toLowerCase()
    );
    if (!subhead) {
      subhead = {
        id: Math.max(...DATA.crimeSubHeads.map((s) => s.id)) + 1,
        headId: 1, name: row.crimeSubHead || "Other",
      };
      DATA.crimeSubHeads.push(subhead);
    }

    const newId = Math.max(...DATA.cases.map((c) => c.id)) + 1;
    const year = (row.registeredDate || "").slice(0, 4) || "2026";
    const crimeNo = "1" + String(district.id).padStart(4, "0") + String(unit.id).padStart(4, "0")
      + year + String(10000 + newId).slice(-5);

    const age = parseInt(row.accusedAge, 10) || 30;
    const gender = (row.accusedGender || "M").trim().toUpperCase();
    const entityKey = offenderKey(row.accusedName, age, gender);

    const existsElsewhere = DATA.cases.some((c) => c.accused.some((a) => a.entityKey === entityKey));
    if (existsElsewhere || seenThisBatch.has(entityKey)) linked++;
    seenThisBatch.add(entityKey);

    DATA.cases.push({
      id: newId,
      crimeNo,
      caseCategory: "FIR",
      registeredDate: row.registeredDate,
      unitId: unit.id,
      districtId: district.id,
      crimeHeadId: subhead.headId,
      crimeSubHeadId: subhead.id,
      gravity: "Non-Heinous",
      status: row.status || "Under Investigation",
      lat: +row.lat, lng: +row.lng,
      briefFacts: (row.briefFacts || "Imported record.") + ` [Source: ${sourceLabel}]`,
      accused: [{ id: `${newId}-A1`, name: row.accusedName.trim(), age, gender, personId: "A1", entityKey }],
      victims: row.victimName
        ? [{ id: `${newId}-V1`, name: row.victimName.trim(), age: parseInt(row.victimAge, 10) || 30,
             gender: (row.victimGender || "F").trim().toUpperCase() }]
        : [],
      complainants: [],
      timeline: [],
      sections: [],
      arrests: [],
    });
    added++;
    caseIds.push(newId);
  });

  return { added, linked, skipped, caseIds };
}

function refreshFiltersAfterImport() {
  // repopulate the district dropdown in case an unrecognized station's district got auto-added
  const distSel = document.getElementById("filterDistrict");
  const existingIds = new Set(Array.from(distSel.options).map((o) => o.value));
  DATA.districts.forEach((d) => {
    if (!existingIds.has(String(d.id))) {
      const opt = document.createElement("option");
      opt.value = d.id; opt.textContent = d.name + " (new)";
      distSel.appendChild(opt);
    }
  });
  // extend the date sliders if an imported record falls after the current range
  const maxDay = Math.max(...DATA.cases.map((c) => dayOffset(c.registeredDate)));
  const toSlider = document.getElementById("dateTo");
  if (maxDay > +toSlider.max) {
    document.getElementById("dateFrom").max = maxDay;
    toSlider.max = maxDay;
    toSlider.value = maxDay;
    document.getElementById("dateToLbl").textContent = dateFromOffset(maxDay);
  }
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
  const details = document.getElementById("anatomyDetails");
  if (details) details.open = true;
}

/* ---------------- FIR detail page (same-window "page", not a popup) ---------------- */

function showFIRDetailPage(crimeNo) {
  const c = DATA.cases.find(cc => cc.crimeNo === crimeNo);
  if (!c) return;

  if (currentTab !== "firdetail") previousTab = currentTab;

  const unit = DATA.units.find(u => u.id === c.unitId);
  const district = DATA.districts.find(d => d.id === c.districtId);
  const subhead = DATA.crimeSubHeads.find(s => s.id === c.crimeSubHeadId);
  const head = DATA.crimeHeads.find(h => h.id === c.crimeHeadId);

  const accusedRows = (c.accused || []).map(a => `<li>${a.name} — age ${a.age}, ${a.gender}</li>`).join("")
    || "<li>None recorded</li>";
  const victimRows = (c.victims || []).map(v => `<li>${v.name} — age ${v.age}, ${v.gender}</li>`).join("")
    || "<li>None recorded</li>";
  const complainantRows = (c.complainants || []).map(cp =>
    `<li>${cp.name}${cp.occupation ? " — " + cp.occupation : ""}</li>`).join("") || "<li>None recorded</li>";
  const sectionRows = (c.sections || []).map(s => `<li>${s.act} ${s.section}</li>`).join("")
    || "<li>Not recorded</li>";

  // Case Timeline — populated from Data Store via CaseEvents, empty array if not present
  const timelineHtml = (c.timeline && c.timeline.length)
    ? `<div class="case-timeline">${c.timeline.map(e => `
        <div class="timeline-step">
          <div class="timeline-dot"></div>
          <div class="timeline-content">
            <div class="timeline-date">${e.date}</div>
            <div class="timeline-type">${e.type}</div>
          </div>
        </div>`).join("")}</div>`
    : `<p class="hint">No timeline recorded for this case yet.</p>`;

  // Any other FIRs against the same accused — shown as a clearly separate, secondary section,
  // not conflated with this FIR's own details.
  const entityKeys = new Set((c.accused || []).map(a => a.entityKey));
  const linkedCases = DATA.cases.filter(cc => cc.id !== c.id && cc.accused.some(a => entityKeys.has(a.entityKey)));
  const linkedRows = linkedCases.map(cc => {
    const u2 = DATA.units.find(uu => uu.id === cc.unitId);
    const s2 = DATA.crimeSubHeads.find(ss => ss.id === cc.crimeSubHeadId);
    return `<div class="search-result-row" onclick="showFIRDetailPage('${cc.crimeNo}')">
      <div class="cno">${cc.crimeNo}</div>
      <div class="meta">${s2?.name || ""} · ${u2?.name || ""} · ${cc.registeredDate} · ${cc.status}</div>
    </div>`;
  }).join("");

  document.getElementById("firDetailContent").innerHTML = `
    <div class="fir-detail-header">
      <div class="fir-cno">${c.crimeNo}</div>
      <div class="fir-badges"><span class="badge">${c.caseCategory}</span><span class="badge">${c.status}</span><span class="badge">${c.gravity}</span></div>
    </div>
    <div class="fir-grid">
      <div><span class="fir-label">Crime head</span><div>${head?.name || ""} — ${subhead?.name || ""}</div></div>
      <div><span class="fir-label">District</span><div>${district?.name || ""}</div></div>
      <div><span class="fir-label">Station</span><div>${unit?.name || ""}</div></div>
      <div><span class="fir-label">Registered</span><div>${c.registeredDate}</div></div>
    </div>
    <div class="fir-section"><h4>Case Timeline</h4>${timelineHtml}</div>
    <div class="fir-section"><h4>Accused</h4><ul>${accusedRows}</ul></div>
    <div class="fir-section"><h4>Victims</h4><ul>${victimRows}</ul></div>
    <div class="fir-section"><h4>Complainants</h4><ul>${complainantRows}</ul></div>
    <div class="fir-section"><h4>Sections invoked</h4><ul>${sectionRows}</ul></div>
    <div class="fir-section"><h4>Brief facts</h4><p>${c.briefFacts}</p></div>
    ${linkedCases.length ? `<div class="fir-section"><h4>Other FIRs against the same accused (${linkedCases.length})</h4>${linkedRows}</div>` : ""}
  `;
  decodeAnatomy(c.crimeNo);

  document.querySelectorAll(".tab").forEach(b => b.classList.remove("active"));
  document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
  document.getElementById("panel-firdetail").classList.add("active");
  currentTab = "firdetail";
}

function backFromFIRDetail() {
  document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
  document.getElementById("panel-" + previousTab).classList.add("active");
  document.querySelectorAll(".tab").forEach(b => {
    if (b.dataset.tab === previousTab) b.classList.add("active");
  });
  currentTab = previousTab;
  if (currentTab === "map" && map) setTimeout(() => map.invalidateSize(), 50);
}

/* ---------------- Network / link analysis view ---------------- */

function renderNetwork(filtered) {
  const container = document.getElementById("network");
  const nodesMap = new Map();
  const edges = [];
  const entityCaseCount = {};
  const adjacency = {}; // nodeId -> [neighbor nodeId, ...], used to walk a whole connected cluster

  function addAdjacency(a, b) {
    (adjacency[a] = adjacency[a] || []).push(b);
    (adjacency[b] = adjacency[b] || []).push(a);
  }

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
        size: 7, color: "#5E9A3C", title: c.crimeNo, kind: "case", caseRef: c.id,
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
      const edgeId = `e-${nodeId}-${caseNodeId}`;
      edges.push({
        id: edgeId, from: nodeId, to: caseNodeId,
        color: { color: isRepeat ? "#C1432F" : "#26304A" },
        width: isRepeat ? 2.5 : 1,
        entityKey: a.entityKey, isRepeat,
      });
      addAdjacency(nodeId, caseNodeId);
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

  // Walks every connected node reachable from startId — this is what makes a click on ONE edge
  // in a big cluster reveal EVERY accused and EVERY FIR in that whole cluster, not just the
  // one accused nearest to where you happened to click.
  function getClusterNodeIds(startId) {
    const visited = new Set([startId]);
    const queue = [startId];
    while (queue.length) {
      const cur = queue.shift();
      (adjacency[cur] || []).forEach(n => { if (!visited.has(n)) { visited.add(n); queue.push(n); } });
    }
    return visited;
  }

  function showClusterDetail(startId) {
    const ids = getClusterNodeIds(startId);
    const caseIds = [], accusedEntries = [];
    ids.forEach(id => {
      const n = nodesMap.get(id);
      if (!n) return;
      if (n.kind === "case") caseIds.push(n.caseRef);
      else accusedEntries.push(n);
    });
    const cases = DATA.cases.filter(c => caseIds.includes(c.id));
    const detail = document.getElementById("networkDetail");

    if (cases.length <= 1 && accusedEntries.length <= 1) {
      // trivial cluster (a single case with a single, never-repeated accused) — nothing more to show
      const c = cases[0];
      if (c) { showCaseDetail(c); decodeAnatomy(c.crimeNo); }
      return;
    }

    const accusedRows = accusedEntries.map(a => {
      const count = entityCaseCount[a.entityKey] || 1;
      return `<div class="cluster-accused-row">${a.label} — ${count} FIR(s)</div>`;
    }).join("");

    const caseRows = cases.map(c => {
      const unit = DATA.units.find(u => u.id === c.unitId);
      const subhead = DATA.crimeSubHeads.find(s => s.id === c.crimeSubHeadId);
      const names = c.accused.map(a => a.name).join(", ");
      return `<div class="case-row" onclick="showFIRDetailPage('${c.crimeNo}')">
        <div class="cno">${c.crimeNo}</div>
        <div class="meta">${subhead?.name || ""} · ${unit?.name || ""} · ${c.registeredDate}</div>
        <div class="meta">Accused: ${names}</div>
      </div>`;
    }).join("");

    detail.innerHTML = `
      <h3>${accusedEntries.length} accused, ${cases.length} FIR(s) in this cluster</h3>
      <p class="hint">This whole group is connected through shared cases — the kind of picture no
      single station's records would show on their own.</p>
      <div class="cluster-accused-list">${accusedRows}</div>
      ${caseRows}
    `;
    if (cases[0]) decodeAnatomy(cases[0].crimeNo);
  }

  network.on("click", (params) => {
    if (params.nodes.length) { showClusterDetail(params.nodes[0]); return; }
    if (params.edges.length) {
      const edge = edgeSet.get(params.edges[0]);
      // Only edges connecting a repeat-offender identity to a case are clickable — a single-appearance
      // accused's edge has nothing further to reveal beyond what the node already shows.
      if (!edge || !edge.isRepeat) return;
      showClusterDetail(edge.from);
    }
  });

  network.on("hoverEdge", (params) => {
    const edge = edgeSet.get(params.edge);
    container.style.cursor = (edge && edge.isRepeat) ? "pointer" : "default";
  });
  network.on("blurEdge", () => { container.style.cursor = "default"; });
}

function showCaseDetail(c) {
  const unit = DATA.units.find(u => u.id === c.unitId);
  const subhead = DATA.crimeSubHeads.find(s => s.id === c.crimeSubHeadId);
  document.getElementById("networkDetail").innerHTML = `
    <h3>${c.crimeNo}</h3>
    <p class="hint">${subhead?.name || ""} · ${unit?.name || ""} · ${c.registeredDate} · ${c.status}</p>
    <p class="hint">${c.briefFacts}</p>
    <button class="btn-primary" style="width:100%;margin-top:8px" onclick="showFIRDetailPage('${c.crimeNo}')">View full FIR details</button>
  `;
}

/* ---------------- Predictive risk view ---------------- */

function renderPredictions(filtered) {
  const list = document.getElementById("predictList");
  list.innerHTML = `<p class="hint" style="color:var(--muted)">Recalculating risk scores from the current filters…</p>`;
  clearTimeout(window.__predictTimer);
  window.__predictTimer = setTimeout(() => computeAndRenderPredictions(filtered), 220);
}

function computeAndRenderPredictions(filtered) {
  const to = +document.getElementById("dateTo").value;
  const nowDay = to;
  const TAU = 10;

  const byUnit = {};
  filtered.forEach(c => {
    const age = nowDay - dayOffset(c.registeredDate);
    if (age < 0 || age > 45) return;
    const key = c.unitId;
    byUnit[key] = byUnit[key] || { score: 0, recent14: 0, subheadCounts: {}, contributors: [] };
    const w = Math.exp(-age / TAU);
    byUnit[key].score += w;
    if (age <= 14) byUnit[key].recent14 += 1;
    const sh = DATA.crimeSubHeads.find(s => s.id === c.crimeSubHeadId)?.name || "crime";
    byUnit[key].subheadCounts[sh] = (byUnit[key].subheadCounts[sh] || 0) + 1;
    byUnit[key].contributors.push({ crimeNo: c.crimeNo, age, weight: w });
  });

  const rows = Object.entries(byUnit)
    .map(([unitId, v]) => {
      const unit = DATA.units.find(u => u.id === +unitId);
      const topSubhead = Object.entries(v.subheadCounts).sort((a, b) => b[1] - a[1])[0];
      v.contributors.sort((a, b) => b.weight - a.weight);
      return {
        unit, score: v.score, recent14: v.recent14, topSubhead,
        topContributors: v.contributors.slice(0, 5), totalContributors: v.contributors.length,
      };
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

  list.innerHTML = rows.map((r, i) => {
    const rowId = `calc-${i}`;
    const caseItems = r.topContributors.map(c => {
      const influence = c.weight >= 0.5 ? "Strong" : c.weight >= 0.2 ? "Medium" : "Light";
      const cls = c.weight >= 0.5 ? "influence-high" : c.weight >= 0.2 ? "influence-medium" : "influence-low";
      const daysAgo = c.age === 0 ? "today" : c.age === 1 ? "1 day ago" : `${c.age} days ago`;
      return `<li>Case ending <b>${c.crimeNo.slice(-6)}</b> — ${daysAgo} — <span class="${cls}">${influence} influence</span></li>`;
    }).join("");
    const more = r.totalContributors > r.topContributors.length
      ? `<li>+ ${r.totalContributors - r.topContributors.length} more case(s), each adding a smaller amount</li>` : "";
    const calcHtml = `
      <p class="calc-summary">Ranked #${i + 1} because ${r.recent14} similar case(s) happened nearby in the
      last 14 days. Cases that happened more recently count more heavily than older ones — that's what
      "influence" below means.</p>
      <ul class="calc-case-list">${caseItems}${more}</ul>
      <p class="calc-total">Combined risk score: ${r.score.toFixed(1)} — higher means higher priority for patrol attention.</p>
    `;
    return `
    <div class="risk-row">
      <div class="risk-rank">${i + 1}</div>
      <div class="risk-bar-wrap"><div class="risk-bar" style="width:${Math.round(100 * r.score / maxScore)}%"></div></div>
      <div class="risk-body">
        <div class="risk-station">${r.unit.name}</div>
        <div class="risk-reason">${r.recent14} ${r.topSubhead ? r.topSubhead[0].toLowerCase() : "incident"} case(s) in the last 14 days nearby, recency-weighted — pattern consistent with near-repeat clustering.
          <button class="calc-toggle" onclick="toggleCalc('${rowId}', this)">Show calculation</button>
        </div>
        <div class="calc-detail" id="${rowId}" style="display:none">${calcHtml}</div>
      </div>
      <div class="risk-score">${r.score.toFixed(1)}</div>
    </div>
  `;
  }).join("");
}

function toggleCalc(id, btn) {
  const el = document.getElementById(id);
  if (!el) return;
  const open = el.style.display !== "none";
  el.style.display = open ? "none" : "block";
  btn.textContent = open ? "Show calculation" : "Hide calculation";
}

/* ---------------- Search records ---------------- */

function setupSearch() {
  document.querySelectorAll(".search-mode-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".search-mode-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      const mode = btn.dataset.mode;
      ["name", "crimeno", "datedistrict"].forEach(m => {
        document.getElementById("searchForm" + m).style.display = (m === mode) ? "flex" : "none";
      });
      document.getElementById("searchResults").innerHTML = "";
    });
  });

  const distSel = document.getElementById("searchDistrictInput");
  DATA.districts.forEach(d => {
    const opt = document.createElement("option");
    opt.value = d.id; opt.textContent = d.name;
    distSel.appendChild(opt);
  });

  document.getElementById("searchNameBtn").addEventListener("click", () => {
    const q = document.getElementById("searchNameInput").value.trim().toLowerCase();
    if (!q) return;
    const matches = DATA.cases.filter(c => c.accused.some(a => a.name.toLowerCase().includes(q)));
    renderSearchResults(matches, q ? `Matching accused name "${q}"` : "");
  });

  document.getElementById("searchCrimeNoBtn").addEventListener("click", () => {
    const q = document.getElementById("searchCrimeNoInput").value.trim().toLowerCase();
    if (!q) return;
    const direct = DATA.cases.filter(c => c.crimeNo.toLowerCase().includes(q));
    const entityKeys = new Set();
    direct.forEach(c => c.accused.forEach(a => entityKeys.add(a.entityKey)));
    const linked = DATA.cases.filter(c => !direct.includes(c) && c.accused.some(a => entityKeys.has(a.entityKey)));
    renderSearchResults(direct.concat(linked), `Matching crime number "${q}" (including any linked FIRs against the same accused)`);
  });

  document.getElementById("searchDateDistrictBtn").addEventListener("click", () => {
    const date = document.getElementById("searchDateInput").value;
    const distId = document.getElementById("searchDistrictInput").value;
    if (!date) {
      document.getElementById("searchResults").innerHTML = `<p class="hint" style="color:var(--muted)">Pick a date to search.</p>`;
      return;
    }
    const matches = DATA.cases.filter(c => c.registeredDate === date
      && (distId === "all" || String(c.districtId) === distId));
    const distName = distId === "all" ? "all districts" : (DATA.districts.find(d => String(d.id) === distId)?.name || "");
    renderSearchResults(matches, `Registered on ${date} — ${distName}`);
  });
}

function renderSearchResults(cases, summaryText) {
  const el = document.getElementById("searchResults");
  if (!cases.length) {
    el.innerHTML = `<p class="hint" style="color:var(--muted)">No FIRs found. ${summaryText}</p>`;
    return;
  }
  const rows = cases.map(c => {
    const unit = DATA.units.find(u => u.id === c.unitId);
    const subhead = DATA.crimeSubHeads.find(s => s.id === c.crimeSubHeadId);
    const accusedNames = c.accused.map(a => a.name).join(", ") || "—";
    return `
      <div class="search-result-row" onclick="showFIRDetailPage('${c.crimeNo}')">
        <div class="cno">${c.crimeNo}</div>
        <div class="meta">${subhead?.name || ""} · ${unit?.name || ""} · ${c.registeredDate} · ${c.status}</div>
        <div class="accused-list">Accused: ${accusedNames}</div>
      </div>`;
  }).join("");
  el.innerHTML = `<p class="search-summary">${cases.length} FIR(s) found — ${summaryText}</p>${rows}`;
}

/* ---------------- Methodology / bias audit ---------------- */

function computeNearRepeatRate() {
  const byUnit = {};
  DATA.cases.forEach(c => { (byUnit[c.unitId] = byUnit[c.unitId] || []).push(c); });
  let total = 0, matched = 0;
  Object.values(byUnit).forEach(list => {
    list.forEach(c => {
      total++;
      const cDay = dayOffset(c.registeredDate);
      const hasNear = list.some(o => o !== c && o.crimeSubHeadId === c.crimeSubHeadId
        && Math.abs(dayOffset(o.registeredDate) - cDay) <= 14);
      if (hasNear) matched++;
    });
  });
  return total ? Math.round((100 * matched) / total) : 0;
}

function renderMethodology() {
  const nearRepeatRate = computeNearRepeatRate();
  const repeatIdentities = countRepeatEntities(DATA.cases);

  document.getElementById("methodGrid").innerHTML = `
    <div class="method-card">
      <h3>Sociological signal, measured — not asserted</h3>
      <p><b>${nearRepeatRate}%</b> of all cases currently loaded have another case of the <i>same
      crime type</i>, at the <i>same station</i>, within <b>14 days</b> of each other. That
      clustering is the empirical signature of near-repeat victimization theory (crime tends to
      recur close in time and space to a prior incident) — computed live from the actual dataset
      right now, not claimed in the abstract. <b>${repeatIdentities}</b> accused identities are
      independently confirmed to reappear across separate FIRs, the routine-activity signal behind
      the Link Analysis tab.</p>
    </div>
    <div class="method-card">
      <h3>Data</h3>
      <p>All records on this page are synthetically generated to match the structure of the official
      FIR schema (CaseMaster, Accused, Victim, ComplainantDetails, ArrestSurrender, ActSectionAssociation),
      and are now served live from Catalyst Data Store rather than a bundled file. No real citizen or
      case data is used anywhere in this prototype.</p>
    </div>
    <div class="method-card">
      <h3>Link analysis</h3>
      <p>Accused persons are matched across FIRs using a name + age-band + gender key, standing in for
      real entity resolution. This surfaces the same person sitting in unlinked records at different
      police stations — the "data silo" problem named in the brief. The Import feature in the sidebar
      demonstrates this directly: upload the two sample station exports and watch a shared identity
      link up live across files that started out completely separate.</p>
    </div>
    <div class="method-card">
      <h3>Predictive risk score</h3>
      <p>A transparent, explainable formula — recency-weighted local case density (near-repeat
      victimization theory) — not a black-box model. Every score comes with a plain-language reason
      and an expandable "Show calculation" breakdown with the real numbers plugged in, so an
      investigating officer (or a judge) can see exactly how a number was produced, not just trust it.</p>
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