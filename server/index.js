import express from "express";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, "..", "data", "db.json");

function hashPin(pin) {
  return crypto.createHash("sha256").update(String(pin)).digest("hex");
}

function readDB() {
  try {
    const db = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
    if (!Array.isArray(db.automations)) db.automations = [];
    if (!db.settings || typeof db.settings.weeklyTargetHours !== "number") {
      db.settings = { weeklyTargetHours: 30 };
    }
    if (!db.pins || typeof db.pins !== "object") db.pins = {};
    return db;
  } catch {
    return { team: [], records: [], automations: [], settings: { weeklyTargetHours: 30 }, pins: {} };
  }
}

function writeDB(db) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
}

const app = express();
app.use(express.json());

app.get("/api/team", (req, res) => {
  res.json({ names: readDB().team });
});

app.put("/api/team", (req, res) => {
  const db = readDB();
  db.team = Array.isArray(req.body.names) ? req.body.names : [];

  const pins = req.body.pins && typeof req.body.pins === "object" ? req.body.pins : {};
  for (const [name, rawPin] of Object.entries(pins)) {
    if (typeof rawPin === "string" && /^\d{4}$/.test(rawPin)) {
      db.pins[name] = hashPin(rawPin);
    }
  }
  // Remove senhas de pessoas que não estão mais na equipe
  for (const name of Object.keys(db.pins)) {
    if (!db.team.includes(name)) delete db.pins[name];
  }

  writeDB(db);
  res.json({ names: db.team });
});

app.post("/api/verify-pin", (req, res) => {
  const db = readDB();
  const { person, pin } = req.body;
  const stored = db.pins[person];
  const ok = !!stored && stored === hashPin(pin);
  res.json({ ok });
});

app.get("/api/records", (req, res) => {
  res.json({ records: readDB().records });
});

app.post("/api/records", (req, res) => {
  const db = readDB();
  if (req.body.entry) db.records = [...db.records, req.body.entry];
  writeDB(db);
  res.json({ records: db.records });
});

app.get("/api/automations", (req, res) => {
  res.json({ items: readDB().automations });
});

app.put("/api/automations", (req, res) => {
  const db = readDB();
  db.automations = Array.isArray(req.body.items) ? req.body.items : [];
  writeDB(db);
  res.json({ items: db.automations });
});

app.get("/api/settings", (req, res) => {
  res.json(readDB().settings);
});

app.put("/api/settings", (req, res) => {
  const db = readDB();
  const hours = Number(req.body.weeklyTargetHours);
  db.settings = { weeklyTargetHours: hours > 0 ? hours : 30 };
  writeDB(db);
  res.json(db.settings);
});

// Serve o front-end já buildado (npm run build gera a pasta dist)
const distPath = path.join(__dirname, "..", "dist");
app.use(express.static(distPath));
app.get("*", (req, res) => {
  res.sendFile(path.join(distPath, "index.html"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
