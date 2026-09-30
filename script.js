/* Mapbox public token */
mapboxgl.accessToken = "pk.eyJ1IjoiZGFya3Jvc2UyNSIsImEiOiJjbXVsYTlodGUwMXc4MnhyMTNyanI0cG1rIn0.6u_VFb4AzPL0MACkAgVuNQ";

/* Fictional demo vehicles around SUIIT, Burla */
let vehicles = [
  { id: "AMB-001", type: "ambulance", driver: "Raj Kumar", phone: "+91 90000 00001", lng: 83.8868, lat: 21.4858, available: true },
  { id: "AMB-002", type: "ambulance", driver: "Amit Das", phone: "+91 90000 00002", lng: 83.8819, lat: 21.4808, available: true },
  { id: "AMB-003", type: "ambulance", driver: "Rahul Singh", phone: "+91 90000 00003", lng: 83.8910, lat: 21.4885, available: false },
  { id: "FIRE-001", type: "fire", driver: "Suresh Patnaik", phone: "+91 90000 00004", lng: 83.8788, lat: 21.4902, available: true }
];

const $ = id => document.getElementById(id);
const panel = $("emergencyPanel");
const results = $("results");
const mapBox = $("map");
const driverPanel = $("driverPanel");

let map = null;
let emergencyLocation = null;
let emergencyMarker = null;
let vehicleMarkers = [];
let selectedVehicle = null;
let routeData = [];
let movingMarker = null;
let moveTimer = null;
let animationRun = 0;

/* Update dashboard counts */
function updateCounts() {
  $("ambulanceNumber").textContent =
    vehicles.filter(v => v.type === "ambulance" && v.available).length;
  $("fireNumber").textContent =
    vehicles.filter(v => v.type === "fire" && v.available).length;
}
updateCounts();

/* Open emergency panel */
$("startButton").onclick = () => {
  panel.classList.remove("hidden");
  panel.scrollIntoView({ behavior: "smooth", block: "start" });

  initMap();

  setTimeout(() => {
    if (map) map.resize();
  }, 300);
};

/* Initialize Mapbox once */
function initMap() {
  if (map) return;

  map = new mapboxgl.Map({
    container: "map",
    style: mapStyle(),
    center: [83.88427, 21.48383],
    zoom: 14
  });

  map.addControl(new mapboxgl.NavigationControl(), "top-right");

  /* style.load also fires after a theme switch, so layers are restored */
  map.on("style.load", () => {
    addTrafficLayer();
    redrawRoutes();
  });
  map.on("load", () => map.resize());

  map.on("error", event => {
    console.warn("Mapbox error:", event.error);
  });
}

/* Add traffic visualization */
function addTrafficLayer() {
  if (!map || map.getSource("live-traffic")) return;

  map.addSource("live-traffic", {
    type: "vector",
    url: "mapbox://mapbox.mapbox-traffic-v1"
  });

  map.addLayer({
    id: "live-traffic-layer",
    type: "line",
    source: "live-traffic",
    "source-layer": "traffic",
    layout: {
      "line-join": "round",
      "line-cap": "round"
    },
    paint: {
      "line-width": [
        "interpolate", ["linear"], ["zoom"],
        10, 2, 14, 3, 18, 6
      ],
      "line-color": [
        "match", ["get", "congestion"],
        "low", "#22c55e",
        "moderate", "#facc15",
        "heavy", "#f97316",
        "severe", "#ef4444",
        "#64748b"
      ],
      "line-opacity": 0.72
    }
  });

  addTrafficLegend();
}

/* Traffic legend */
function addTrafficLegend() {
  if (mapBox.querySelector(".traffic-legend")) return;

  const legend = document.createElement("div");
  legend.className = "traffic-legend";
  legend.innerHTML = `
    <div class="traffic-legend-title">TRAFFIC LEVEL</div>
    <div class="traffic-item"><span class="traffic-line traffic-low"></span>Low</div>
    <div class="traffic-item"><span class="traffic-line traffic-moderate"></span>Moderate</div>
    <div class="traffic-item"><span class="traffic-line traffic-heavy"></span>Heavy</div>
    <div class="traffic-item"><span class="traffic-line traffic-severe"></span>Severe</div>
  `;
  mapBox.appendChild(legend);
}

/* Convert typed location to coordinates */
async function geocode(query) {
  const q = query.toLowerCase().trim();

  if (q.includes("suiit") || q.includes("jyoti vihar")) {
    return [83.88427, 21.48383];
  }

  const url =
    `https://api.mapbox.com/search/geocode/v6/forward?q=${encodeURIComponent(query)}&limit=1&country=IN&access_token=${mapboxgl.accessToken}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error("Location search failed");

  const data = await res.json();
  if (!data.features?.length) throw new Error("Location not found");

  return data.features[0].geometry.coordinates;
}

/* Find location and vehicles */
$("findButton").onclick = async () => {
  const query = $("locationInput").value.trim();

  if (!query) {
    results.innerHTML = `
      <div class="vehicle">
        <strong>⚠️ Location required</strong>
        <p class="map-note">Please enter the emergency location.</p>
      </div>`;
    return;
  }

  $("findButton").disabled = true;
  $("findButton").textContent = "Searching location...";

  try {
    initMap();
    emergencyLocation = pendingCoords || await geocode(query);

    showEmergencyLocation();
    renderNearbyVehicles();
    await registerEmergency(query);
  } catch (error) {
    console.error(error);
    results.innerHTML = `
      <div class="vehicle">
        <strong>❌ Location not found</strong>
        <p class="map-note">Try a more specific place, such as "SUIIT Burla, Sambalpur".</p>
      </div>`;
  } finally {
    $("findButton").disabled = false;
    $("findButton").textContent = "📍 Find Location & Nearby Vehicles";
  }
};

/* Display emergency marker */
function showEmergencyLocation() {
  mapBox.classList.remove("hidden");
  $("mapNote").classList.remove("hidden");

  setTimeout(() => {
    if (map) map.resize();
  }, 100);

  if (emergencyMarker) {
    emergencyMarker.remove();
    emergencyMarker = null;
  }

  const el = document.createElement("div");
  el.className = "marker emergency-marker";
  el.textContent = "🚨";

  emergencyMarker = new mapboxgl.Marker(el)
    .setLngLat(emergencyLocation)
    .setPopup(new mapboxgl.Popup().setHTML("<b>Emergency Location</b>"))
    .addTo(map);

  map.flyTo({
    center: emergencyLocation,
    zoom: 13,
    essential: true
  });
}

/* Calculate straight-line distance */
function distance(a, b) {
  const R = 6371;
  const rad = x => x * Math.PI / 180;
  const dLat = rad(b[1] - a[1]);
  const dLng = rad(b[0] - a[0]);

  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a[1])) *
    Math.cos(rad(b[1])) *
    Math.sin(dLng / 2) ** 2;

  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

/* Show nearby available vehicles */
function renderNearbyVehicles() {
  vehicleMarkers.forEach(marker => marker.remove());
  vehicleMarkers = [];

  const requiredType =
    $("emergencyType").value === "fire" ? "fire" : "ambulance";

  const nearby = vehicles
    .filter(v => v.type === requiredType && v.available)
    .map(v => ({
      ...v,
      distance: distance(emergencyLocation, [v.lng, v.lat])
    }))
    .sort((a, b) => a.distance - b.distance);

  if (!nearby.length) {
    results.innerHTML = `
      <div class="vehicle">
        <strong>❌ No vehicle available</strong>
        <p class="map-note">There are currently no available vehicles of this type.</p>
      </div>`;
    return;
  }

  nearby.forEach(v => {
    const el = document.createElement("div");
    el.className = "marker vehicle-marker";
    el.textContent = v.type === "fire" ? "🚒" : "🚑";

    const marker = new mapboxgl.Marker(el)
      .setLngLat([v.lng, v.lat])
      .setPopup(
        new mapboxgl.Popup().setHTML(
          `<b>${v.id}</b><br>${v.driver}<br>${v.distance.toFixed(1)} km away`
        )
      )
      .addTo(map);

    el.addEventListener("click", () => selectVehicle(v));
    vehicleMarkers.push(marker);
  });

  results.innerHTML = `
    <div class="results-title">Nearby registered vehicles</div>
    ${nearby.map((v, i) => `
      <div class="vehicle ${i === 0 ? "recommended" : ""}">
        <div class="vehicle-top">
          <div class="vehicle-name">
            ${v.type === "fire" ? "🚒" : "🚑"} ${v.id}${i === 0 ? '<span class="recommended-label">NEAREST</span>' : ""}
          </div>
          <div class="available">● AVAILABLE</div>
        </div>

        <div class="vehicle-details">
          <div class="detail"><small>DRIVER</small><strong>${v.driver}</strong></div>
          <div class="detail"><small>PHONE</small><strong>${v.phone}</strong></div>
          <div class="detail"><small>STRAIGHT-LINE DISTANCE</small><strong>${v.distance.toFixed(1)} km</strong></div>
          <div class="detail"><small>STATUS</small><strong>Ready to dispatch</strong></div>
        </div>

        <button class="request" data-id="${v.id}">
          ${i === 0 ? "⭐ Request Nearest Vehicle" : "Request Vehicle"}
        </button>
      </div>
    `).join("")}
  `;
}

/* Focus map on selected vehicle */
function selectVehicle(vehicle) {
  map.flyTo({
    center: [vehicle.lng, vehicle.lat],
    zoom: 15
  });

  showVehiclePopup(vehicle);
}

function showVehiclePopup(vehicle) {
  new mapboxgl.Popup({ offset: 25 })
    .setLngLat([vehicle.lng, vehicle.lat])
    .setHTML(
      `<b>${vehicle.type === "fire" ? "🚒" : "🚑"} ${vehicle.id}</b><br>${vehicle.driver}<br><small>Available for dispatch</small>`
    )
    .addTo(map);
}

/* Handle request buttons */
results.addEventListener("click", event => {
  const button = event.target.closest(".request");
  if (!button) return;

  const vehicle = vehicles.find(v => v.id === button.dataset.id);
  if (vehicle && vehicle.available) {
    showDriverRequest(vehicle);
  }
});

/* Simulated driver notification */
function showDriverRequest(vehicle) {
  selectedVehicle = vehicle;
  driverPanel.classList.remove("hidden");

  driverPanel.innerHTML = `
    <h3>📲 Driver Notification</h3>
    <p>
      <strong>${vehicle.driver}</strong> (${vehicle.id}) has received an emergency request.
      The driver can accept or decline the request.
    </p>
    <div class="driver-actions">
      <button class="accept" id="acceptRequest">✓ Accept Request</button>
      <button class="decline" id="declineRequest">✕ Decline</button>
    </div>
  `;

  driverPanel.scrollIntoView({ behavior: "smooth", block: "center" });

  $("acceptRequest").onclick = () => acceptRequest(vehicle);
  $("declineRequest").onclick = () => {
    driverPanel.innerHTML = `
      <h3>Request Declined</h3>
      <p>${vehicle.driver} declined the request. Choose another available vehicle.</p>
    `;
    selectedVehicle = null;
  };
}

/* Driver accepts request */
async function acceptRequest(vehicle) {
  if (!vehicle.available) return;

  vehicle.available = false;
  selectedVehicle = vehicle;
  updateCounts();
  apiDispatch(vehicle);

  driverPanel.innerHTML = `
    <h3>✓ Request Accepted</h3>
    <p>${vehicle.driver} accepted the emergency request. Calculating a traffic-aware route...</p>
  `;

  results.innerHTML = `
    <div class="success">
      <div class="success-icon">✓</div>
      <h2>Vehicle Dispatched</h2>
      <p>${vehicle.id} is on the way to the emergency.</p>
    </div>
  `;

  await drawRoute(vehicle);
}

/* Calculate traffic-aware routes */
async function drawRoute(vehicle) {
  const start = `${vehicle.lng},${vehicle.lat}`;
  const end = `${emergencyLocation[0]},${emergencyLocation[1]}`;

  const url =
    `https://api.mapbox.com/directions/v5/mapbox/driving-traffic/${start};${end}` +
    `?alternatives=true&geometries=geojson&overview=full&annotations=duration,distance,congestion` +
    `&access_token=${mapboxgl.accessToken}`;

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error("Directions request failed");

    const data = await res.json();
    if (!data.routes?.length) throw new Error("No route returned");

    /* Remove any previous route layers before replacing route data */
    clearRouteLayers();

    routeData = data.routes;

    /* Draw route alternatives */
    routeData.forEach((route, i) => {
      const id = `emergency-route-${i}`;

      map.addSource(id, {
        type: "geojson",
        data: {
          type: "Feature",
          geometry: route.geometry,
          properties: {}
        }
      });

      map.addLayer({
        id,
        type: "line",
        source: id,
        layout: {
          "line-join": "round",
          "line-cap": "round"
        },
        paint: {
          "line-color": i === 0 ? "#ff4545" : "#64748b",
          "line-width": i === 0 ? 7 : 4,
          "line-opacity": i === 0 ? .95 : .65
        }
      });
    });

    /* Fit map to routes */
    const bounds = new mapboxgl.LngLatBounds();
    routeData.forEach(route => {
      route.geometry.coordinates.forEach(coord => bounds.extend(coord));
    });
    map.fitBounds(bounds, { padding: 80 });

    /* Create the panel before rendering route choices */
    driverPanel.innerHTML = `
      <h3>🚑 Live Dispatch</h3>
      <p><strong>${vehicle.driver}</strong> accepted the request.</p>
      <div class="dispatch-status">
        <span class="live-dot"></span> Vehicle en route to emergency
      </div>
      <div id="routeOptions" class="route-options"></div>
      <div id="routeInfo" class="route-info"></div>
    `;

    renderRouteOptions();
  } catch (error) {
    console.error("Route error:", error);
    driverPanel.innerHTML = `
      <h3>⚠️ Route unavailable</h3>
      <p>The vehicle request was accepted, but the route could not be calculated. Check your Mapbox Directions access and try again.</p>
      <button class="back-home" onclick="returnHome()">← Back to Home</button>
    `;
  }
}

/* Remove route layers and sources */
function clearRouteLayers() {
  if (!map) return;

  const style = map.getStyle();
  if (!style?.layers) return;

  style.layers
    .filter(layer => layer.id.startsWith("emergency-route-"))
    .forEach(layer => {
      if (map.getLayer(layer.id)) {
        map.removeLayer(layer.id);
      }
    });

  Object.keys(style.sources || {})
    .filter(id => id.startsWith("emergency-route-"))
    .forEach(id => {
      if (map.getSource(id)) {
        map.removeSource(id);
      }
    });
}

/* Display route alternatives */
function renderRouteOptions() {
  const box = $("routeOptions");
  if (!box) return;

  box.innerHTML = routeData.map((route, i) => {
    const km = (route.distance / 1000).toFixed(1);
    const min = Math.max(1, Math.round(route.duration / 60));

    const baseline = routeData[0].duration;
    const traffic =
      route.duration > baseline * 1.15 ? "Higher estimated time" :
      route.duration > baseline * 1.05 ? "Moderate estimated time" :
      "Similar estimated time";

    return `
      <div class="route-option ${i === 0 ? "selected" : ""}" data-route="${i}">
        <strong>${i === 0 ? "⚡ Route Option 1" : "🛣️ Route Option " + (i + 1)}</strong>
        <div class="route-meta">${km} km · ${min} min · ${traffic}</div>
      </div>
    `;
  }).join("");

  box.onclick = event => {
    const option = event.target.closest(".route-option");
    if (!option) return;
    selectRoute(Number(option.dataset.route));
  };

  selectRoute(0);
}

/* Select a route and animate the vehicle */
function selectRoute(index) {
  currentRoute = index;
  const route = routeData[index];
  if (!route) return;

  routeData.forEach((_, i) => {
    const id = `emergency-route-${i}`;
    if (!map.getLayer(id)) return;

    map.setPaintProperty(id, "line-color", i === index ? "#ff4545" : "#64748b");
    map.setPaintProperty(id, "line-width", i === index ? 7 : 4);
    map.setPaintProperty(id, "line-opacity", i === index ? .95 : .6);
  });

  document.querySelectorAll(".route-option").forEach((el, i) => {
    el.classList.toggle("selected", i === index);
  });

  const km = (route.distance / 1000).toFixed(1);
  const min = Math.max(1, Math.round(route.duration / 60));
  const info = $("routeInfo");

  if (info) {
    info.innerHTML = `
      🚨 <strong>${index === 0 ? "Route Option 1" : "Selected Alternative Route"}</strong><br>
      Distance: ${km} km · Estimated time: ${min} min<br>
      Route calculated using Mapbox driving-traffic directions.
    `;
  }

  if (selectedVehicle) {
    startVehicleAnimation(selectedVehicle, route.geometry.coordinates);
  }
}

/* Animate vehicle marker along selected route */
function startVehicleAnimation(vehicle, coordinates) {
  if (moveTimer) {
    cancelAnimationFrame(moveTimer);
    moveTimer = null;
  }

  if (movingMarker) {
    movingMarker.remove();
    movingMarker = null;
  }

  const thisRun = ++animationRun;

  const el = document.createElement("div");
  el.className = "marker vehicle-marker active";
  el.textContent = vehicle.type === "fire" ? "🚒" : "🚑";

  movingMarker = new mapboxgl.Marker(el)
    .setLngLat(coordinates[0])
    .setPopup(
      new mapboxgl.Popup().setHTML(
        `<b>${vehicle.id}</b><br>${vehicle.driver}<br>En route`
      )
    )
    .addTo(map);

  let segment = 0;
  let progress = 0;

  const step = () => {
    if (thisRun !== animationRun || !movingMarker) return;

    /* Arrival */
    if (segment >= coordinates.length - 1) {
      movingMarker.setLngLat(emergencyLocation);
      moveTimer = null;
      apiComplete();

      const status = document.querySelector(".dispatch-status");
      if (status) {
        status.innerHTML =
          '<span class="live-dot arrived"></span> Vehicle arrived at emergency';
      }

      const info = $("routeInfo");
      if (info) {
        info.innerHTML += `
          <br><br>
          🏁 <strong class="arrived">Vehicle arrived at destination.</strong>
        `;
      }

      let complete = $("serviceComplete");

      if (!complete) {
        complete = document.createElement("div");
        complete.id = "serviceComplete";
        complete.className = "service-complete";
        complete.innerHTML = `
          <div class="service-complete-icon">✓</div>
          <h3>Emergency Service Provided</h3>
          <p>
            The response vehicle has reached the reported emergency
            location and the service session is complete.
          </p>
          <button class="back-home" id="backHomeButton">← Back to Home</button>
        `;
        driverPanel.appendChild(complete);
      }

      $("backHomeButton").onclick = returnHome;
      complete.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }

    /* Move marker along the current segment */
    const a = coordinates[segment];
    const b = coordinates[segment + 1];

    progress += 0.012;

    if (progress >= 1) {
      progress = 0;
      segment++;
    }

    const lng = a[0] + (b[0] - a[0]) * progress;
    const lat = a[1] + (b[1] - a[1]) * progress;

    movingMarker.setLngLat([lng, lat]);
    moveTimer = requestAnimationFrame(step);
  };

  moveTimer = requestAnimationFrame(step);
}

/* Reset app and return to home */
function returnHome() {
  /* Invalidate any running animation */
  animationRun++;

  if (moveTimer) {
    cancelAnimationFrame(moveTimer);
    moveTimer = null;
  }

  if (movingMarker) {
    movingMarker.remove();
    movingMarker = null;
  }

  /* Restore vehicle availability for the next demo */
  if (selectedVehicle) {
    selectedVehicle.available = true;
  }
  apiComplete();
  updateCounts();

  if (emergencyMarker) {
    emergencyMarker.remove();
    emergencyMarker = null;
  }

  vehicleMarkers.forEach(marker => marker.remove());
  vehicleMarkers = [];

  clearRouteLayers();
  routeData = [];

  emergencyLocation = null;
  selectedVehicle = null;
  currentEmergencyId = null;
  pendingCoords = null;

  results.innerHTML = "";
  driverPanel.innerHTML = "";

  driverPanel.classList.add("hidden");
  mapBox.classList.add("hidden");
  $("mapNote").classList.add("hidden");

  $("locationInput").value = "SUIIT, Burla, Sambalpur";
  $("emergencyType").value = "accident";

  $("findButton").disabled = false;
  $("findButton").textContent = "📍 Find Location & Nearby Vehicles";

  panel.classList.add("hidden");

  window.scrollTo({ top: 0, behavior: "smooth" });

  setTimeout(() => {
    if (map) map.resize();
  }, 300);
}

/* =====================================================
   UPGRADE: backend, theme toggle, live location, history
   ===================================================== */
const API_BASE = location.port === "3000" ? "" : "http://localhost:3000";
const root = document.documentElement;
let backendOnline = false;
let currentEmergencyId = null;
let currentRoute = 0;
let pendingCoords = null;

/* ---- tiny fetch wrapper ---- */
async function api(method, path, body) {
  const res = await fetch(API_BASE + path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

function toast(msg, ms = 4000) {
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), ms);
}

function setBackend(on) {
  backendOnline = on;
  const b = $("backendBadge");
  b.className = "badge " + (on ? "online" : "offline");
  b.textContent = on ? "● Backend connected" : "● Offline mode";
}

async function loadVehicles() {
  try {
    vehicles = await api("GET", "/api/vehicles");
    setBackend(true);
  } catch {
    setBackend(false);   /* falls back to the built-in demo vehicles */
  }
  updateCounts();
  loadHistory();
}

async function registerEmergency(query) {
  currentEmergencyId = null;
  if (!backendOnline) return;
  try {
    const { emergency } = await api("POST", "/api/emergencies", {
      type: $("emergencyType").value,
      query,
      lng: emergencyLocation[0],
      lat: emergencyLocation[1]
    });
    currentEmergencyId = emergency.id;
    loadHistory();
  } catch (e) {
    console.warn("Could not save emergency:", e.message);
  }
}

async function apiDispatch(vehicle) {
  if (!backendOnline || !currentEmergencyId) return;
  try {
    await api("POST", `/api/emergencies/${currentEmergencyId}/dispatch`, { vehicleId: vehicle.id });
    loadHistory();
  } catch (e) {
    toast("⚠️ " + e.message);
  }
}

async function apiComplete() {
  const id = currentEmergencyId;
  if (!backendOnline || !id) return;
  try {
    await api("POST", `/api/emergencies/${id}/complete`);
    loadVehicles();
  } catch (e) {
    console.warn(e.message);
  }
}

async function loadHistory() {
  const box = $("historyList");
  const sec = $("history");
  if (!backendOnline) return sec.classList.add("hidden");
  try {
    const list = await api("GET", "/api/emergencies");
    if (!list.length) return sec.classList.add("hidden");
    const icon = { accident: "🚨", medical: "🏥", fire: "🔥" };
    box.innerHTML = list.slice(0, 5).map(e => `
      <div class="history-item">
        <span>${icon[e.type]} <strong>${e.id}</strong> · ${e.query || "Unknown location"}
          ${e.vehicleId ? " · " + e.vehicleId : ""}</span>
        <span class="status-pill status-${e.status}">${e.status}</span>
      </div>`).join("");
    sec.classList.remove("hidden");
  } catch { /* ignore */ }
}

/* ---- redraw route lines after a map style change ---- */
function redrawRoutes() {
  if (!map || !routeData.length) return;
  routeData.forEach((route, i) => {
    const id = `emergency-route-${i}`;
    if (map.getSource(id)) return;
    map.addSource(id, {
      type: "geojson",
      data: { type: "Feature", geometry: route.geometry, properties: {} }
    });
    map.addLayer({
      id, type: "line", source: id,
      layout: { "line-join": "round", "line-cap": "round" },
      paint: {
        "line-color": i === currentRoute ? "#ff4545" : "#64748b",
        "line-width": i === currentRoute ? 7 : 4,
        "line-opacity": i === currentRoute ? .95 : .6
      }
    });
  });
}

/* ---- light / dark theme ---- */
function mapStyle() {
  return root.dataset.theme === "light"
    ? "mapbox://styles/mapbox/light-v11"
    : "mapbox://styles/mapbox/dark-v11";
}

function applyTheme(theme) {
  root.dataset.theme = theme;
  localStorage.setItem("ers-theme", theme);
  $("themeToggle").textContent = theme === "light" ? "🌙" : "☀️";
  if (map) map.setStyle(mapStyle());
}

$("themeToggle").onclick = () =>
  applyTheme(root.dataset.theme === "light" ? "dark" : "light");
$("themeToggle").textContent = root.dataset.theme === "light" ? "🌙" : "☀️";

/* ---- live location with permission handling ---- */
$("locationInput").addEventListener("input", () => { pendingCoords = null; });

$("locBtn").onclick = () => {
  if (!navigator.geolocation) {
    toast("Your browser does not support location access.");
    return;
  }

  const btn = $("locBtn");
  btn.disabled = true;
  btn.textContent = "Locating...";

  navigator.geolocation.getCurrentPosition(
    async pos => {
      const { longitude, latitude, accuracy } = pos.coords;
      pendingCoords = [longitude, latitude];
      let label = "My current location";

      try {
        const r = await fetch(
          `https://api.mapbox.com/search/geocode/v6/reverse?longitude=${longitude}&latitude=${latitude}&access_token=${mapboxgl.accessToken}`
        );
        const d = await r.json();
        label = d.features?.[0]?.properties?.full_address || d.features?.[0]?.properties?.name || label;
      } catch { /* keep default label */ }

      $("locationInput").value = label;
      toast(`📍 Location detected (±${Math.round(accuracy)} m)`);
      btn.disabled = false;
      btn.textContent = "📡 Use My Location";
    },
    err => {
      const msg = {
        1: "Location permission denied. Click the lock icon in the address bar, allow Location, then try again.",
        2: "Your position is unavailable. Check GPS / network and try again.",
        3: "Location request timed out. Please try again."
      }[err.code] || "Could not get your location.";
      toast("⚠️ " + msg, 6000);
      btn.disabled = false;
      btn.textContent = "📡 Use My Location";
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
  );
};

/* ---- start ---- */
loadVehicles();
setInterval(() => { if (document.visibilityState === "visible") loadVehicles(); }, 15000);
