import Anthropic from "@anthropic-ai/sdk";
import type { StoredMessage } from "./db.js";

const client = new Anthropic();
const MODEL = "claude-opus-5-5";

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;
type ImageType = (typeof IMAGE_TYPES)[number];

const BASE_SYSTEM = `Eres el asistente de operaciones de una empresa. Recibes por WhatsApp los mensajes y reportes que el equipo y los clientes envían durante el día, y ayudas al dueño a estar al tanto.
Respondes siempre en español, en un tono claro y directo.
Tus respuestas se leen en WhatsApp: usa párrafos cortos y listas con "•". Para resaltar usa *negrita* (un asterisco a cada lado), nunca ** ni encabezados con #.
No inventes datos: si algo no aparece en los mensajes, dilo.`;

async function ask(system: string, messages: Anthropic.Beta.BetaMessageParam[]): Promise<string> {
  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    output_config: { effort: "medium" },
    // Si los filtros de seguridad rechazan la petición, la API la reintenta con otro modelo.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system,
    messages,
  });

  if (response.stop_reason === "refusal") {
    return "No pude procesar esta solicitud.";
  }
  return response.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

/** Convierte los mensajes del día en un texto que Claude puede leer. */
function transcript(messages: StoredMessage[]): string {
  if (messages.length === 0) return "(No llegaron mensajes hoy.)";
  return messages
    .map((m) => {
      const who = m.name ? `${m.name} (+${m.phone})` : `+${m.phone}`;
      const kind = m.type === "text" ? "" : `[${m.type}] `;
      let line = `[${m.time}] ${who}: ${kind}${m.text ?? ""}`.trimEnd();
      if (m.analysis) line += `\n    → Contenido del archivo: ${m.analysis.replace(/\n/g, "\n      ")}`;
      return line;
    })
    .join("\n");
}

/**
 * Lee una foto o documento que alguien envió (por ejemplo un reporte) y devuelve su contenido.
 * Devuelve null si el tipo de archivo no se puede analizar.
 */
export async function analyzeReport(
  file: { data: Buffer; mimeType: string },
  caption: string | null,
  sender: string,
): Promise<string | null> {
  const mime = file.mimeType.split(";")[0].trim();
  let content: Anthropic.Beta.BetaContentBlockParam;

  if ((IMAGE_TYPES as readonly string[]).includes(mime)) {
    content = {
      type: "image",
      source: { type: "base64", media_type: mime as ImageType, data: file.data.toString("base64") },
    };
  } else if (mime === "application/pdf") {
    content = {
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: file.data.toString("base64") },
    };
  } else if (mime.startsWith("text/") || mime === "application/csv") {
    content = { type: "text", text: `Contenido del archivo:\n${file.data.toString("utf8")}` };
  } else {
    return null;
  }

  return ask(BASE_SYSTEM, [
    {
      role: "user",
      content: [
        content,
        {
          type: "text",
          text: `${sender} envió este archivo por WhatsApp${caption ? ` con el mensaje: "${caption}"` : ""}.
Extrae la información importante: qué es, cifras, fechas, pendientes, problemas o cualquier cosa que el dueño deba saber. Sé conciso; esto se guardará para el resumen del día.`,
        },
      ],
    },
  ]);
}

/** Genera el resumen del día. */
export async function dailySummary(day: string, messages: StoredMessage[]): Promise<string> {
  return ask(BASE_SYSTEM, [
    {
      role: "user",
      content: `Estos son los mensajes que llegaron el ${day}:

${transcript(messages)}

Escribe el resumen del día para el dueño. Incluye:
• Lo más importante del día
• Reportes recibidos y sus datos clave
• Pendientes y a quién falta responderle
• Problemas o alertas
Omite las secciones que no tengan contenido.`,
    },
  ]);
}

/** Responde una pregunta del dueño usando los mensajes del día como contexto. */
export async function answerOwner(
  day: string,
  dayMessages: StoredMessage[],
  conversation: Anthropic.Beta.BetaMessageParam[],
): Promise<string> {
  const system = `${BASE_SYSTEM}

Estás hablando con el dueño. Responde sus preguntas usando los mensajes de hoy (${day}):

${transcript(dayMessages)}`;
  return ask(system, conversation);
}
