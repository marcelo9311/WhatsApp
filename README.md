# WhatsApp + Claude: revisión diaria

Este bot se conecta a un número de WhatsApp Business mediante la **WhatsApp Cloud API**, que es la API oficial de Meta.

- **Guarda** todos los mensajes que llegan durante el día.
- **Lee los reportes**: cuando alguien manda una foto o un documento (PDF, CSV, TXT), Claude extrae la información importante y la guarda.
- **Envía un resumen automático** todos los días a la hora que configures, con lo más importante, los reportes, los pendientes y las alertas.
- **Responde tus preguntas**: escríbele al bot desde tu número, por ejemplo "¿quién mandó el reporte de bodega?" o "¿hubo algún problema hoy?". Si escribes `resumen`, te manda el resumen en ese momento.

## 1. Requisitos

- Node.js 22.5 o superior
- Una clave de API de Claude, que creas en <https://console.anthropic.com>
- Una cuenta de Meta Business y una app en <https://developers.facebook.com> con el producto **WhatsApp** agregado
- Un número de teléfono para el bot. Tiene que ser un número que **no** esté usando la app normal de WhatsApp ni WhatsApp Business.
- Un servidor con HTTPS para recibir el webhook. Puede ser Railway, Render, Fly.io o un VPS. Para hacer pruebas puedes usar `ngrok`.

## 2. Configurar Meta (WhatsApp Cloud API)

1. En tu app de Meta, ve a **WhatsApp > Configuración de la API**. Anota el **Phone number ID** del número del bot.
2. Crea un **token permanente**: Configuración del negocio > Usuarios del sistema > crea un usuario > Generar token, con los permisos `whatsapp_business_messaging` y `whatsapp_business_management`. El token temporal de la página de la API vence en 24 horas.
3. En **Configuración de la app > Básica**, copia la **Clave secreta de la app**.

## 3. Instalar y configurar

```bash
npm install
cp .env.example .env    # y completa los valores
```

| Variable | Qué es |
|---|---|
| `ANTHROPIC_API_KEY` | Tu clave de Claude |
| `WHATSAPP_TOKEN` | Token permanente del paso 2 |
| `WHATSAPP_PHONE_NUMBER_ID` | ID del número del bot |
| `WHATSAPP_APP_SECRET` | Clave secreta de la app; se usa para verificar que los mensajes vienen de Meta |
| `WHATSAPP_VERIFY_TOKEN` | Una palabra secreta que tú inventas y que usas en el paso 4 |
| `OWNER_PHONE` | **Tu** número personal, con código de país y sin `+` (por ejemplo `573001234567`). El bot te manda el resumen a este número y trata lo que escribes desde él como preguntas. |
| `DAILY_SUMMARY_TIME` / `TIMEZONE` | Hora del resumen (por ejemplo `19:00`) y zona horaria (por ejemplo `America/Bogota`) |
| `ACK_MESSAGE` | Respuesta automática para quien manda un mensaje. Déjala vacía si no quieres responder. |

## 4. Ejecutar y conectar el webhook

```bash
npm run build && npm start      # producción
npm run dev                     # desarrollo (se reinicia al guardar)
```

1. Publica el servidor con HTTPS. Para pruebas: `ngrok http 3000`.
2. En Meta, ve a **WhatsApp > Configuración > Webhook > Editar**:
   - URL de devolución de llamada: `https://TU-DOMINIO/webhook`
   - Token de verificación: el valor de `WHATSAPP_VERIFY_TOKEN`
3. En **Campos del webhook**, suscríbete a `messages`.
4. Desde tu celular, escríbele al número del bot. Si te responde, ya está conectado.

## 5. La regla de las 24 horas

WhatsApp solo deja que el negocio envíe mensajes libres a alguien que le haya escrito en las últimas 24 horas. Si llevas más de un día sin escribirle al bot, el resumen automático no te va a llegar. Hay dos soluciones:

- **La más simple:** escríbele cualquier cosa al bot cada día, por ejemplo `resumen`.
- **La automática:** crea en Meta (**WhatsApp > Plantillas de mensajes**) una plantilla de categoría *Utilidad* que diga algo como *"Tu resumen del día está listo. Responde RESUMEN para verlo."* Cuando Meta la apruebe, pon su nombre en `SUMMARY_TEMPLATE_NAME`. Si el resumen no se puede entregar, el bot te manda esa plantilla y tú respondes `resumen`.

## Estructura

```
src/
  index.ts      servidor web: webhook de Meta y tarea programada del resumen
  bot.ts        lógica: guardar mensajes, analizar reportes, responder al dueño, resumen
  claude.ts     llamadas a Claude (análisis de archivos, resumen, preguntas)
  whatsapp.ts   envío de mensajes y descarga de archivos de WhatsApp
  db.ts         base de datos SQLite (data/bot.db)
  config.ts     variables de entorno
```

## Notas

- Las notas de voz y los videos se guardan como un mensaje, pero no se transcriben.
- Los mensajes quedan guardados en `data/bot.db`. Si lo despliegas en Railway o Render, monta un disco persistente en `data/` para no perder el historial cuando el servidor se reinicie.
