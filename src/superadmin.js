const $ = id => document.getElementById(id);
const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({
  "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
}[c]));
const dateTime = value => value ? new Date(value).toLocaleString("es-CL") : "—";
const roleLabel = role => ({admin:"Administrador",staff:"Personal",volunteer:"Voluntario",superadmin:"Superadministrador"}[role] || role);
let client = null, currentUser = null, initialized = false;
let organizations = [], users = [], activities = [], auditoriums = [], registrations = [], auditLogs = [];

async function api(action, values = {}) {
  const { data, error } = await client.functions.invoke("superadmin-console", {
    body: { action, ...values }
  });
  if (error) {
    const detail = data?.error || error.message || "No se pudo conectar con la consola global.";
    throw new Error(detail);
  }
  if (data?.error) throw new Error(data.error);
  return data || {};
}
function message(id, value, bad = false) {
  const el = $(id);
  if (el) { el.textContent = value; el.style.color = bad ? "#9b2828" : ""; }
}
function selectOptions(id, includeAll = false) {
  const el = $(id);
  if (!el) return;
  const previous = el.value;
  el.innerHTML = (includeAll ? '<option value="">Todas las organizaciones</option>' : '<option value="">Seleccione una organización</option>') +
    organizations.map(org => `<option value="${esc(org.id)}">${esc(org.name)}</option>`).join("");
  if ([...el.options].some(option => option.value === previous)) el.value = previous;
  else if (!includeAll && organizations.length) el.value = organizations[0].id;
}
function selectedOrganizationName(id) {
  return organizations.find(org => org.id === id)?.name || "—";
}
function switchView(name) {
  document.querySelectorAll(".super-view").forEach(view => view.classList.add("hidden"));
  $("super-view-" + name)?.classList.remove("hidden");
  document.querySelectorAll("[data-super-view]").forEach(button =>
    button.classList.toggle("active", button.dataset.superView === name)
  );
}
function renderOverview(counts = {}) {
  const pairs = [
    ["superCountOrganizations","organizations"],
    ["superCountProfiles","profiles"],
    ["superCountActivities","activities"],
    ["superCountRegistrations","registrations"],
    ["superCountAuditoriums","auditorium_templates"],
    ["superCountCheckins","check_ins"],
  ];
  for (const [id,key] of pairs) $(id).textContent = Number(counts[key] || 0).toLocaleString("es-CL");
}
function clearOrganizationForm() {
  $("superOrganizationForm").reset(); $("superOrganizationId").value = "";
  $("superOrganizationSaveBtn").textContent = "Crear organización"; message("superOrganizationMessage","");
}
function renderOrganizations() {
  const rows = organizations.map(org => `<tr>
    <td><strong>${esc(org.name)}</strong><div class="muted">${esc(org.slug)}</div></td>
    <td>${org.users_count || 0}</td><td>${org.activities_count || 0}</td><td>${org.auditoriums_count || 0}</td>
    <td>${dateTime(org.created_at)}</td>
    <td><button class="secondary" data-super-org-edit="${esc(org.id)}">Editar</button>
    <button class="secondary danger-btn" data-super-org-delete="${esc(org.id)}">Eliminar</button></td>
  </tr>`).join("");
  $("superOrganizationsTable").innerHTML = rows
    ? `<table><thead><tr><th>Organización</th><th>Usuarios</th><th>Eventos</th><th>Auditorios</th><th>Creación</th><th>Acciones</th></tr></thead><tbody>${rows}</tbody></table>`
    : '<p class="muted">No hay organizaciones registradas.</p>';
}
function syncSuperUserOrganizationField() {
  const isRoot = $("superUserRole").value === "superadmin";
  $("superUserOrganizationLabel").classList.toggle("hidden", isRoot);
  $("superUserOrganization").required = !isRoot;
  $("superUserOrganization").disabled = isRoot;
  if (isRoot) $("superUserOrganization").value = "";
  else if (!$("superUserOrganization").value && organizations.length) $("superUserOrganization").value = organizations[0].id;
}
function clearUserForm() {
  $("superUserForm").reset(); $("superUserId").value = "";
  $("superUserPasswordLabel").classList.remove("hidden");
  $("superUserPassword").required = true;
  $("superUserSaveBtn").textContent = "Crear usuario";
  $("superUserRole").disabled = false;
  syncSuperUserOrganizationField();
  message("superUserMessage","");
}
function renderUsers() {
  const rows = users.map(user => {
    const suspended = user.banned_until && new Date(user.banned_until).getTime() > Date.now();
    const isRoot = user.role === "superadmin";
    const isSelf = user.id === currentUser?.id;
    const actions = [
      `<button class="secondary" data-super-user-edit="${esc(user.id)}">Editar</button>`,
      !isSelf ? `<button class="secondary" data-super-user-reset="${esc(user.id)}">Clave</button>` : "",
      !isSelf ? `<button class="secondary" data-super-user-status="${esc(user.id)}" data-suspended="${suspended ? "true":"false"}">${suspended ? "Reactivar":"Suspender"}</button>` : "",
      !isSelf ? `<button class="secondary danger-btn" data-super-user-delete="${esc(user.id)}">Eliminar</button>` : "",
    ].filter(Boolean).join(" ");
    return `<tr>
      <td><strong>${esc(user.full_name || "Sin nombre")}</strong><div class="muted">${esc(user.email)}${isSelf ? " · Usted" : ""}</div></td>
      <td>${isRoot ? '<span class="badge">Acceso global</span>' : esc(user.organizations?.name || "Sin organización")}</td>
      <td>${esc(roleLabel(user.role))}</td>
      <td>${suspended ? '<span class="badge bad">Suspendida</span>' : '<span class="badge good">Activa</span>'}</td>
      <td>${dateTime(user.last_sign_in_at)}</td>
      <td>${actions}</td>
    </tr>`;
  }).join("");
  $("superUsersTable").innerHTML = rows
    ? `<table><thead><tr><th>Perfil</th><th>Organización / acceso</th><th>Rol</th><th>Estado</th><th>Último acceso</th><th>Acciones</th></tr></thead><tbody>${rows}</tbody></table>`
    : '<p class="muted">No hay perfiles registrados.</p>';
}
function clearActivityForm() {
  $("superActivityForm").reset(); $("superActivityId").value = "";
  $("superActivitySaveBtn").textContent = "Crear evento";
  if (organizations.length) $("superActivityOrganization").value = organizations[0].id;
  message("superActivityMessage","");
}
function renderActivities() {
  const filter = $("superActivityFilter").value;
  const list = activities.filter(item => !filter || item.organization_id === filter);
  const rows = list.map(item => `<tr>
    <td><strong>${esc(item.name)}</strong><div class="muted">${esc(item.organizations?.name || selectedOrganizationName(item.organization_id))}</div></td>
    <td>${esc(item.place)}</td><td>${esc(item.event_date)}</td>
    <td>${item.status === "open" ? "Abierto" : "Cerrado"}</td>
    <td><button class="secondary" data-super-activity-edit="${esc(item.id)}">Editar</button>
    <button class="secondary danger-btn" data-super-activity-delete="${esc(item.id)}">Eliminar</button></td>
  </tr>`).join("");
  $("superActivitiesTable").innerHTML = rows
    ? `<table><thead><tr><th>Evento / organización</th><th>Lugar</th><th>Fecha</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>${rows}</tbody></table>`
    : '<p class="muted">No hay eventos para mostrar.</p>';
}
function clearAuditoriumForm() {
  $("superAuditoriumForm").reset(); $("superAuditoriumId").value = "";
  $("superAuditoriumSaveBtn").textContent = "Crear auditorio";
  $("superAuditoriumLayout").value = JSON.stringify({
    version:1, stage_label:"ESCENARIO", aisle_label:"PASILLO",
    numbering_direction:"left_to_right",
    rows:[{label:"1",sections:[{label:"Izquierda",seats:10},{label:"Derecha",seats:10}]},
          {label:"2",sections:[{label:"Izquierda",seats:10},{label:"Derecha",seats:10}]}]
  }, null, 2);
  if (organizations.length) $("superAuditoriumOrganization").value = organizations[0].id;
  message("superAuditoriumMessage","");
}
function renderAuditoriums() {
  const filter = $("superAuditoriumFilter").value;
  const list = auditoriums.filter(item => !filter || item.organization_id === filter);
  const rows = list.map(item => {
    const seats = (item.layout?.rows || []).reduce((total,row) =>
      total + (row.sections || []).reduce((sum,section)=>sum + Number(section.seats || 0),0),0);
    return `<tr><td><strong>${esc(item.name)}</strong><div class="muted">${esc(item.organizations?.name || selectedOrganizationName(item.organization_id))}</div></td>
      <td>${(item.layout?.rows || []).length}</td><td>${seats}</td>
      <td><button class="secondary" data-super-auditorium-edit="${esc(item.id)}">Editar</button>
      <button class="secondary danger-btn" data-super-auditorium-delete="${esc(item.id)}">Eliminar</button></td></tr>`;
  }).join("");
  $("superAuditoriumsTable").innerHTML = rows
    ? `<table><thead><tr><th>Auditorio / organización</th><th>Filas</th><th>Asientos</th><th>Acciones</th></tr></thead><tbody>${rows}</tbody></table>`
    : '<p class="muted">No hay auditorios para mostrar.</p>';
}
function renderRegistrations() {
  const filter = $("superRegistrationFilter").value;
  const list = registrations.filter(reg => !filter || reg.organization_id === filter);
  const rows = list.map(reg => `<tr>
    <td><input class="super-reg-input" data-reg-name="${esc(reg.id)}" value="${esc(reg.attendee?.full_name || "")}" maxlength="180"></td>
    <td><input class="super-reg-input" data-reg-email="${esc(reg.id)}" value="${esc(reg.attendee?.email || "")}" maxlength="254"></td>
    <td><input class="super-reg-input" data-reg-person-org="${esc(reg.id)}" value="${esc(reg.attendee?.organization || "")}" maxlength="180"></td>
    <td>${esc(reg.activity?.name || "—")}<div class="muted">${esc(selectedOrganizationName(reg.organization_id))}</div></td>
    <td><input class="super-reg-input short" data-reg-row="${esc(reg.id)}" value="${esc(reg.seat_row || "")}" maxlength="40"></td>
    <td><input class="super-reg-input short" data-reg-seat="${esc(reg.id)}" value="${esc(reg.seat_number || "")}" maxlength="40"></td>
    <td><select data-reg-status="${esc(reg.id)}"><option value="registered" ${reg.status==="registered"?"selected":""}>Pendiente</option><option value="checked_in" ${reg.status==="checked_in"?"selected":""}>Acreditada</option><option value="cancelled" ${reg.status==="cancelled"?"selected":""}>Cancelada</option></select></td>
    <td><button class="secondary" data-super-reg-save="${esc(reg.id)}">Guardar</button><button class="secondary danger-btn" data-super-reg-delete="${esc(reg.id)}">Eliminar</button></td>
  </tr>`).join("");
  $("superRegistrationsTable").innerHTML = rows
    ? `<table><thead><tr><th>Nombre</th><th>Correo</th><th>Organización participante</th><th>Evento</th><th>Fila</th><th>Asiento</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>${rows}</tbody></table>`
    : '<p class="muted">No hay inscripciones para mostrar.</p>';
}
function renderAudit() {
  const rows = auditLogs.map(log => `<tr><td>${dateTime(log.created_at)}</td><td>${esc(log.action)}</td><td>${esc(log.entity_type)}</td><td>${esc(log.entity_id || "—")}</td><td><code>${esc(JSON.stringify(log.details || {}))}</code></td></tr>`).join("");
  $("superAuditTable").innerHTML = rows
    ? `<table><thead><tr><th>Fecha</th><th>Acción</th><th>Entidad</th><th>ID</th><th>Detalle</th></tr></thead><tbody>${rows}</tbody></table>`
    : '<p class="muted">Todavía no hay acciones registradas.</p>';
}
async function refreshAll() {
  message("superOverviewNote","Actualizando información global…");
  try {
    const [overview, orgs, people, events, halls, regs, logs] = await Promise.all([
      api("overview"), api("list_organizations"), api("list_users"),
      api("list_activities"), api("list_auditoriums"), api("list_registrations"), api("list_platform_audit")
    ]);
    organizations = orgs.organizations || []; users = people.users || [];
    activities = events.activities || []; auditoriums = halls.auditoriums || [];
    registrations = regs.registrations || []; auditLogs = logs.logs || [];
    renderOverview(overview.counts || {});
    selectOptions("superUserOrganization"); selectOptions("superActivityOrganization");
    selectOptions("superAuditoriumOrganization");
    selectOptions("superActivityFilter",true); selectOptions("superAuditoriumFilter",true);
    selectOptions("superRegistrationFilter",true);
    renderOrganizations(); renderUsers(); renderActivities(); renderAuditoriums(); renderRegistrations(); renderAudit();
    message("superOverviewNote","Información global actualizada correctamente.");
  } catch (error) {
    message("superOverviewNote",error.message || "No se pudo actualizar la consola.",true);
  }
}
async function saveOrganization(ev) {
  ev.preventDefault();
  try {
    const id = $("superOrganizationId").value;
    await api("save_organization",{id,name:$("superOrganizationName").value.trim()});
    clearOrganizationForm(); await refreshAll();
    message("superOrganizationMessage","Organización guardada correctamente.");
  } catch(error) { message("superOrganizationMessage",error.message,true); }
}
async function saveUser(ev) {
  ev.preventDefault();
  const id = $("superUserId").value;
  const role = $("superUserRole").value;
  const values = {
    id, full_name:$("superUserName").value.trim(), email:$("superUserEmail").value.trim(),
    organization_id:role === "superadmin" ? null : $("superUserOrganization").value, role,
  };
  if (!id) values.password = $("superUserPassword").value;
  try {
    const result = await api(id ? "update_user" : "create_user", values);
    if (id && id === currentUser.id && role !== "superadmin") {
      alert("Su cuenta dejó de ser superadministradora. La sesión se cerrará.");
      await client.auth.signOut();
      location.reload();
      return;
    }
    if (id && id === currentUser.id && role === "superadmin") {
      const { data: refreshedSession } = await client.auth.refreshSession();
      if (refreshedSession?.session?.user) currentUser = refreshedSession.session.user;
    }
    clearUserForm(); await refreshAll();
    message("superUserMessage",result.message || "Usuario guardado.");
  } catch(error) { message("superUserMessage",error.message,true); }
}
async function saveActivity(ev) {
  ev.preventDefault();
  const values = {
    id:$("superActivityId").value, organization_id:$("superActivityOrganization").value,
    name:$("superActivityName").value.trim(), place:$("superActivityPlace").value.trim(),
    event_date:$("superActivityDate").value, start_time:$("superActivityStart").value,
    end_time:$("superActivityEnd").value, status:$("superActivityStatus").value,
    description:$("superActivityDescription").value, tagline:$("superActivityTagline").value,
  };
  try {
    await api("save_activity",values); clearActivityForm(); await refreshAll();
    message("superActivityMessage","Evento guardado correctamente.");
  } catch(error) { message("superActivityMessage",error.message,true); }
}
async function saveAuditorium(ev) {
  ev.preventDefault();
  let layout;
  try { layout = JSON.parse($("superAuditoriumLayout").value); }
  catch { message("superAuditoriumMessage","El JSON no es válido. Revise comas, llaves y corchetes.",true); return; }
  try {
    await api("save_auditorium",{
      id:$("superAuditoriumId").value, organization_id:$("superAuditoriumOrganization").value,
      name:$("superAuditoriumName").value.trim(), description:$("superAuditoriumDescription").value.trim(), layout,
    });
    clearAuditoriumForm(); await refreshAll();
    message("superAuditoriumMessage","Auditorio guardado correctamente.");
  } catch(error) { message("superAuditoriumMessage",error.message,true); }
}
function editOrganization(id) {
  const org = organizations.find(item => item.id === id); if (!org) return;
  $("superOrganizationId").value = org.id; $("superOrganizationName").value = org.name;
  $("superOrganizationSaveBtn").textContent = "Guardar cambios"; message("superOrganizationMessage","");
  switchView("organizations");
}
function editUser(id) {
  const user = users.find(item => item.id === id); if (!user) return;
  $("superUserId").value = user.id; $("superUserName").value = user.full_name || "";
  $("superUserEmail").value = user.email || ""; $("superUserOrganization").value = user.organization_id || "";
  $("superUserRole").value = user.role; $("superUserRole").disabled = false;
  $("superUserPasswordLabel").classList.add("hidden"); $("superUserPassword").required = false;
  $("superUserSaveBtn").textContent = "Guardar cambios";
  syncSuperUserOrganizationField(); message("superUserMessage","");
  switchView("users");
}
function editActivity(id) {
  const event = activities.find(item => item.id === id); if (!event) return;
  $("superActivityId").value = event.id; $("superActivityOrganization").value = event.organization_id;
  $("superActivityName").value = event.name || ""; $("superActivityPlace").value = event.place || "";
  $("superActivityDate").value = event.event_date || ""; $("superActivityStart").value = event.start_time || "";
  $("superActivityEnd").value = event.end_time || ""; $("superActivityStatus").value = event.status || "open";
  $("superActivityDescription").value = event.description || ""; $("superActivityTagline").value = event.tagline || "";
  $("superActivitySaveBtn").textContent = "Guardar cambios"; message("superActivityMessage","");
  switchView("activities");
}
function editAuditorium(id) {
  const item = auditoriums.find(value => value.id === id); if (!item) return;
  $("superAuditoriumId").value = item.id; $("superAuditoriumOrganization").value = item.organization_id;
  $("superAuditoriumName").value = item.name || ""; $("superAuditoriumDescription").value = item.description || "";
  $("superAuditoriumLayout").value = JSON.stringify(item.layout,null,2);
  $("superAuditoriumSaveBtn").textContent = "Guardar cambios"; message("superAuditoriumMessage","");
  switchView("auditoriums");
}
async function resetUserPassword(id) {
  const user = users.find(value => value.id === id); if (!user) return;
  const password = prompt("Ingrese una contraseña temporal aleatoria (mínimo 14 caracteres) para " + user.email + ". No reutilice contraseñas.");
  if (password === null) return;
  if (password.length < 14) { alert("La contraseña temporal debe tener al menos 14 caracteres."); return; }
  if (!confirm("¿Restablecer la contraseña de " + user.email + "? El usuario deberá cambiarla al ingresar.")) return;
  try { const result = await api("reset_password",{id,password}); alert(result.message); await refreshAll(); }
  catch(error) { alert(error.message); }
}
async function deleteOrganization(id) {
  const org = organizations.find(value => value.id === id); if (!org) return;
  const confirmation = prompt("Esta acción eliminará permanentemente todos sus usuarios, eventos, inscritos, auditorios y acreditaciones. Para continuar, escriba exactamente el nombre de la organización:\n\n" + org.name);
  if (confirmation === null) return;
  try { const result = await api("delete_organization",{id,confirmation}); alert(result.message); await refreshAll(); }
  catch(error) { alert(error.message); }
}
async function deleteUser(id) {
  const user = users.find(value => value.id === id); if (!user) return;
  if (!confirm("¿Eliminar definitivamente la cuenta " + user.email + "? Los registros históricos se conservarán.")) return;
  try { const result = await api("delete_user",{id}); alert(result.message); await refreshAll(); }
  catch(error) { alert(error.message); }
}
async function toggleUser(id, suspended) {
  const user = users.find(value => value.id === id); if (!user) return;
  try { const result = await api("set_user_access",{id,suspended:!suspended}); alert(result.message); await refreshAll(); }
  catch(error) { alert(error.message); }
}
async function deleteActivity(id) {
  const item = activities.find(value => value.id === id); if (!item) return;
  if (!confirm("Eliminar el evento «" + item.name + "» y todas sus inscripciones/acreditaciones?")) return;
  try { const result = await api("delete_activity",{id}); alert(result.message); await refreshAll(); }
  catch(error) { alert(error.message); }
}
async function deleteAuditorium(id) {
  const item = auditoriums.find(value => value.id === id); if (!item) return;
  if (!confirm("¿Eliminar la plantilla de auditorio «" + item.name + "»?")) return;
  try { const result = await api("delete_auditorium",{id}); alert(result.message); await refreshAll(); }
  catch(error) { alert(error.message); }
}
async function saveRegistration(id) {
  const reg = registrations.find(item => item.id === id); if (!reg) return;
  const name = document.querySelector(`[data-reg-name="${CSS.escape(id)}"]`).value.trim();
  const email = document.querySelector(`[data-reg-email="${CSS.escape(id)}"]`).value.trim();
  const organization = document.querySelector(`[data-reg-person-org="${CSS.escape(id)}"]`).value.trim();
  const row = document.querySelector(`[data-reg-row="${CSS.escape(id)}"]`).value.trim();
  const seat = document.querySelector(`[data-reg-seat="${CSS.escape(id)}"]`).value.trim();
  const status = document.querySelector(`[data-reg-status="${CSS.escape(id)}"]`).value;
  try {
    await api("update_attendee",{id:reg.attendee_id,full_name:name,email,organization});
    await api("update_registration",{id,status,seat_row:row,seat_number:seat});
    await refreshAll(); message("superOverviewNote","Inscripción y participante actualizados.");
  } catch(error) { alert(error.message); }
}
async function deleteRegistration(id) {
  const reg = registrations.find(item => item.id === id); if (!reg) return;
  if (!confirm("¿Eliminar la inscripción de " + (reg.attendee?.full_name || "esta persona") + "?")) return;
  try { const result = await api("delete_registration",{id}); alert(result.message); await refreshAll(); }
  catch(error) { alert(error.message); }
}
function handleTableClick(ev) {
  const button = ev.target.closest("button"); if (!button) return;
  const d = button.dataset;
  if (d.superOrgEdit) editOrganization(d.superOrgEdit);
  else if (d.superOrgDelete) deleteOrganization(d.superOrgDelete);
  else if (d.superUserEdit) editUser(d.superUserEdit);
  else if (d.superUserReset) resetUserPassword(d.superUserReset);
  else if (d.superUserDelete) deleteUser(d.superUserDelete);
  else if (d.superUserStatus) toggleUser(d.superUserStatus,d.suspended === "true");
  else if (d.superActivityEdit) editActivity(d.superActivityEdit);
  else if (d.superActivityDelete) deleteActivity(d.superActivityDelete);
  else if (d.superAuditoriumEdit) editAuditorium(d.superAuditoriumEdit);
  else if (d.superAuditoriumDelete) deleteAuditorium(d.superAuditoriumDelete);
  else if (d.superRegSave) saveRegistration(d.superRegSave);
  else if (d.superRegDelete) deleteRegistration(d.superRegDelete);
}

export async function initSuperadmin(supabase, user) {
  client = supabase; currentUser = user;
  if (!initialized) {
    initialized = true;
    document.querySelectorAll("[data-super-view]").forEach(button =>
      button.addEventListener("click",()=>switchView(button.dataset.superView))
    );
    $("superRefreshBtn").addEventListener("click",refreshAll);
    $("superOrganizationForm").addEventListener("submit",saveOrganization);
    $("superOrganizationClearBtn").addEventListener("click",clearOrganizationForm);
    $("superUserForm").addEventListener("submit",saveUser);
    $("superUserRole").addEventListener("change",syncSuperUserOrganizationField);
    $("superUserClearBtn").addEventListener("click",clearUserForm);
    $("superActivityForm").addEventListener("submit",saveActivity);
    $("superActivityClearBtn").addEventListener("click",clearActivityForm);
    $("superAuditoriumForm").addEventListener("submit",saveAuditorium);
    $("superAuditoriumClearBtn").addEventListener("click",clearAuditoriumForm);
    $("superActivityFilter").addEventListener("change",renderActivities);
    $("superAuditoriumFilter").addEventListener("change",renderAuditoriums);
    $("superRegistrationFilter").addEventListener("change",renderRegistrations);
    $("superOrganizationsTable").addEventListener("click",handleTableClick);
    $("superUsersTable").addEventListener("click",handleTableClick);
    $("superActivitiesTable").addEventListener("click",handleTableClick);
    $("superAuditoriumsTable").addEventListener("click",handleTableClick);
    $("superRegistrationsTable").addEventListener("click",handleTableClick);
  }
  switchView("overview");
  clearAuditoriumForm();
  await refreshAll();
}
