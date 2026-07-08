import { useState, useEffect, useRef, useCallback } from "react";
import { Clock, LogIn, LogOut, Settings, ChevronDown, ChevronUp, X, TrendingUp, TrendingDown } from "lucide-react";

const WEEKLY_TARGET_MS = 30 * 60 * 60 * 1000; // 30 horas semanais
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function fmtClock(d) {
  return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
function fmtDateLong(d) {
  const s = d.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function fmtDateShort(d) {
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}
function fmtTime(d) {
  return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}
function msToHM(ms) {
  const sign = ms < 0 ? "-" : "";
  const abs = Math.abs(ms);
  const totalMin = Math.round(abs / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${sign}${h}h${String(m).padStart(2, "0")}`;
}
function startOfWeek(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

async function apiGetTeam() {
  const res = await fetch("/api/team");
  if (!res.ok) throw new Error("falha");
  const data = await res.json();
  return data.names || [];
}
async function apiSaveTeam(names) {
  const res = await fetch("/api/team", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ names }),
  });
  if (!res.ok) throw new Error("falha");
  const data = await res.json();
  return data.names || [];
}
async function apiGetRecords() {
  const res = await fetch("/api/records");
  if (!res.ok) throw new Error("falha");
  const data = await res.json();
  return data.records || [];
}
async function apiAddRecord(entry) {
  const res = await fetch("/api/records", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entry }),
  });
  if (!res.ok) throw new Error("falha");
  const data = await res.json();
  return data.records || [];
}

export default function App() {
  const [now, setNow] = useState(new Date());
  const [team, setTeam] = useState(null);
  const [records, setRecords] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [setupNames, setSetupNames] = useState(["", "", ""]);
  const [showSettings, setShowSettings] = useState(false);
  const [openPanel, setOpenPanel] = useState({});
  const [error, setError] = useState("");
  const [busyIdx, setBusyIdx] = useState(null);
  const tickRef = useRef(null);

  useEffect(() => {
    tickRef.current = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(tickRef.current);
  }, []);

  const loadAll = useCallback(async () => {
    try {
      setTeam(await apiGetTeam());
    } catch {
      setTeam([]);
      setError("Não consegui carregar a equipe. Verifique se o servidor está no ar.");
    }
    try {
      setRecords(await apiGetRecords());
    } catch {
      setRecords([]);
    }
    setLoaded(true);
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  async function saveTeam(names) {
    setError("");
    try {
      const saved = await apiSaveTeam(names);
      setTeam(saved);
      setShowSettings(false);
    } catch {
      setError("Não consegui salvar os nomes. Tenta de novo.");
    }
  }

  function handleSetupSubmit(e) {
    e.preventDefault();
    const cleaned = setupNames.map((n) => n.trim()).filter(Boolean);
    if (cleaned.length < 1) {
      setError("Preencha ao menos um nome.");
      return;
    }
    saveTeam(cleaned);
  }

  function lastRecordFor(person) {
    const list = records.filter((r) => r.person === person).sort((a, b) => b.timestamp - a.timestamp);
    return list[0] || null;
  }

  function recordsFor(person) {
    return records.filter((r) => r.person === person).sort((a, b) => b.timestamp - a.timestamp);
  }

  function sessionsFor(person) {
    const list = records.filter((r) => r.person === person).sort((a, b) => a.timestamp - b.timestamp);
    const sessions = [];
    let openStart = null;
    for (const r of list) {
      if (r.type === "in") openStart = r.timestamp;
      else if (r.type === "out" && openStart != null) {
        sessions.push([openStart, r.timestamp]);
        openStart = null;
      }
    }
    if (openStart != null) sessions.push([openStart, now.getTime()]);
    return sessions;
  }

  function msInRange(sessions, start, end) {
    let total = 0;
    for (const [s, e] of sessions) {
      const os = Math.max(s, start);
      const oe = Math.min(e, end);
      if (oe > os) total += oe - os;
    }
    return total;
  }

  async function punch(person, idx) {
    setBusyIdx(idx);
    setError("");
    const last = lastRecordFor(person);
    const type = !last || last.type === "out" ? "in" : "out";
    const entry = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, person, type, timestamp: Date.now() };
    try {
      const updated = await apiAddRecord(entry);
      setRecords(updated);
    } catch {
      setError("Não consegui registrar o ponto agora. Tenta de novo em instantes.");
    } finally {
      setBusyIdx(null);
    }
  }

  function bankFor(person) {
    const sessions = sessionsFor(person);
    const nowMs = now.getTime();
    const curWeekStart = startOfWeek(now).getTime();

    if (sessions.length === 0) {
      return { weekWorked: 0, weekBalance: -WEEKLY_TARGET_MS, bank: 0, weeks: [], todayWorked: 0 };
    }

    const firstWeekStart = startOfWeek(new Date(sessions[0][0])).getTime();
    const weeksElapsed = Math.round((curWeekStart - firstWeekStart) / WEEK_MS) + 1;
    const totalWorkedAllTime = sessions.reduce((sum, [s, e]) => sum + (e - s), 0);
    const targetAccum = weeksElapsed * WEEKLY_TARGET_MS;
    const bank = totalWorkedAllTime - targetAccum;

    const weekWorked = msInRange(sessions, curWeekStart, nowMs);
    const weekBalance = weekWorked - WEEKLY_TARGET_MS;

    const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
    const todayWorked = msInRange(sessions, todayStart.getTime(), nowMs);

    const weeks = [];
    for (let ws = curWeekStart; ws >= firstWeekStart; ws -= WEEK_MS) {
      const we = Math.min(ws + WEEK_MS, nowMs);
      const worked = msInRange(sessions, ws, we);
      weeks.push({ start: ws, worked, balance: worked - WEEKLY_TARGET_MS, isCurrent: ws === curWeekStart });
    }

    return { weekWorked, weekBalance, bank, weeks, todayWorked };
  }

  function togglePanel(person, panel) {
    setOpenPanel((prev) => ({ ...prev, [person]: prev[person] === panel ? null : panel }));
  }

  if (!loaded) {
    return (
      <div style={styles.page}>
        <div style={styles.loadingWrap}>
          <div style={styles.loadingDot} />
          <span style={{ fontFamily: "'Space Mono', monospace", color: "#8A93A8", letterSpacing: "0.08em", fontSize: 13 }}>CARREGANDO</span>
        </div>
        <GlobalStyle />
      </div>
    );
  }

  if (!team || team.length === 0) {
    return (
      <div style={styles.page}>
        <GlobalStyle />
        <div style={styles.setupCard}>
          <div style={styles.setupEyebrow}>CONFIGURAÇÃO INICIAL</div>
          <h1 style={styles.setupTitle}>Quem vai bater o ponto?</h1>
          <p style={styles.setupSub}>Cadastre até 3 pessoas. Meta de banco de horas: 30h por semana, por pessoa.</p>
          <form onSubmit={handleSetupSubmit} style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 24 }}>
            {[0, 1, 2].map((i) => (
              <input key={i} value={setupNames[i]} onChange={(e) => { const next = [...setupNames]; next[i] = e.target.value; setSetupNames(next); }} placeholder={`Pessoa ${i + 1}`} style={styles.input} maxLength={40} />
            ))}
            {error && <div style={styles.errorText}>{error}</div>}
            <button type="submit" style={styles.primaryBtn}>Começar</button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      <GlobalStyle />

      <header style={styles.header}>
        <div>
          <div style={styles.eyebrow}>BANCO DE HORAS · META 30H/SEMANA</div>
          <div style={styles.dateLine}>{fmtDateLong(now)}</div>
        </div>
        <button aria-label="Configurações" onClick={() => { setSetupNames([team[0] || "", team[1] || "", team[2] || ""]); setShowSettings(true); }} style={styles.iconBtn}>
          <Settings size={18} color="#8A93A8" />
        </button>
      </header>

      <div style={styles.clockWrap}>
        <Clock size={20} color="#FFB020" style={{ opacity: 0.8 }} />
        <span style={styles.clockDigits}>{fmtClock(now)}</span>
      </div>

      {error && <div style={{ ...styles.errorText, textAlign: "center", marginBottom: 12 }}>{error}</div>}

      <div style={styles.cardsGrid}>
        {team.map((person, idx) => {
          const last = lastRecordFor(person);
          const isIn = last && last.type === "in";
          const { weekWorked, weekBalance, bank, weeks, todayWorked } = bankFor(person);
          const pct = Math.min(100, (weekWorked / WEEKLY_TARGET_MS) * 100);
          const panel = openPanel[person];
          const hist = recordsFor(person).slice(0, 12);
          const bankPositive = bank >= 0;

          return (
            <div key={person} style={{ ...styles.card, borderColor: isIn ? "rgba(255,176,32,0.35)" : "rgba(124,141,181,0.25)" }}>
              <div style={styles.cardTop}>
                <div>
                  <div style={styles.personName}>{person}</div>
                  <div style={{ ...styles.statusBadge, color: isIn ? "#FFB020" : "#7C8DB5" }}>
                    <span style={{ ...styles.statusDot, background: isIn ? "#FFB020" : "#7C8DB5", boxShadow: isIn ? "0 0 8px #FFB020" : "none" }} />
                    {isIn ? "DENTRO" : "FORA"}
                  </div>
                </div>
                <div style={styles.totalToday}>
                  <div style={styles.totalLabel}>HOJE</div>
                  <div style={styles.totalValue}>{msToHM(todayWorked)}</div>
                </div>
              </div>

              <div style={styles.lastPunch}>
                {last ? `Último registro: ${last.type === "in" ? "entrada" : "saída"} às ${fmtTime(new Date(last.timestamp))}` : "Nenhum registro ainda"}
              </div>

              <button onClick={() => punch(person, idx)} disabled={busyIdx === idx} style={{ ...styles.punchBtn, background: isIn ? "rgba(124,141,181,0.12)" : "rgba(255,176,32,0.12)", borderColor: isIn ? "#7C8DB5" : "#FFB020", color: isIn ? "#B8C2D9" : "#FFB020", opacity: busyIdx === idx ? 0.6 : 1 }}>
                {isIn ? <LogOut size={16} /> : <LogIn size={16} />}
                {busyIdx === idx ? "Registrando…" : isIn ? "Bater saída" : "Bater entrada"}
              </button>

              <div style={styles.bankSection}>
                <div style={styles.bankRow}>
                  <span style={styles.bankLabel}>Semana atual</span>
                  <span style={styles.bankMono}>{msToHM(weekWorked)} / 30h</span>
                </div>
                <div style={styles.progressTrack}>
                  <div style={{ ...styles.progressFill, width: `${pct}%`, background: weekBalance >= 0 ? "#2DD4BF" : "#FFB020" }} />
                </div>
                <div style={styles.bankRow}>
                  <span style={styles.bankLabel}>Saldo da semana</span>
                  <span style={{ ...styles.bankMono, color: weekBalance >= 0 ? "#2DD4BF" : "#E5645A" }}>{msToHM(weekBalance)}</span>
                </div>

                <div style={styles.bankTotalRow}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    {bankPositive ? <TrendingUp size={14} color="#2DD4BF" /> : <TrendingDown size={14} color="#E5645A" />}
                    <span style={styles.bankTotalLabel}>Banco de horas acumulado</span>
                  </div>
                  <span style={{ ...styles.bankTotalValue, color: bankPositive ? "#2DD4BF" : "#E5645A" }}>{msToHM(bank)}</span>
                </div>
              </div>

              <div style={styles.toggleRow}>
                <button onClick={() => togglePanel(person, "semanas")} style={styles.historyToggle}>
                  Semanas {panel === "semanas" ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </button>
                <button onClick={() => togglePanel(person, "registros")} style={styles.historyToggle}>
                  Registros {panel === "registros" ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </button>
              </div>

              {panel === "semanas" && (
                <div style={styles.historyList}>
                  {weeks.map((w) => (
                    <div key={w.start} style={styles.historyRow}>
                      <span style={{ flex: 1, color: "#8A93A8" }}>
                        {fmtDateShort(new Date(w.start))} {w.isCurrent && <em style={{ color: "#5C6478", fontStyle: "normal" }}>(atual)</em>}
                      </span>
                      <span style={{ color: "#E8E6DF", width: 66, textAlign: "right" }}>{msToHM(w.worked)}</span>
                      <span style={{ color: w.balance >= 0 ? "#2DD4BF" : "#E5645A", width: 64, textAlign: "right" }}>{msToHM(w.balance)}</span>
                    </div>
                  ))}
                </div>
              )}

              {panel === "registros" && (
                <div style={styles.historyList}>
                  {hist.length === 0 && <div style={styles.historyEmpty}>Sem registros.</div>}
                  {hist.map((r) => (
                    <div key={r.id} style={styles.historyRow}>
                      <span style={{ color: r.type === "in" ? "#FFB020" : "#7C8DB5", fontWeight: 700, width: 40 }}>{r.type === "in" ? "ENT" : "SAÍ"}</span>
                      <span style={{ flex: 1, color: "#8A93A8" }}>{fmtDateShort(new Date(r.timestamp))}</span>
                      <span style={{ color: "#E8E6DF" }}>{fmtTime(new Date(r.timestamp))}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <p style={styles.footnote}>
        Saldo semanal compara as horas trabalhadas na semana (seg–dom) com a meta de 30h. O banco de horas acumulado soma isso desde o primeiro registro de cada pessoa. Dados visíveis para toda a equipe.
      </p>

      {showSettings && (
        <div style={styles.modalOverlay} onClick={() => setShowSettings(false)}>
          <div style={styles.modalCard} onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalHeader}>
              <span style={styles.setupEyebrow}>EDITAR EQUIPE</span>
              <button onClick={() => setShowSettings(false)} style={styles.iconBtn} aria-label="Fechar"><X size={16} color="#8A93A8" /></button>
            </div>
            <form onSubmit={handleSetupSubmit} style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 16 }}>
              {[0, 1, 2].map((i) => (
                <input key={i} value={setupNames[i]} onChange={(e) => { const next = [...setupNames]; next[i] = e.target.value; setSetupNames(next); }} placeholder={`Pessoa ${i + 1}`} style={styles.input} maxLength={40} />
              ))}
              {error && <div style={styles.errorText}>{error}</div>}
              <button type="submit" style={styles.primaryBtn}>Salvar</button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function GlobalStyle() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Inter:wght@400;500;600;700&display=swap');
      * { box-sizing: border-box; }
      body { margin: 0; }
      input:focus, button:focus-visible { outline: 2px solid #FFB020; outline-offset: 2px; }
      @media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }
      @keyframes pulse { 0%, 100% { opacity: 0.5; } 50% { opacity: 1; } }
    `}</style>
  );
}

const styles = {
  page: { minHeight: "100vh", background: "#14171F", backgroundImage: "radial-gradient(circle at 50% 0%, rgba(255,176,32,0.06), transparent 60%)", fontFamily: "'Inter', sans-serif", padding: "28px 16px 48px", display: "flex", flexDirection: "column", alignItems: "center" },
  loadingWrap: { minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12 },
  loadingDot: { width: 10, height: 10, borderRadius: "50%", background: "#FFB020", animation: "pulse 1.2s ease-in-out infinite" },
  header: { width: "100%", maxWidth: 460, display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 },
  eyebrow: { fontFamily: "'Space Mono', monospace", fontSize: 11, letterSpacing: "0.1em", color: "#FFB020", marginBottom: 4 },
  dateLine: { color: "#8A93A8", fontSize: 14, fontWeight: 500 },
  iconBtn: { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, width: 34, height: 34, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" },
  clockWrap: { display: "flex", alignItems: "center", gap: 10, marginBottom: 28 },
  clockDigits: { fontFamily: "'Space Mono', monospace", fontSize: 42, fontWeight: 700, color: "#F3F1EA", letterSpacing: "0.02em", fontVariantNumeric: "tabular-nums" },
  cardsGrid: { width: "100%", maxWidth: 460, display: "flex", flexDirection: "column", gap: 14 },
  card: { background: "#1B1F2A", border: "1px solid", borderRadius: 14, padding: 18 },
  cardTop: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 },
  personName: { fontSize: 17, fontWeight: 700, color: "#F3F1EA", marginBottom: 6 },
  statusBadge: { display: "flex", alignItems: "center", gap: 6, fontFamily: "'Space Mono', monospace", fontSize: 12, letterSpacing: "0.08em", fontWeight: 700 },
  statusDot: { width: 7, height: 7, borderRadius: "50%", display: "inline-block" },
  totalToday: { textAlign: "right" },
  totalLabel: { fontFamily: "'Space Mono', monospace", fontSize: 10, color: "#5C6478", letterSpacing: "0.1em" },
  totalValue: { fontFamily: "'Space Mono', monospace", fontSize: 18, color: "#E8E6DF", fontWeight: 700 },
  lastPunch: { fontSize: 13, color: "#7C8298", marginBottom: 14 },
  punchBtn: { width: "100%", border: "1px solid", borderRadius: 10, padding: "12px 14px", fontSize: 14, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, cursor: "pointer", background: "transparent" },
  bankSection: { marginTop: 16, paddingTop: 14, borderTop: "1px solid rgba(255,255,255,0.06)" },
  bankRow: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 },
  bankLabel: { fontSize: 12, color: "#7C8298" },
  bankMono: { fontFamily: "'Space Mono', monospace", fontSize: 13, color: "#E8E6DF", fontWeight: 700 },
  progressTrack: { height: 6, borderRadius: 3, background: "rgba(255,255,255,0.06)", overflow: "hidden", marginBottom: 10 },
  progressFill: { height: "100%", borderRadius: 3, transition: "width 0.4s ease" },
  bankTotalRow: { display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10, paddingTop: 10, borderTop: "1px dashed rgba(255,255,255,0.08)" },
  bankTotalLabel: { fontSize: 12, color: "#8A93A8" },
  bankTotalValue: { fontFamily: "'Space Mono', monospace", fontSize: 16, fontWeight: 700 },
  toggleRow: { display: "flex", gap: 4, marginTop: 12 },
  historyToggle: { flex: 1, background: "none", border: "none", color: "#5C6478", fontSize: 12, display: "flex", alignItems: "center", justifyContent: "center", gap: 4, cursor: "pointer", padding: "6px 0" },
  historyList: { marginTop: 4, borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 8, display: "flex", flexDirection: "column", gap: 6, maxHeight: 200, overflowY: "auto" },
  historyRow: { display: "flex", alignItems: "center", fontFamily: "'Space Mono', monospace", fontSize: 12 },
  historyEmpty: { color: "#5C6478", fontSize: 12, fontStyle: "italic" },
  footnote: { color: "#4B5266", fontSize: 12, marginTop: 24, textAlign: "center", lineHeight: 1.6, maxWidth: 460 },
  setupCard: { background: "#1B1F2A", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16, padding: 28, maxWidth: 400, width: "100%", marginTop: 40 },
  setupEyebrow: { fontFamily: "'Space Mono', monospace", fontSize: 11, letterSpacing: "0.14em", color: "#FFB020" },
  setupTitle: { color: "#F3F1EA", fontSize: 22, fontWeight: 700, margin: "10px 0 4px" },
  setupSub: { color: "#8A93A8", fontSize: 14, margin: 0, lineHeight: 1.5 },
  input: { background: "#14171F", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, padding: "12px 14px", color: "#F3F1EA", fontSize: 14, fontFamily: "'Inter', sans-serif" },
  primaryBtn: { background: "#FFB020", border: "none", borderRadius: 8, padding: "12px 14px", color: "#14171F", fontSize: 14, fontWeight: 700, cursor: "pointer", marginTop: 4 },
  errorText: { color: "#E5645A", fontSize: 12 },
  modalOverlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, zIndex: 10 },
  modalCard: { background: "#1B1F2A", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 16, padding: 24, maxWidth: 380, width: "100%" },
  modalHeader: { display: "flex", justifyContent: "space-between", alignItems: "center" },
};
