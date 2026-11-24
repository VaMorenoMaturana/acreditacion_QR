import { createClient } from "npm:@supabase/supabase-js@^2";
import { corsHeaders } from "npm:@supabase/supabase-js@^2/cors";

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
function slugify(value: string) {
  const base = value.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 42);
  return (base || "organizacion") + "-" + crypto.randomUUID().slice(0, 8);
}
function validLayout(layout: unknown) {
  if (!layout || typeof layout !== "object" || Array.isArray(layout)) return false;
  const value = layout as Record<string, unknown>;
  if (!Array.isArray(value.rows) || value.rows.length < 1 || value.rows.length > 100) return false;
  let total = 0;
  for (const row of value.rows) {
    if (!row || typeof row !== "object") return false;
    const r = row as Record<string, unknown>;
    if (!textValue(r.label, 40) || !Array.isArray(r.sections) || r.sections.length < 1 || r.sections.length > 6) return false;
    for (const section of r.sections) {
      if (!section || typeof section !== "object") return false;
      const s = section as Record<string, unknown>;
      const seats = Number(s.seats);
      if (!textValue(s.label, 40) || !Number.isInteger(seats) || seats < 1 || seats > 100) return false;
      total += seats;
    }
  }
  return total >= 1 && total <= 3000;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return fail(405, "Método no permitido.");

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      console.error("Falta configurar una variable de entorno requerida.");
      return fail(500, "La función no está configurada. Revise los secretos de Supabase.");
    }

    const authorization = req.headers.get("Authorization") || "";
    if (!authorization.startsWith("Bearer ")) return fail(401, "Debe iniciar sesión.");

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: callerData, error: callerError } = await callerClient.auth.getUser();
    const caller = callerData.user;
    if (callerError || !caller) {
      return fail(401, "La sesión no es válida o ha expirado.");
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: callerProfile, error: callerProfileError } = await admin
      .from("profiles").select("id,email,role,organization_id")
      .eq("id", caller.id).maybeSingle();
    if (callerProfileError || callerProfile?.role !== "superadmin" ||
        callerProfile.organization_id !== null) {
      return fail(403, "Esta cuenta no tiene permisos de superadministrador global.");
    }

    let payload: Record<string, unknown>;
    try { payload = await req.json(); }
    catch { return fail(400, "El cuerpo de la solicitud no es válido."); }
    const action = textValue(payload.action, 60);

    const audit = async (actionName: string, entity: string, entityId: string | null, details: Record<string, unknown> = {}) => {
      const { error } = await admin.from("platform_audit_logs").insert({
        actor_id: caller.id, action: actionName, entity_type: entity,
        entity_id: entityId, details,
      });
      if (error) console.error("No se pudo guardar auditoría de plataforma:", error.message);
    };
    const requireOrganization = async (id: string) => {
      const { data, error } = await admin.from("organizations").select("id,name,slug").eq("id", id).maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) throw new Error("La organización seleccionada no existe.");
      return data;
    };
    const requireAnotherActiveSuperadmin = async (excludedUserId: string) => {
      const { data: superadminProfiles, error: superadminProfilesError } = await admin
        .from("profiles").select("id").eq("role", "superadmin");
      if (superadminProfilesError) throw new Error(superadminProfilesError.message);
      for (const profile of superadminProfiles || []) {
        if (profile.id === excludedUserId) continue;
        const { data: authData, error: authLookupError } = await admin.auth.admin.getUserById(profile.id);
        if (authLookupError || !authData.user) continue;
        const bannedUntil = authData.user.banned_until ? new Date(authData.user.banned_until).getTime() : 0;
        if (!bannedUntil || bannedUntil <= Date.now()) return;
      }
      throw new Error("La operación dejaría la plataforma sin otro superadministrador activo. Cree o active otro superadministrador primero.");
    };
    const dbError = (error: { message: string } | null) => {
      if (error) throw new Error(error.message);
    };

    switch (action) {
      case "overview": {
        const tables = ["organizations","profiles","activities","attendees","registrations","check_ins","auditorium_templates"] as const;
        const results = await Promise.all(tables.map(name => admin.from(name).select("*", { count: "exact", head: true })));
        const counts: Record<string, number> = {};
        tables.forEach((name, i) => {
          if (results[i].error) throw new Error(results[i].error.message);
          counts[name] = results[i].count || 0;
        });
        return jsonResponse(200, { counts });
      }
      case "list_organizations": {
        const { data, error } = await admin.from("organizations")
          .select("id,name,slug,created_at,created_by").order("created_at", { ascending: false }).limit(1000);
        dbError(error);
        const [profiles, activities, templates] = await Promise.all([
          admin.from("profiles").select("organization_id"),
          admin.from("activities").select("organization_id"),
          admin.from("auditorium_templates").select("organization_id"),
        ]);
        dbError(profiles.error); dbError(activities.error); dbError(templates.error);
        const countBy = (rows: Array<{organization_id:string|null}>) => rows.reduce((acc, row) => {
          if (row.organization_id) acc[row.organization_id] = (acc[row.organization_id] || 0) + 1;
          return acc;
        }, {} as Record<string,number>);
        const pc = countBy(profiles.data || []), ac = countBy(activities.data || []), tc = countBy(templates.data || []);
        return jsonResponse(200, { organizations: (data || []).map(org => ({
          ...org, users_count: pc[org.id] || 0, activities_count: ac[org.id] || 0, auditoriums_count: tc[org.id] || 0,
        })) });
      }
      case "save_organization": {
        const id = textValue(payload.id, 64);
        const name = textValue(payload.name, 180);
        if (name.length < 2) return fail(400, "El nombre debe tener al menos 2 caracteres.");
        let result;
        if (id) {
          const current = await requireOrganization(id);
          const response = await admin.from("organizations").update({ name }).eq("id", id)
            .select("id,name,slug,created_at,created_by").single();
          dbError(response.error); result = response.data;
          await audit("organization_updated", "organization", id, { previous_name: current.name, name });
        } else {
          const response = await admin.from("organizations").insert({
            name, slug: slugify(name), created_by: caller.id,
          }).select("id,name,slug,created_at,created_by").single();
          dbError(response.error); result = response.data;
          await audit("organization_created", "organization", result.id, { name });
        }
        return jsonResponse(200, { organization: result });
      }
      case "delete_organization": {
        const id = textValue(payload.id, 64);
        const confirmation = textValue(payload.confirmation, 180);
        const org = await requireOrganization(id);
        if (confirmation !== org.name) return fail(400, "La confirmación debe coincidir exactamente con el nombre de la organización.");
        const { data: profiles, error: pError } = await admin.from("profiles").select("id,role").eq("organization_id", id);
        dbError(pError);
        if ((profiles || []).some(p => p.role === "superadmin")) return fail(400, "No se puede eliminar una organización que contenga un superadministrador.");
        const { error: purgeError } = await admin.rpc("superadmin_purge_organization", {
          p_organization_id: id,
        });
        dbError(purgeError);
        // Auth users are deleted only after the transaction has removed their
        // tenant-owned foreign-key references. Profiles were detached atomically.
        for (const profile of profiles || []) {
          const { error } = await admin.auth.admin.deleteUser(profile.id);
          if (error) throw new Error("Los datos de la organización fueron purgados, pero una cuenta no pudo eliminarse. Vuelva a intentarlo: " + error.message);
        }
        const { error } = await admin.from("organizations").delete().eq("id", id);
        dbError(error);
        await audit("organization_deleted", "organization", id, { name: org.name, deleted_users: (profiles || []).length });
        return jsonResponse(200, { success: true, message: "Organización y sus datos asociados eliminados." });
      }
      case "list_users": {
        const { data: profiles, error } = await admin.from("profiles")
          .select("id,email,full_name,role,organization_id,created_at,organizations(name,slug)")
          .order("created_at", { ascending: false }).limit(1000);
        dbError(error);
        const { data: authUsers, error: authError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
        if (authError) throw new Error(authError.message);
        const authMap = new Map((authUsers.users || []).map(user => [user.id, user]));
        const users = (profiles || []).map(profile => {
          const authUser = authMap.get(profile.id);
          return {
            ...profile,
            last_sign_in_at: authUser?.last_sign_in_at || null,
            banned_until: authUser?.banned_until || null,
            email_confirmed_at: authUser?.email_confirmed_at || null,
          };
        });
        return jsonResponse(200, { users });
      }
      case "create_user": {
        const email = textValue(payload.email, 254).toLowerCase();
        const fullName = textValue(payload.full_name, 180);
        const password = typeof payload.password === "string" ? payload.password : "";
        const role = textValue(payload.role, 30);
        const organizationId = textValue(payload.organization_id, 64);
        if (!validEmail(email)) return fail(400, "Ingrese un correo válido.");
        if (password.length < 14 || password.length > 128) return fail(400, "Use una contraseña temporal de al menos 14 caracteres.");
        if (fullName.length < 2) return fail(400, "Ingrese el nombre completo.");
        if (!["staff","admin","volunteer","superadmin"].includes(role)) return fail(400, "Rol no permitido.");
        const assignedOrganizationId = role === "superadmin" ? null : organizationId;
        if (role !== "superadmin") await requireOrganization(assignedOrganizationId);
        const { data: created, error: createError } = await admin.auth.admin.createUser({
          email, password, email_confirm: true, user_metadata: { full_name: fullName, must_change_password: true },
        });
        if (createError || !created.user) return fail(400, createError?.message || "No se pudo crear la cuenta.");
        const { error: saveError } = await admin.from("profiles").update({
          email, full_name: fullName, role, organization_id: assignedOrganizationId,
        }).eq("id", created.user.id);
        if (saveError) {
          await admin.auth.admin.deleteUser(created.user.id);
          return fail(500, "La cuenta fue revertida porque no se pudo guardar su perfil: " + saveError.message);
        }
        await audit("user_created", "user", created.user.id, { email, role, organization_id: assignedOrganizationId });
        return jsonResponse(200, { success: true, message: "Usuario creado. Se exigirá cambiar la contraseña temporal al iniciar sesión." });
      }
      case "update_user": {
        const id = textValue(payload.id, 64);
        if (!id) return fail(400, "Seleccione un usuario.");
        const { data: current, error: currentError } = await admin.from("profiles")
          .select("id,email,role,organization_id").eq("id", id).maybeSingle();
        dbError(currentError);
        if (!current) return fail(404, "Usuario no encontrado.");

        const email = textValue(payload.email, 254).toLowerCase();
        const fullName = textValue(payload.full_name, 180);
        const role = textValue(payload.role, 30);
        const organizationId = role === "superadmin" ? null : textValue(payload.organization_id, 64);
        if (!validEmail(email) || fullName.length < 2 ||
            !["staff","admin","volunteer","superadmin"].includes(role)) {
          return fail(400, "Revise correo, nombre y rol.");
        }
        if (role !== "superadmin") await requireOrganization(organizationId);
        if (current.role === "superadmin" && role !== "superadmin") {
          await requireAnotherActiveSuperadmin(id);
        }

        const { data: authResult, error: getAuthError } = await admin.auth.admin.getUserById(id);
        if (getAuthError || !authResult.user) return fail(404, "No se encontró la cuenta de autenticación.");
        const { error: authUpdateError } = await admin.auth.admin.updateUserById(id, {
          email, email_confirm: true,
          user_metadata: { ...authResult.user.user_metadata, full_name: fullName },
        });
        if (authUpdateError) throw new Error(authUpdateError.message);

        const { error: profileUpdateError } = await admin.from("profiles").update({
          email, full_name: fullName, role, organization_id: organizationId,
        }).eq("id", id);
        if (profileUpdateError) {
          if ((authResult.user.email || "").toLowerCase() !== email) {
            const { error: rollbackError } = await admin.auth.admin.updateUserById(id, {
              email: authResult.user.email || current.email,
              email_confirm: true,
            });
            if (rollbackError) console.error("No se pudo revertir el correo de Auth tras un fallo al actualizar el perfil:", rollbackError.message);
          }
          throw new Error(profileUpdateError.message);
        }

        await audit("user_updated", "user", id, {
          previous_email: current.email, email, previous_role: current.role, role,
          previous_organization_id: current.organization_id, organization_id: organizationId,
        });
        return jsonResponse(200, { success: true, message: role === "superadmin"
          ? "Perfil guardado como superadministrador global."
          : "Perfil, organización y permisos actualizados." });
      }
      case "reset_password": {
        const id = textValue(payload.id, 64);
        const password = typeof payload.password === "string" ? payload.password : "";
        if (!id || id === caller.id) return fail(400, "Use el proceso de cambio de contraseña de su propia cuenta.");
        if (password.length < 14 || password.length > 128) return fail(400, "La contraseña temporal debe tener al menos 14 caracteres.");
        const { data: target, error: targetError } = await admin.from("profiles").select("email,role").eq("id", id).maybeSingle();
        dbError(targetError);
        if (!target) return fail(404, "Usuario no encontrado.");
        const { data: authResult, error: getError } = await admin.auth.admin.getUserById(id);
        if (getError || !authResult.user) return fail(404, "No se encontró la cuenta.");
        const { error } = await admin.auth.admin.updateUserById(id, {
          password,
          user_metadata: { ...authResult.user.user_metadata, must_change_password: true },
        });
        dbError(error);
        await audit("user_password_reset", "user", id, { email: target.email });
        return jsonResponse(200, { success: true, message: "Contraseña temporal cambiada. El usuario deberá reemplazarla al iniciar sesión." });
      }
      case "set_user_access": {
        const id = textValue(payload.id, 64);
        const suspended = payload.suspended === true;
        if (!id || id === caller.id) return fail(400, "No puede suspender su propia cuenta.");
        const { data: target, error } = await admin.from("profiles").select("email,role,organization_id").eq("id", id).maybeSingle();
        dbError(error);
        if (!target) return fail(404, "Usuario no encontrado.");
        if (suspended && target.role === "superadmin") await requireAnotherActiveSuperadmin(id);
        const { error: authError } = await admin.auth.admin.updateUserById(id, {
          ban_duration: suspended ? "876000h" : "none",
        });
        dbError(authError);
        await audit(suspended ? "user_suspended" : "user_reactivated", "user", id, { email: target.email });
        return jsonResponse(200, { success: true, message: suspended ? "Cuenta suspendida." : "Cuenta reactivada." });
      }
      case "delete_user": {
        const id = textValue(payload.id, 64);
        if (!id || id === caller.id) return fail(400, "No puede eliminar su propia cuenta.");
        const { data: target, error: targetProfileError } = await admin.from("profiles").select("email,role,organization_id").eq("id", id).maybeSingle();
        dbError(targetProfileError);
        if (!target) return fail(404, "Usuario no encontrado.");
        if (target.role === "superadmin") await requireAnotherActiveSuperadmin(id);
        if (target.role === "admin" && target.organization_id) {
          const { count, error: countError } = await admin.from("profiles").select("id", { count: "exact", head: true })
            .eq("organization_id", target.organization_id).eq("role", "admin");
          dbError(countError);
          if ((count || 0) <= 1) return fail(400, "Es el último administrador de la organización. Asigne otro administrador antes de eliminarlo.");
        }
        // Preserve records while moving their creator/auditor reference to the platform operator.
        for (const [table, column] of [["activities","created_by"],["registrations","created_by"],["check_ins","checked_in_by"],["audit_logs","actor_id"]] as const) {
          const { error } = await admin.from(table).update({ [column]: caller.id }).eq(column, id);
          dbError(error);
        }
        const { error } = await admin.auth.admin.deleteUser(id);
        dbError(error);
        await audit("user_deleted", "user", id, { email: target.email, organization_id: target.organization_id });
        return jsonResponse(200, { success: true, message: "Cuenta eliminada. Los registros históricos se conservaron." });
      }
      case "list_activities": {
        const organizationId = textValue(payload.organization_id, 64);
        let query = admin.from("activities").select("*,organizations(name,slug)").order("event_date", { ascending: false }).limit(2000);
        if (organizationId) query = query.eq("organization_id", organizationId);
        const { data, error } = await query;
        dbError(error);
        return jsonResponse(200, { activities: data || [] });
      }
      case "save_activity": {
        const id = textValue(payload.id, 64);
        const organizationId = textValue(payload.organization_id, 64);
        const name = textValue(payload.name, 180), place = textValue(payload.place, 180);
        const eventDate = textValue(payload.event_date, 20), startTime = textValue(payload.start_time, 20);
        if (name.length < 1 || place.length < 1 || !/^\d{4}-\d{2}-\d{2}$/.test(eventDate) || !/^\d{2}:\d{2}$/.test(startTime)) {
          return fail(400, "Nombre, lugar, fecha y hora de inicio son obligatorios.");
        }
        await requireOrganization(organizationId);
        const values = {
          organization_id: organizationId, name, place, event_date: eventDate, start_time: startTime,
          end_time: textValue(payload.end_time, 20) || null,
          description: textValue(payload.description, 4000) || null,
          tagline: textValue(payload.tagline, 1000) || null,
          status: payload.status === "closed" ? "closed" : "open",
        };
        let data;
        if (id) {
          const response = await admin.from("activities").update(values).eq("id", id).eq("organization_id", organizationId).select().single();
          dbError(response.error); data = response.data;
        } else {
          const response = await admin.from("activities").insert({ ...values, created_by: caller.id }).select().single();
          dbError(response.error); data = response.data;
        }
        await audit(id ? "activity_updated" : "activity_created", "activity", data.id, { name, organization_id: organizationId });
        return jsonResponse(200, { success: true, activity: data });
      }
      case "delete_activity": {
        const id = textValue(payload.id, 64);
        const { data: activity, error } = await admin.from("activities").select("id,name,organization_id").eq("id", id).maybeSingle();
        dbError(error);
        if (!activity) return fail(404, "Actividad no encontrada.");
        const { data: regs, error: regError } = await admin.from("registrations").select("attendee_id").eq("activity_id", id);
        dbError(regError);
        const attendeeIds = [...new Set((regs || []).map(r => r.attendee_id))];
        const { error: ciError } = await admin.from("check_ins").delete().eq("activity_id", id); dbError(ciError);
        const { error: rError } = await admin.from("registrations").delete().eq("activity_id", id); dbError(rError);
        const { error: aError } = await admin.from("activities").delete().eq("id", id); dbError(aError);
        if (attendeeIds.length) {
          const { data: stillUsed, error: usedError } = await admin.from("registrations").select("attendee_id").in("attendee_id", attendeeIds);
          dbError(usedError);
          const used = new Set((stillUsed || []).map(r => r.attendee_id));
          const orphanIds = attendeeIds.filter(attendeeId => !used.has(attendeeId));
          if (orphanIds.length) { const { error } = await admin.from("attendees").delete().in("id", orphanIds); dbError(error); }
        }
        await audit("activity_deleted", "activity", id, { name: activity.name, organization_id: activity.organization_id });
        return jsonResponse(200, { success: true, message: "Actividad y sus inscripciones eliminadas." });
      }
      case "list_auditoriums": {
        const organizationId = textValue(payload.organization_id, 64);
        let query = admin.from("auditorium_templates").select("*,organizations(name,slug)").order("created_at", { ascending: false }).limit(2000);
        if (organizationId) query = query.eq("organization_id", organizationId);
        const { data, error } = await query;
        dbError(error);
        return jsonResponse(200, { auditoriums: data || [] });
      }
      case "save_auditorium": {
        const id = textValue(payload.id, 64), organizationId = textValue(payload.organization_id, 64);
        const name = textValue(payload.name, 120), description = textValue(payload.description, 1000);
        const layout = payload.layout;
        if (name.length < 2 || !validLayout(layout)) return fail(400, "Nombre o distribución inválida. El plano admite 1–100 filas, hasta 6 bloques por fila y 3.000 asientos.");
        await requireOrganization(organizationId);
        const values = { organization_id: organizationId, name, description: description || null, layout, updated_at: new Date().toISOString() };
        let data;
        if (id) {
          const response = await admin.from("auditorium_templates").update(values).eq("id", id).eq("organization_id", organizationId).select().single();
          dbError(response.error); data = response.data;
        } else {
          const response = await admin.from("auditorium_templates").insert({ ...values, created_by: caller.id }).select().single();
          dbError(response.error); data = response.data;
        }
        await audit(id ? "auditorium_updated" : "auditorium_created", "auditorium", data.id, { name, organization_id: organizationId });
        return jsonResponse(200, { success: true, auditorium: data });
      }
      case "delete_auditorium": {
        const id = textValue(payload.id, 64);
        const { data: template, error } = await admin.from("auditorium_templates").select("id,name,organization_id").eq("id", id).maybeSingle();
        dbError(error);
        if (!template) return fail(404, "Auditorio no encontrado.");
        const { count, error: usageError } = await admin.from("activities").select("id", { count: "exact", head: true }).eq("auditorium_template_id", id);
        dbError(usageError);
        if ((count || 0) > 0) return fail(400, "No se puede eliminar: hay actividades que utilizan este auditorio. Reasígnelas primero.");
        const { error: deleteError } = await admin.from("auditorium_templates").delete().eq("id", id);
        dbError(deleteError);
        await audit("auditorium_deleted", "auditorium", id, { name: template.name, organization_id: template.organization_id });
        return jsonResponse(200, { success: true, message: "Auditorio eliminado." });
      }
      case "list_registrations": {
        const organizationId = textValue(payload.organization_id, 64);
        let query = admin.from("registrations").select("id,organization_id,activity_id,attendee_id,seat_row,seat_number,status,created_at,qr_token").order("created_at", { ascending: false }).limit(3000);
        if (organizationId) query = query.eq("organization_id", organizationId);
        const { data: regs, error } = await query; dbError(error);
        const attendeeIds = [...new Set((regs || []).map(r => r.attendee_id))];
        const activityIds = [...new Set((regs || []).map(r => r.activity_id))];
        const [attendees, activities] = await Promise.all([
          attendeeIds.length ? admin.from("attendees").select("id,full_name,email,organization").in("id", attendeeIds) : Promise.resolve({data:[],error:null}),
          activityIds.length ? admin.from("activities").select("id,name,organization_id").in("id", activityIds) : Promise.resolve({data:[],error:null}),
        ]);
        dbError(attendees.error); dbError(activities.error);
        const attendeeMap = new Map((attendees.data || []).map(x => [x.id, x]));
        const activityMap = new Map((activities.data || []).map(x => [x.id, x]));
        return jsonResponse(200, { registrations: (regs || []).map(reg => ({
          ...reg, attendee: attendeeMap.get(reg.attendee_id) || null, activity: activityMap.get(reg.activity_id) || null,
        })) });
      }
      case "update_registration": {
        const id = textValue(payload.id, 64);
        const status = textValue(payload.status, 30);
        const seatRow = textValue(payload.seat_row, 40), seatNumber = textValue(payload.seat_number, 40);
        if (!["registered","checked_in","cancelled"].includes(status)) return fail(400, "Estado inválido.");
        const { data: current, error: currentError } = await admin.from("registrations")
          .select("id,organization_id,activity_id,qr_token").eq("id", id).maybeSingle();
        dbError(currentError);
        if (!current) return fail(404, "Inscripción no encontrada.");
        const { data, error } = await admin.from("registrations")
          .update({ status, seat_row: seatRow || null, seat_number: seatNumber || null })
          .eq("id", id).select("id,organization_id,status,seat_row,seat_number").single();
        dbError(error);
        if (status === "checked_in") {
          const { count, error: countError } = await admin.from("check_ins").select("id",{count:"exact",head:true}).eq("registration_id",id);
          dbError(countError);
          if ((count || 0) === 0) {
            const { error: insertError } = await admin.from("check_ins").insert({
              organization_id:current.organization_id,registration_id:id,activity_id:current.activity_id,
              token:current.qr_token,checked_in_by:caller.id,
            });
            dbError(insertError);
          }
        } else {
          const { error: deleteError } = await admin.from("check_ins").delete().eq("registration_id",id);
          dbError(deleteError);
        }
        await audit("registration_updated", "registration", id, { status, seat_row: seatRow, seat_number: seatNumber });
        return jsonResponse(200, { success: true, registration: data });
      }
      case "delete_registration": {
        const id = textValue(payload.id, 64);
        const { data: reg, error } = await admin.from("registrations").select("id,attendee_id,organization_id").eq("id", id).maybeSingle();
        dbError(error);
        if (!reg) return fail(404, "Inscripción no encontrada.");
        const { error: cError } = await admin.from("check_ins").delete().eq("registration_id", id); dbError(cError);
        const { error: rError } = await admin.from("registrations").delete().eq("id", id); dbError(rError);
        const { count, error: countError } = await admin.from("registrations").select("id", { count: "exact", head: true }).eq("attendee_id", reg.attendee_id);
        dbError(countError);
        if ((count || 0) === 0) { const { error } = await admin.from("attendees").delete().eq("id", reg.attendee_id); dbError(error); }
        await audit("registration_deleted", "registration", id, { organization_id: reg.organization_id });
        return jsonResponse(200, { success: true, message: "Inscripción eliminada." });
      }
      case "update_attendee": {
        const id = textValue(payload.id, 64), fullName = textValue(payload.full_name, 180);
        const email = textValue(payload.email, 254), organization = textValue(payload.organization, 180);
        if (fullName.length < 2 || (email && !validEmail(email))) return fail(400, "Revise el nombre y el correo.");
        const { data, error } = await admin.from("attendees").update({
          full_name: fullName, email: email || null, organization: organization || null,
        }).eq("id", id).select("id,full_name,email,organization,organization_id").single();
        dbError(error);
        await audit("attendee_updated", "attendee", id, { full_name: fullName });
        return jsonResponse(200, { success: true, attendee: data });
      }
      case "list_platform_audit": {
        const { data, error } = await admin.from("platform_audit_logs").select("*").order("created_at", { ascending: false }).limit(300);
        dbError(error);
        return jsonResponse(200, { logs: data || [] });
      }
      default:
        return fail(400, "Acción no reconocida.");
    }
  } catch (error) {
    console.error("Error en superadmin-console:", error);
    return fail(500, error instanceof Error ? error.message : "Error interno de administración.");
  }
});
