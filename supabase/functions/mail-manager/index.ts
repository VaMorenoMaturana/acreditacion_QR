import { createClient } from "npm:@supabase/supabase-js@^2";
import { corsHeaders } from "npm:@supabase/supabase-js@^2/cors";
import nodemailer from "npm:nodemailer@^9";
import { Buffer } from "node:buffer";

type MailConfig = {
  host: string;
  port: number;
  security: "starttls" | "tls";
  username: string;
  senderEmail: string;
  senderName: string;
};
type SavedMailConfig = {
  smtp_host: string;
  smtp_port: number;
  smtp_security: "starttls" | "tls";
  smtp_username: string;
  smtp_password_ciphertext: string;
  sender_email: string;
  sender_name: string;
  updated_at: string;
};

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
function fail(status: number, message: string) {
  return jsonResponse(status, { error: message });
}
function textValue(value: unknown, max = 180) {
  return String(value ?? "").trim().slice(0, max);
}
function validEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;
}
function encodeBase64(bytes: Uint8Array) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}
function decodeBase64(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
async function encryptionKey() {
  const secret = Deno.env.get("MAIL_SETTINGS_ENCRYPTION_KEY") || "";
  if (secret.length < 32) throw new Error("Configure MAIL_SETTINGS_ENCRYPTION_KEY como una cadena aleatoria de al menos 32 caracteres en Edge Function Secrets.");
  const raw = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return await crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}
async function encryptPassword(password: string) {
  const key = await encryptionKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv }, key, new TextEncoder().encode(password),
  ));
  const packed = new Uint8Array(iv.length + encrypted.length);
  packed.set(iv, 0);
  packed.set(encrypted, iv.length);
  return encodeBase64(packed);
}
async function decryptPassword(ciphertext: string) {
  const packed = decodeBase64(ciphertext);
  if (packed.length < 29) throw new Error("La credencial SMTP almacenada no es válida.");
  const key = await encryptionKey();
  const iv = packed.slice(0, 12);
  const ciphertextBytes = packed.slice(12);
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertextBytes);
  return new TextDecoder().decode(decrypted);
}
function parseConfig(value: unknown): MailConfig {
  const data = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const host = textValue(data.host, 253).toLowerCase();
  const port = Number(data.port);
  const security = data.security === "tls" ? "tls" : "starttls";
  const username = textValue(data.username, 254);
  const senderEmail = textValue(data.senderEmail, 254).toLowerCase();
  const senderName = textValue(data.senderName, 120);
  if (!host || /\s/.test(host)) throw new Error("Ingrese un servidor SMTP válido.");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("El puerto SMTP debe ser un número entre 1 y 65535.");
  if ([25, 587].includes(port)) {
    throw new Error("Supabase Edge Functions restringe la salida SMTP por los puertos 25 y 587. Use un puerto alternativo habilitado por su proveedor, por ejemplo 2587 o 2525. El puerto 465 puede utilizarse con TLS directo si su proveedor y el entorno admiten la conexión.");
  }
  if (!username) throw new Error("Ingrese el usuario SMTP.");
  if (!validEmail(senderEmail)) throw new Error("Ingrese un correo remitente válido.");
  if (!senderName || /[\\r\\n]/.test(senderName)) throw new Error("Ingrese un nombre remitente válido, sin saltos de línea.");
  return { host, port, security, username, senderEmail, senderName };
}
function createTransport(config: MailConfig, password: string) {
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.security === "tls",
    requireTLS: config.security === "starttls",
    auth: { user: config.username, pass: password },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 30000,
    tls: { minVersion: "TLSv1.2" },
  });
}
function htmlEscape(value: string) {
  return value.replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[character] || character));
}
function personalize(value: string, replacements: Record<string, string>) {
  let result = value;
  for (const [key, replacement] of Object.entries(replacements)) {
    result = result.replaceAll(`{{${key}}}`, replacement);
  }
  return result;
}
function safeFilePart(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 45) || "participante";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return fail(405, "Método no permitido.");

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      return fail(500, "La función de correo no está configurada correctamente.");
    }

    const authorization = req.headers.get("Authorization") || "";
    if (!authorization.startsWith("Bearer ")) return fail(401, "Debe iniciar sesión.");

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: callerData, error: callerError } = await callerClient.auth.getUser();
    if (callerError || !callerData.user) return fail(401, "La sesión no es válida o ha expirado.");

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: profile, error: profileError } = await admin
      .from("profiles").select("id,role,organization_id")
      .eq("id", callerData.user.id).maybeSingle();
    if (profileError || profile?.role !== "admin" || !profile.organization_id) {
      return fail(403, "Solo el administrador de una organización puede configurar o enviar entradas por correo.");
    }
    const organizationId = profile.organization_id as string;

    let payload: Record<string, unknown>;
    try { payload = await req.json(); }
    catch { return fail(400, "El cuerpo de la solicitud no es válido."); }
    const action = textValue(payload.action, 50);

    const { data: savedRow, error: savedError } = await admin
      .from("mail_smtp_settings").select("*")
      .eq("organization_id", organizationId).maybeSingle();
    if (savedError) throw new Error(savedError.message);
    const saved = savedRow as SavedMailConfig | null;

    const safeSettings = () => saved ? ({
      configured: true,
      host: saved.smtp_host,
      port: saved.smtp_port,
      security: saved.smtp_security,
      username: saved.smtp_username,
      senderEmail: saved.sender_email,
      senderName: saved.sender_name,
      hasPassword: Boolean(saved.smtp_password_ciphertext),
      updatedAt: saved.updated_at,
    }) : ({
      configured: false, host: "", port: 2587, security: "starttls",
      username: "", senderEmail: "", senderName: "", hasPassword: false, updatedAt: null,
    });

    if (action === "get_settings") {
      return jsonResponse(200, { settings: safeSettings() });
    }

    if (action === "save_settings") {
      const config = parseConfig(payload.settings);
      const newPassword = typeof payload.password === "string" ? payload.password : "";
      if (newPassword.length > 512) return fail(400, "La contraseña SMTP supera el largo permitido.");
      const passwordCiphertext = newPassword
        ? await encryptPassword(newPassword)
        : saved?.smtp_password_ciphertext || "";
      if (!passwordCiphertext) return fail(400, "Ingrese la contraseña SMTP para guardar la configuración inicial.");
      const { error } = await admin.from("mail_smtp_settings").upsert({
        organization_id: organizationId,
        smtp_host: config.host,
        smtp_port: config.port,
        smtp_security: config.security,
        smtp_username: config.username,
        smtp_password_ciphertext: passwordCiphertext,
        sender_email: config.senderEmail,
        sender_name: config.senderName,
        updated_by: callerData.user.id,
        updated_at: new Date().toISOString(),
      }, { onConflict: "organization_id" });
      if (error) throw new Error(error.message);
      return jsonResponse(200, { success: true, settings: {
        configured: true, ...config, hasPassword: true, updatedAt: new Date().toISOString(),
      } });
    }

    if (action === "test_connection") {
      const suppliedSettings = payload.settings && typeof payload.settings === "object";
      const config = suppliedSettings ? parseConfig(payload.settings) : saved ? ({
        host: saved.smtp_host, port: saved.smtp_port, security: saved.smtp_security,
        username: saved.smtp_username, senderEmail: saved.sender_email, senderName: saved.sender_name,
      } as MailConfig) : null;
      if (!config) return fail(400, "Primero guarde una configuración SMTP.");
      const suppliedPassword = typeof payload.password === "string" ? payload.password : "";
      const password = suppliedPassword || (saved?.smtp_password_ciphertext
        ? await decryptPassword(saved.smtp_password_ciphertext) : "");
      if (!password) return fail(400, "Ingrese la contraseña SMTP.");
      const transport = createTransport(config, password);
      try {
        await transport.verify();
      } finally {
        transport.close();
      }
      return jsonResponse(200, { connected: true, message: "Conexión y autenticación SMTP verificadas." });
    }

    if (action === "list_activity_logs") {
      const activityId = textValue(payload.activity_id, 64);
      if (!activityId) return fail(400, "Seleccione una actividad.");
      const { data: activity, error: activityError } = await admin.from("activities")
        .select("id").eq("id", activityId).eq("organization_id", organizationId).maybeSingle();
      if (activityError) throw new Error(activityError.message);
      if (!activity) return fail(404, "La actividad no pertenece a esta organización.");
      const { data, error } = await admin.from("mail_delivery_logs")
        .select("id,registration_id,status,recipient_email,subject,error_message,created_at")
        .eq("organization_id", organizationId).eq("activity_id", activityId)
        .order("created_at", { ascending: false }).limit(3000);
      if (error) throw new Error(error.message);
      return jsonResponse(200, { logs: data || [] });
    }

    if (action === "send_one") {
      if (!saved?.smtp_password_ciphertext) return fail(400, "La organización no tiene una configuración SMTP guardada.");
      const registrationId = textValue(payload.registration_id, 64);
      const subjectTemplate = textValue(payload.subject, 180);
      const bodyTemplate = String(payload.body ?? "").trim().slice(0, 8000);
      const attachmentBase64 = typeof payload.attachment_base64 === "string" ? payload.attachment_base64 : "";
      if (!registrationId) return fail(400, "No se indicó la inscripción que recibirá el correo.");
      if (!subjectTemplate || /[\r\n]/.test(subjectTemplate)) return fail(400, "Ingrese un asunto válido, sin saltos de línea.");
      if (!bodyTemplate) return fail(400, "Ingrese el texto descriptivo del correo.");
      if (!attachmentBase64 || attachmentBase64.length > 4_300_000) {
        return fail(400, "La entrada PDF está vacía o supera el tamaño máximo permitido de 3 MB.");
      }

      const { data: registration, error: registrationError } = await admin.from("registrations")
        .select("id,organization_id,activity_id,attendee_id,status")
        .eq("id", registrationId).eq("organization_id", organizationId).maybeSingle();
      if (registrationError) throw new Error(registrationError.message);
      if (!registration) return fail(404, "La inscripción no pertenece a esta organización.");
      if (registration.status === "cancelled") return fail(400, "No se puede enviar una entrada de una inscripción cancelada.");

      const [attendeeResult, activityResult] = await Promise.all([
        admin.from("attendees").select("id,organization_id,full_name,email")
          .eq("id", registration.attendee_id).eq("organization_id", organizationId).maybeSingle(),
        admin.from("activities").select("id,organization_id,name,event_date,place")
          .eq("id", registration.activity_id).eq("organization_id", organizationId).maybeSingle(),
      ]);
      if (attendeeResult.error) throw new Error(attendeeResult.error.message);
      if (activityResult.error) throw new Error(activityResult.error.message);
      const attendee = attendeeResult.data;
      const activity = activityResult.data;
      if (!attendee || !activity) return fail(404, "No se encontraron los datos del participante o del evento.");
      const recipient = textValue(attendee.email, 254).toLowerCase();
      if (!validEmail(recipient)) return fail(400, "Esta persona no tiene un correo electrónico válido.");

      const pdfBytes = decodeBase64(attachmentBase64);
      if (pdfBytes.length < 5 || new TextDecoder().decode(pdfBytes.slice(0, 5)) !== "%PDF-") {
        return fail(400, "El archivo adjunto no parece ser un PDF válido.");
      }
      if (pdfBytes.length > 3 * 1024 * 1024) return fail(400, "La entrada PDF supera el tamaño máximo de 3 MB.");

      const replacements = {
        nombre: String(attendee.full_name || "Participante"),
        evento: String(activity.name || "Evento"),
        fecha: String(activity.event_date || ""),
        lugar: String(activity.place || ""),
      };
      const subject = personalize(subjectTemplate, replacements);
      if (!subject || /[\r\n]/.test(subject)) return fail(400, "El asunto personalizado no es válido.");
      const body = personalize(bodyTemplate, replacements);
      const text = `Hola ${replacements.nombre},\n\n${body}\n\nAdjuntamos su entrada personal en formato PDF. Presente el código QR al ingresar al evento.`;
      const html = `<!doctype html><html lang="es"><body style="margin:0;padding:28px;background:#f4f2f6;font-family:Arial,sans-serif;color:#251e2b"><main style="max-width:620px;margin:auto;background:#fff;padding:30px;border-radius:12px"><p>Hola <strong>${htmlEscape(replacements.nombre)}</strong>,</p><p>${htmlEscape(body).replace(/\r?\n/g, "<br>")}</p><p>Adjuntamos su entrada personal en formato PDF. Presente el código QR al ingresar al evento.</p><p style="margin-top:28px;color:#756b7b;font-size:12px">Este mensaje fue enviado por ${htmlEscape(saved.sender_name)}.</p></main></body></html>`;

      const config: MailConfig = {
        host: saved.smtp_host, port: saved.smtp_port, security: saved.smtp_security,
        username: saved.smtp_username, senderEmail: saved.sender_email, senderName: saved.sender_name,
      };
      let messageId: string | null = null;
      let sendError: string | null = null;
      const transport = createTransport(config, await decryptPassword(saved.smtp_password_ciphertext));
      try {
        const info = await transport.sendMail({
          from: { name: config.senderName, address: config.senderEmail },
          to: { name: replacements.nombre, address: recipient },
          subject, text, html,
          attachments: [{
            filename: `entrada-${safeFilePart(replacements.nombre)}.pdf`,
            content: Buffer.from(pdfBytes),
            contentType: "application/pdf",
          }],
        });
        messageId = String(info.messageId || "");
      } catch (error) {
        sendError = String(error instanceof Error ? error.message : error).slice(0, 600);
      } finally {
        transport.close();
      }

      const { error: logError } = await admin.from("mail_delivery_logs").insert({
        organization_id: organizationId,
        activity_id: registration.activity_id,
        registration_id: registration.id,
        sent_by: callerData.user.id,
        recipient_email: recipient,
        subject,
        status: sendError ? "failed" : "sent",
        provider_message_id: messageId,
        error_message: sendError,
      });
      if (logError) console.error("No se pudo guardar el registro de entrega:", logError.message);
      if (sendError) return fail(502, `No se pudo enviar a ${recipient}: ${sendError}`);
      return jsonResponse(200, { sent: true, recipient, messageId });
    }

    return fail(400, "La acción solicitada no es válida.");
  } catch (error) {
    console.error("mail-manager error:", error instanceof Error ? error.message : error);
    const message = error instanceof Error ? error.message : "Error interno del servicio de correo.";
    return fail(500, message.slice(0, 700));
  }
});
