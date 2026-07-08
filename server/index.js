import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, "..", "data", "db.json");

function readDB() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
  } catch {
    return { team: [], records: [] };
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
  writeDB(db);
  res.json({ names: db.team });
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
