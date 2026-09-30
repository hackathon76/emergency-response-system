const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, "data.json");

const SEED = [
  { id: "AMB-001", type: "ambulance", driver: "Raj Kumar", phone: "+91 90000 00001", lng: 83.8868, lat: 21.4858, available: true },
  { id: "AMB-002", type: "ambulance", driver: "Amit Das", phone: "+91 90000 00002", lng: 83.8819, lat: 21.4808, available: true },
  { id: "AMB-003", type: "ambulance", driver: "Rahul Singh", phone: "+91 90000 00003", lng: 83.8910, lat: 21.4885, available: false },
  { id: "FIRE-001", type: "fire", driver: "Suresh Patnaik", phone: "+91 90000 00004", lng: 83.8788, lat: 21.4902, available: true }
];

/* ---------- tiny JSON "database" ---------- */
let db = { vehicles: SEED.map(v => ({ ...v })), emergencies: [] };
try {
  if (fs.existsSync(DB_FILE)) db = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
} catch (e) {
  console.warn("Could not read data.json, starting fresh");
}
const save = () => fs.writeFile(DB_FILE, JSON.stringify(db, null, 2), () => {});

/* ---------- middleware ---------- */
app.use(express.json());
app.use((req, res, next) => {            // CORS so VS Code Live Server (port 5500) also works
  res.set({
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS"
  });
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});
app.use(express.static(path.join(__dirname, "public")));

/* ---------- helpers ---------- */
const km = (a, b) => {
  const r = x => (x * Math.PI) / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 +
    Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
};
const TYPES = ["accident", "medical", "fire"];

/* ---------- routes ---------- */
app.get("/api/health", (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

app.get("/api/vehicles", (req, res) => res.json(db.vehicles));

app.get("/api/emergencies", (req, res) =>
  res.json(db.emergencies.slice(-10).reverse()));

/* Create an emergency and return ranked vehicles */
app.post("/api/emergencies", (req, res) => {
  const { type, query, lng, lat } = req.body || {};
  if (!TYPES.includes(type)) return res.status(400).json({ error: "Invalid emergency type" });
  if (typeof lng !== "number" || typeof lat !== "number" ||
      Math.abs(lng) > 180 || Math.abs(lat) > 90)
    return res.status(400).json({ error: "Invalid coordinates" });

  const need = type === "fire" ? "fire" : "ambulance";
  const nearby = db.vehicles
    .filter(v => v.type === need && v.available)
    .map(v => ({ id: v.id, distanceKm: +km({ lat, lng }, v).toFixed(2) }))
    .sort((a, b) => a.distanceKm - b.distanceKm);

  const emergency = {
    id: "EMG-" + Date.now().toString(36).toUpperCase(),
    type,
    query: String(query || "").slice(0, 200),
    lng, lat,
    status: "open",
    vehicleId: null,
    createdAt: new Date().toISOString()
  };
  db.emergencies.push(emergency);
  save();
  res.status(201).json({ emergency, nearby });
});

/* Dispatch a vehicle (server prevents double-booking) */
app.post("/api/emergencies/:id/dispatch", (req, res) => {
  const em = db.emergencies.find(e => e.id === req.params.id);
  const v = db.vehicles.find(x => x.id === req.body?.vehicleId);
  if (!em) return res.status(404).json({ error: "Emergency not found" });
  if (!v) return res.status(404).json({ error: "Vehicle not found" });
  if (!v.available) return res.status(409).json({ error: "Vehicle already busy" });

  v.available = false;
  em.status = "dispatched";
  em.vehicleId = v.id;
  em.dispatchedAt = new Date().toISOString();
  save();
  res.json({ emergency: em, vehicle: v });
});

/* Complete / cancel an emergency and free the vehicle */
app.post("/api/emergencies/:id/complete", (req, res) => {
  const em = db.emergencies.find(e => e.id === req.params.id);
  if (!em) return res.status(404).json({ error: "Emergency not found" });
  if (em.status === "completed" || em.status === "cancelled") return res.json({ emergency: em });

  const v = db.vehicles.find(x => x.id === em.vehicleId);
  if (v) v.available = true;
  em.status = em.status === "dispatched" ? "completed" : "cancelled";
  em.closedAt = new Date().toISOString();
  save();
  res.json({ emergency: em });
});

/* Demo helper: reset everything */
app.post("/api/reset", (req, res) => {
  db = { vehicles: SEED.map(v => ({ ...v })), emergencies: [] };
  save();
  res.json({ ok: true });
});

app.listen(PORT, () => console.log(`ERS running → http://localhost:${PORT}`));
