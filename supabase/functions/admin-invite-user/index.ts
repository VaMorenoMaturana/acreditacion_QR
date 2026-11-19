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

    // Valida el JWT del administrador que realiza la solicitud.
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
      return jsonResponse(403, { error: "Solo un administrador puede crear cuentas." });
    }

    let payload: { email?: unknown; password?: unknown; role?: unknown };
    try {
      payload = await req.json();
    } catch {
      return jsonResponse(400, { error: "El cuerpo de la solicitud no es válido." });
    }

    const email = String(payload.email ?? "").trim().toLowerCase();
    const password = typeof payload.password === "string" ? payload.password : "";
    const role = payload.role;

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
      return jsonResponse(400, { error: "Ingrese una dirección de correo válida." });
    }
    if (password.length < 8 || password.length > 128) {
      return jsonResponse(400, { error: "La contraseña debe tener entre 8 y 128 caracteres." });
    }
    if (role !== "staff" && role !== "admin") {
      return jsonResponse(400, { error: "El rol seleccionado no es válido." });
    }

    // Crear la cuenta directamente y confirmar el correo para habilitar el acceso inmediato.
    // createUser no envía invitaciones ni correos de confirmación.
    const { data: createData, error: createError } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (createError || !createData.user) {
      const message = createError?.message || "No fue posible crear la cuenta.";
      return jsonResponse(400, { error: message });
    }

    const newUser = createData.user;
    // El trigger handle_new_user crea un perfil staff; se asigna aquí el rol solicitado.
    const { error: saveProfileError } = await adminClient
      .from("profiles")
      .upsert(
        { id: newUser.id, email: newUser.email ?? email, role },
        { onConflict: "id" },
      );

    if (saveProfileError) {
      await adminClient.auth.admin.deleteUser(newUser.id);
      console.error("No se pudo guardar el perfil de la nueva cuenta:", saveProfileError.message);
      return jsonResponse(500, { error: "No se pudo asignar el rol. La cuenta fue revertida; vuelva a intentarlo." });
    }

    // Nunca registrar la contraseña en auditoría ni devolverla al navegador.
    const { error: auditError } = await adminClient.from("audit_logs").insert({
      actor_id: callerData.user.id,
      action: "user_created",
      entity_type: "user",
      entity_id: newUser.id,
      details: { email, role },
    });
    if (auditError) console.warn("No se pudo registrar la auditoría de la cuenta:", auditError.message);

    return jsonResponse(200, {
      success: true,
      email,
      role,
      message: "Cuenta creada y habilitada. El usuario ya puede iniciar sesión con el correo y la contraseña asignada.",
    });
  } catch (error) {
    console.error("Error al crear cuenta de usuario:", error);
    return jsonResponse(500, { error: "Ocurrió un error interno al crear la cuenta." });
  }
});
