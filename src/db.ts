import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { config } from "./config.js";

mkdirSync(dirname(config.dbPath), { recursive: true });
const db = new DatabaseSync(config.dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id          TEXT PRIMARY KEY,   -- id del mensaje de WhatsApp (evita duplicados)
    day         TEXT NOT NULL,      -- YYYY-MM-DD en la zona horaria del negocio
    time        TEXT NOT NULL,      -- HH:MM
    phone       TEXT NOT NULL,
    name        TEXT,
    direction   TEXT NOT NULL,      -- 'in' (recibido) | 'out' (enviado por el bot)
    type        TEXT NOT NULL,      -- text, image, document, audio...
    text        TEXT,               -- texto o pie de foto
    analysis    TEXT                -- análisis de Claude para fotos y documentos
  );
  CREATE INDEX IF NOT EXISTS messages_day ON messages(day);

  CREATE TABLE IF NOT EXISTS summaries (
    day      TEXT PRIMARY KEY,
    summary  TEXT NOT NULL
  );
`);

export interface StoredMessage {
  id: string;
  day: string;
  time: string;
  phone: string;
  name: string | null;
  direction: "in" | "out";
  type: string;
  text: string | null;
  analysis: string | null;
}

/** Guarda el mensaje. Devuelve false si ya existía (WhatsApp a veces reenvía el mismo webhook). */
export function saveMessage(m: StoredMessage): boolean {
  const result = db
    .prepare(
      `INSERT OR IGNORE INTO messages (id, day, time, phone, name, direction, type, text, analysis)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(m.id, m.day, m.time, m.phone, m.name, m.direction, m.type, m.text, m.analysis);
  return result.changes > 0;
}

export function setAnalysis(id: string, analysis: string): void {
  db.prepare("UPDATE messages SET analysis = ? WHERE id = ?").run(analysis, id);
}

export function messagesOfDay(day: string): StoredMessage[] {
  return db
    .prepare("SELECT * FROM messages WHERE day = ? ORDER BY time, rowid")
    .all(day) as unknown as StoredMessage[];
}

export function saveSummary(day: string, summary: string): void {
  db.prepare("INSERT OR REPLACE INTO summaries (day, summary) VALUES (?, ?)").run(day, summary);
}
