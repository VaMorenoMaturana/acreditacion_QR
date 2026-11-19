import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse(405, { error: "Método no permitido." });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      console.error("Falta configurar una variable de entorno requerida.");
      return jsonResponse(500, { error: "La función no está configurada correctamente." });
    }

    const authorization = req.headers.get("Authorization") || "";
    if (!authorization.startsWith("Bearer ")) {
      return jsonResponse(401, { error: "Debe iniciar sesión para realizar esta acción." });
    }

    // Validar el JWT del usuario que realiza la solicitud.
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: callerData, error: callerError } = await callerClient.auth.getUser();
    if (callerError || !callerData.user) {
      return jsonResponse(401, { error: "La sesión no es válida o ha expirado." });
    }

    // La clave privilegiada solo se utiliza en el servidor; nunca se entrega al navegador.
    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: callerProfile, error: profileError } = await adminClient
      .from("profiles")
      .select("role")
      .eq("id", callerData.user.id)
      .maybeSingle();

    if (profileError || callerProfile?.role !== "admin") {
      return jsonResponse(403, { error: "Solo un administrador puede invitar usuarios." });
    }

    let payload: { email?: unknown; role?: unknown };
    try {
      payload = await req.json();
    } catch {
      return jsonResponse(400, { error: "El cuerpo de la solicitud no es válido." });
    }

    const email = String(payload.email ?? "").trim().toLowerCase();
    const role = payload.role;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
      return jsonResponse(400, { error: "Ingrese una dirección de correo válida." });
    }
    if (role !== "staff" && role !== "admin") {
      return jsonResponse(400, { error: "El rol seleccionado no es válido." });
    }
    if (email === String(callerData.user.email ?? "").toLowerCase()) {
      return jsonResponse(400, { error: "No puede invitar su propia cuenta." });
    }

    const { data: inviteData, error: inviteError } =
      await adminClient.auth.admin.inviteUserByEmail(email);

    if (inviteError || !inviteData.user) {
      const message = inviteError?.message || "No fue posible crear la invitación.";
      return jsonResponse(400, { error: message });
    }

    const invitedUser = inviteData.user;
    const { error: saveProfileError } = await adminClient
      .from("profiles")
      .upsert(
        { id: invitedUser.id, email: invitedUser.email ?? email, role },
        { onConflict: "id" },
      );

    if (saveProfileError) {
      // Evita dejar una cuenta creada sin el rol solicitado.
      await adminClient.auth.admin.deleteUser(invitedUser.id);
      console.error("No se pudo guardar el perfil del usuario invitado:", saveProfileError.message);
      return jsonResponse(500, { error: "Se creó la invitación, pero no se pudo asignar el rol. La cuenta fue revertida; vuelva a intentarlo." });
    }

    const { error: auditError } = await adminClient.from("audit_logs").insert({
      actor_id: callerData.user.id,
      action: "user_invited",
      entity_type: "user",
      entity_id: invitedUser.id,
      details: { email, role },
    });
    if (auditError) console.warn("No se pudo registrar la auditoría de la invitación:", auditError.message);

    return jsonResponse(200, {
      success: true,
      email,
      role,
      message: "Invitación enviada. El usuario debe abrir el correo y definir su contraseña.",
    });
  } catch (error) {
    console.error("Error al invitar usuario:", error);
    return jsonResponse(500, { error: "Ocurrió un error interno al procesar la invitación." });
  }
});
