import { createHmac, timingSafeEqual } from "node:crypto";
import express from "express";
import cron from "node-cron";
import { handleIncoming, handleStatus, sendSummary } from "./bot.js";
import { config } from "./config.js";

const app = express();

// Guardamos el cuerpo sin procesar para verificar la firma de Meta.
app.use(express.json({ verify: (req: any, _res, buf) => (req.rawBody = buf) }));

// Meta llama a esta ruta una sola vez, cuando configuras el webhook.
app.get("/webhook", (req, res) => {
  if (req.query["hub.mode"] === "subscribe" && req.query["hub.verify_token"] === config.verifyToken) {
    res.status(200).send(req.query["hub.challenge"]);
  } else {
    res.sendStatus(403);
  }
});

function validSignature(req: any): boolean {
  const header = req.get("x-hub-signature-256") ?? "";
  const expected = "sha256=" + createHmac("sha256", config.appSecret).update(req.rawBody ?? "").digest("hex");
  return header.length === expected.length && timingSafeEqual(Buffer.from(header), Buffer.from(expected));
}

// Aquí llegan los mensajes y los estados de entrega.
app.post("/webhook", (req, res) => {
  if (!validSignature(req)) {
    res.sendStatus(401);
    return;
  }
  // Respondemos de inmediato; si tardamos, Meta reintenta el envío.
  res.sendStatus(200);

  for (const entry of req.body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value ?? {};
      for (const msg of value.messages ?? []) {
        const contact = (value.contacts ?? []).find((c: any) => c.wa_id === msg.from);
        handleIncoming(msg, contact?.profile?.name ?? null).catch((err) =>
          console.error("Error procesando mensaje:", err),
        );
      }
      for (const status of value.statuses ?? []) {
        handleStatus(status).catch((err) => console.error("Error procesando estado:", err));
      }
    }
  }
});

app.get("/", (_req, res) => {
  res.send("Bot de WhatsApp + Claude funcionando ✅");
});

cron.schedule(
  `${config.summaryMinute} ${config.summaryHour} * * *`,
  () => {
    sendSummary().catch((err) => console.error("Error enviando el resumen diario:", err));
  },
  { timezone: config.timezone },
);

app.listen(config.port, () => {
  const hhmm = `${String(config.summaryHour).padStart(2, "0")}:${String(config.summaryMinute).padStart(2, "0")}`;
  console.log(`Servidor escuchando en el puerto ${config.port}`);
  console.log(`Resumen diario programado a las ${hhmm} (${config.timezone})`);
});
