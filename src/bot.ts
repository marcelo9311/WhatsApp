import type Anthropic from "@anthropic-ai/sdk";
import { analyzeReport, answerOwner, dailySummary } from "./claude.js";
import { config, today } from "./config.js";
import { messagesOfDay, saveMessage, saveSummary, setAnalysis, type StoredMessage } from "./db.js";
import { downloadMedia, markAsRead, sendTemplate, sendText } from "./whatsapp.js";

const MEDIA_TYPES = ["image", "document", "audio", "video", "sticker"];

function timeOf(timestampSeconds: string): { day: string; time: string } {
  const date = new Date(Number(timestampSeconds) * 1000);
  const time = date.toLocaleTimeString("es-CO", {
    timeZone: config.timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return { day: today(date), time };
}

function nowTime(): string {
  return timeOf(String(Date.now() / 1000)).time;
}

/** Mensajes de otras personas (no del dueño ni del bot): lo que Claude revisa. */
function incomingOfDay(day: string): StoredMessage[] {
  return messagesOfDay(day).filter((m) => m.direction === "in" && m.phone !== config.ownerPhone);
}

/** Envía un texto y lo guarda en la base de datos. */
async function reply(to: string, text: string): Promise<void> {
  const ids = await sendText(to, text);
  const { day } = timeOf(String(Date.now() / 1000));
  ids.forEach((id, i) =>
    saveMessage({
      id: id ?? `out-${Date.now()}-${i}`,
      day,
      time: nowTime(),
      phone: to,
      name: null,
      direction: "out",
      type: "text",
      text: ids.length > 1 ? `(parte ${i + 1}) ${text}` : text,
      analysis: null,
    }),
  );
}

/** Procesa un mensaje entrante del webhook de WhatsApp. */
export async function handleIncoming(msg: any, contactName: string | null): Promise<void> {
  const { day, time } = timeOf(msg.timestamp);
  const phone: string = msg.from;
  const media = MEDIA_TYPES.includes(msg.type) ? msg[msg.type] : null;
  const text: string | null =
    msg.text?.body ?? media?.caption ?? media?.filename ?? msg.button?.text ?? msg.interactive?.button_reply?.title ?? null;

  const isNew = saveMessage({
    id: msg.id,
    day,
    time,
    phone,
    name: contactName,
    direction: "in",
    type: msg.type,
    text,
    analysis: null,
  });
  if (!isNew) return; // webhook repetido
  await markAsRead(msg.id);

  if (phone === config.ownerPhone) {
    await handleOwner(day, text ?? "");
    return;
  }

  // Foto o documento de otra persona: Claude lo lee y guarda el contenido para el resumen.
  if (media && (msg.type === "image" || msg.type === "document")) {
    try {
      const file = await downloadMedia(media.id);
      const analysis = await analyzeReport(file, media.caption ?? null, contactName ?? `+${phone}`);
      if (analysis) setAnalysis(msg.id, analysis);
    } catch (err) {
      console.error(`Error analizando el archivo de ${phone}:`, err);
    }
  }

  if (config.ackMessage) await reply(phone, config.ackMessage);
}

async function handleOwner(day: string, text: string): Promise<void> {
  if (/^\s*resumen\s*$/i.test(text)) {
    await sendSummary(day);
    return;
  }

  // Conversación de hoy con el dueño, para que Claude recuerde lo que ya le preguntó.
  const history = messagesOfDay(day).filter((m) => m.phone === config.ownerPhone && m.text);
  const conversation: Anthropic.Beta.BetaMessageParam[] = [];
  for (const m of history.slice(-30)) {
    const role = m.direction === "in" ? "user" : "assistant";
    const last = conversation.at(-1);
    if (last?.role === role) last.content += `\n${m.text}`;
    else conversation.push({ role, content: m.text! });
  }
  while (conversation[0]?.role === "assistant") conversation.shift();
  if (conversation.length === 0) return;

  const answer = await answerOwner(day, incomingOfDay(day), conversation);
  await reply(config.ownerPhone, answer);
}

/** Genera el resumen del día y se lo envía al dueño. */
export async function sendSummary(day = today()): Promise<void> {
  const summary = await dailySummary(day, incomingOfDay(day));
  saveSummary(day, summary);
  await reply(config.ownerPhone, `📋 *Resumen del ${day}*\n\n${summary}`);
}

/**
 * WhatsApp solo deja enviar texto libre si el destinatario escribió en las últimas 24 h.
 * Si el resumen falla por eso (error 131047), se envía la plantilla para avisar al dueño;
 * cuando responda "resumen", lo recibe.
 */
let templateSentOn = "";
export async function handleStatus(status: any): Promise<void> {
  if (status.status !== "failed") return;
  const code = status.errors?.[0]?.code;
  console.error(`Mensaje ${status.id} a ${status.recipient_id} falló:`, JSON.stringify(status.errors));

  if (code === 131047 && status.recipient_id === config.ownerPhone) {
    if (!config.summaryTemplateName) {
      console.error("Llevas más de 24 h sin escribirle al bot y no hay SUMMARY_TEMPLATE_NAME configurada.");
      return;
    }
    if (templateSentOn === today()) return;
    templateSentOn = today();
    await sendTemplate(config.ownerPhone, config.summaryTemplateName, config.summaryTemplateLang);
  }
}
