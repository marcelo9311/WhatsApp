import { config } from "./config.js";

const GRAPH = `https://graph.facebook.com/${config.graphVersion}`;
const auth = { Authorization: `Bearer ${config.whatsappToken}` };

async function graphPost(path: string, body: unknown): Promise<any> {
  const res = await fetch(`${GRAPH}/${path}`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`WhatsApp API ${res.status}: ${JSON.stringify(data.error ?? data)}`);
  return data;
}

// WhatsApp corta los mensajes de más de 4096 caracteres.
const MAX_LEN = 4000;

function split(text: string): string[] {
  const parts: string[] = [];
  let rest = text;
  while (rest.length > MAX_LEN) {
    const cut = rest.lastIndexOf("\n", MAX_LEN) > MAX_LEN / 2 ? rest.lastIndexOf("\n", MAX_LEN) : MAX_LEN;
    parts.push(rest.slice(0, cut));
    rest = rest.slice(cut).trimStart();
  }
  parts.push(rest);
  return parts;
}

/** Envía un texto. Devuelve los ids de los mensajes enviados. */
export async function sendText(to: string, text: string): Promise<string[]> {
  const ids: string[] = [];
  for (const part of split(text)) {
    const data = await graphPost(`${config.phoneNumberId}/messages`, {
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: part, preview_url: false },
    });
    ids.push(data.messages?.[0]?.id);
  }
  return ids;
}

/** Envía una plantilla aprobada (necesaria si el destinatario lleva más de 24 h sin escribir). */
export async function sendTemplate(to: string, name: string, lang: string): Promise<void> {
  await graphPost(`${config.phoneNumberId}/messages`, {
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: { name, language: { code: lang } },
  });
}

export async function markAsRead(messageId: string): Promise<void> {
  await graphPost(`${config.phoneNumberId}/messages`, {
    messaging_product: "whatsapp",
    status: "read",
    message_id: messageId,
  }).catch(() => {}); // no es crítico
}

/** Descarga un archivo (foto, PDF...) que llegó por WhatsApp. */
export async function downloadMedia(mediaId: string): Promise<{ data: Buffer; mimeType: string }> {
  const metaRes = await fetch(`${GRAPH}/${mediaId}`, { headers: auth });
  const meta = await metaRes.json();
  if (!metaRes.ok) throw new Error(`No se pudo obtener el archivo ${mediaId}: ${JSON.stringify(meta)}`);

  const fileRes = await fetch(meta.url, { headers: auth });
  if (!fileRes.ok) throw new Error(`No se pudo descargar el archivo ${mediaId}: ${fileRes.status}`);
  return { data: Buffer.from(await fileRes.arrayBuffer()), mimeType: meta.mime_type };
}
