import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Falta la variable de entorno ${name} (revisa tu archivo .env)`);
  return value;
}

const [hour, minute] = (process.env.DAILY_SUMMARY_TIME ?? "19:00").split(":").map(Number);

export const config = {
  whatsappToken: required("WHATSAPP_TOKEN"),
  phoneNumberId: required("WHATSAPP_PHONE_NUMBER_ID"),
  appSecret: required("WHATSAPP_APP_SECRET"),
  verifyToken: required("WHATSAPP_VERIFY_TOKEN"),
  ownerPhone: required("OWNER_PHONE").replace(/\D/g, ""),
  summaryHour: hour,
  summaryMinute: minute ?? 0,
  timezone: process.env.TIMEZONE ?? "America/Bogota",
  ackMessage: process.env.ACK_MESSAGE ?? "",
  summaryTemplateName: process.env.SUMMARY_TEMPLATE_NAME ?? "",
  summaryTemplateLang: process.env.SUMMARY_TEMPLATE_LANG ?? "es",
  port: Number(process.env.PORT ?? 3000),
  dbPath: process.env.DB_PATH ?? "data/bot.db",
  graphVersion: "v23.0",
};

if (!Number.isInteger(config.summaryHour) || !Number.isInteger(config.summaryMinute)) {
  throw new Error("DAILY_SUMMARY_TIME debe tener el formato HH:MM, por ejemplo 19:00");
}

/** Fecha de hoy (YYYY-MM-DD) en la zona horaria del negocio. */
export function today(date = new Date()): string {
  return date.toLocaleDateString("en-CA", { timeZone: config.timezone });
}
