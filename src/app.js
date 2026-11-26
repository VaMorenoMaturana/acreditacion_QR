import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";
import { ticketMarkup } from "./ticket-template.js";
import { initSuperadmin } from "./superadmin.js";

const $ = id => document.getElementById(id);
const validConfig = SUPABASE_URL.startsWith("https://") && !SUPABASE_URL.includes("TU-PROYECTO") &&
  SUPABASE_ANON_KEY.length > 25 && !SUPABASE_ANON_KEY.includes("PEGA_AQUI");
if (!validConfig) $("setupNotice").classList.remove("hidden");
const supabase = window.supabase?.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
let currentUser = null, currentProfile = null, activities = [], registrations = [], checkins = [];
const selectedRegistrationIds = new Set();
let csvRows = [], scanner = null, logoData = {institution:"",project:"",partner:""};
const escapeHtml = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const say = (id, message, bad=false) => { const el=$(id); if(el){el.textContent=message;el.style.color=bad?"#9b2828":"";} };
const val = id => $(id).value.trim();
const dateLabel = v => v ? new Intl.DateTimeFormat("es-CL",{day:"2-digit",month:"short",year:"numeric",timeZone:"UTC"}).format(new Date(v+"T12:00:00Z")) : "—";
const fileAsDataUrl = file => new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(file);});
function setSignedIn(on){
 $("loginView").classList.toggle("hidden",on);
 $("signupView").classList.add("hidden");
 $("passwordChangeView").classList.add("hidden");
 $("appView").classList.toggle("hidden",!on);
 $("logoutBtn").classList.toggle("hidden",!on);
 const organization=currentProfile?.organizations?.name||"";
 const identity=currentProfile?.role==="superadmin"?"Superadministrador de plataforma":organization;
 $("userLabel").textContent=on?[(currentUser?.email||""),identity].filter(Boolean).join(" · "):"";
 applyRoleNavigation();
}
function applyRoleNavigation(){
 const volunteer=currentProfile?.role==="volunteer";
 const superadmin=currentProfile?.role==="superadmin";
 document.querySelectorAll(".tabs [data-tab],.tabs [data-goto]").forEach(button=>{
  if(superadmin) button.classList.toggle("hidden",button.id!=="superadminTab");
  else button.classList.toggle("hidden",button.id==="superadminTab"||(volunteer&&button.dataset.tab!=="checkin"));
 });
}
function table(headers, rows){if(!rows.length)return '<p class="muted">Sin registros para mostrar.</p>';return `<table><thead><tr>${headers.map(h=>`<th>${escapeHtml(h)}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table>`;}
function activityOptions(selectId, includeAll=false){const select=$(selectId);if(!select)return;const old=select.value;select.innerHTML=(includeAll?'<option value="">Todas las actividades</option>':'')+activities.map(a=>`<option value="${a.id}">${escapeHtml(a.name)}${a.status==="closed"?" (cerrada)":""}</option>`).join("");if([...select.options].some(o=>o.value===old))select.value=old;}
function selectedActivity(id){return activities.find(a=>a.id===id);}
function selectedRegistration(id){return registrations.find(r=>r.id===id);}
function ticketDateLabel(value){
 if(!value)return "—";
 const date=new Date(value+"T12:00:00Z");
 const month=new Intl.DateTimeFormat("es-CL",{month:"short",timeZone:"UTC"}).format(date).replace(/\.$/,"");
 return `${date.getUTCDate()} de ${month.charAt(0).toUpperCase()}${month.slice(1)}`;
}
function ticketTime(value){return value?value.slice(0,5):"";}
async function fetchAllPages(tableName, columns, orderColumn, ascending=false){
  const all=[];let from=0;const pageSize=1000;
  while(true){
    const {data,error}=await supabase.from(tableName).select(columns)
      .order(orderColumn,{ascending}).range(from,from+pageSize-1);
    if(error)return {data:null,error};
    const page=data||[];all.push(...page);
    if(page.length<pageSize)break;
    from+=pageSize;
  }
  return {data:all,error:null};
}
async function loadAll(){
  const volunteer=currentProfile?.role==="volunteer";
  const activityFields=volunteer?"id,name,event_date,status":"*";
  const registrationFields=volunteer
    ?"id,activity_id,attendee_id,seat_row,seat_number,status,created_at,attendees!registrations_attendee_organization_fk(full_name,email,organization)"
    :"*, attendees!registrations_attendee_organization_fk(*)";
  const [a,r,c,p]=await Promise.all([
    supabase.from("activities").select(activityFields).order("event_date",{ascending:false}),
    fetchAllPages("registrations",registrationFields,"created_at",false),
    fetchAllPages("check_ins","id,registration_id,activity_id,checked_in_at","checked_in_at",false),
    supabase.from("profiles").select("id,email,role,created_at").order("created_at",{ascending:true})
  ]);
  for(const [name,res] of [["actividades",a],["inscripciones",r],["acreditaciones",c],["perfiles",p]]) {
    if(res.error)console.warn(`Carga de ${name}:`,res.error.message);
  }
  activities=a.error?(activities):(a.data||[]);
  if(r.error){
    say("registrationLoadError",`No se pudieron cargar las inscripciones: ${r.error.message}. Los datos no se han eliminado; revise la relación y los permisos de Supabase.`,true);
  }else{
    say("registrationLoadError","");
    registrations=(r.data||[]).map(x=>({...x,attendee:x.attendees||{}}));
    const validRegistrationIds=new Set(registrations.map(x=>x.id));
    for(const id of selectedRegistrationIds)if(!validRegistrationIds.has(id))selectedRegistrationIds.delete(id);
  }
  if(c.error){
    say("checkinLoadError",`No se pudo cargar el historial de acreditaciones: ${c.error.message}.`,true);
  }else{
    say("checkinLoadError","");
    checkins=c.data||[];
  }
  activityOptions("registrationActivity");activityOptions("csvActivity");activityOptions("registrationFilter",true);activityOptions("ticketActivity");activityOptions("checkinActivity");
  renderAll();renderUsers(p.data||[]);
}
function renderAll(){
  if(currentProfile?.role==="volunteer"){
    renderCheckins();renderManualCheckinList();return;
  }
  const open=activities.filter(a=>a.status==="open").length, checked=registrations.filter(r=>r.status==="checked_in").length;
  $("statActivities").textContent=open;$("statRegistrations").textContent=registrations.length;$("statChecked").textContent=checked;$("statPending").textContent=registrations.filter(r=>r.status==="registered").length;
  const recent=activities.slice(0,6).map(a=>`<tr><td>${escapeHtml(a.name)}</td><td>${dateLabel(a.event_date)}</td><td><span class="badge ${a.status==="open"?"good":"bad"}">${a.status==="open"?"Abierta":"Cerrada"}</span></td><td>${registrations.filter(r=>r.activity_id===a.id).length}</td></tr>`);
  $("recentActivities").innerHTML=table(["Actividad","Fecha","Estado","Inscripciones"],recent);
  $("activitiesTable").innerHTML=table(["Actividad","Fecha","Lugar","Estado","Acciones"],activities.map(a=>`<tr><td>${escapeHtml(a.name)}</td><td>${dateLabel(a.event_date)}</td><td>${escapeHtml(a.place)}</td><td>${a.status==="open"?"Abierta":"Cerrada"}</td><td><button class="secondary" data-edit-activity="${a.id}">Editar</button><button class="secondary" data-toggle-activity="${a.id}">${a.status==="open"?"Cerrar":"Reabrir"}</button></td></tr>`));
  renderRegistrations();renderTicketRegistrationOptions();renderCheckins();renderManualCheckinList();
}
function visibleRegistrations(){
  const filter=$("registrationFilter").value;
  return registrations.filter(r=>!filter||r.activity_id===filter);
}
function csvField(value){
  return '"' + String(value ?? "").replace(/"/g,'""') + '"';
}
function updateExportButtons(list=visibleRegistrations()){
  const active=list.filter(reg=>reg.status!=="cancelled");
  const accredited=active.filter(reg=>reg.status==="checked_in");
  $("exportRegistrationsBtn").disabled=active.length===0;
  $("exportAccreditedBtn").disabled=accredited.length===0;
  $("exportRegistrationsBtn").textContent=`Exportar inscritos (${active.length})`;
  $("exportAccreditedBtn").textContent=`Exportar acreditados (${accredited.length})`;
}
function downloadRegistrationCsv(kind){
  const selected=visibleRegistrations().filter(reg=>reg.status!=="cancelled");
  const rows=kind==="accredited"?selected.filter(reg=>reg.status==="checked_in"):selected;
  if(!rows.length){
    say("exportMessage",kind==="accredited"?"No hay acreditaciones para exportar con este filtro.":"No hay inscritos para exportar con este filtro.",true);
    return;
  }
  const checkinByRegistration=new Map(checkins.map(item=>[item.registration_id,item]));
  const header=["Nombre completo","Correo electrónico","Organización","Actividad","Fecha del evento","Lugar","Fila","Asiento","Estado","Fecha de acreditación","Fecha de inscripción"];
  const body=rows.map(reg=>{
    const activity=selectedActivity(reg.activity_id)||{};
    const checkin=checkinByRegistration.get(reg.id);
    return [
      reg.attendee?.full_name,reg.attendee?.email,reg.attendee?.organization,
      activity.name,activity.event_date,activity.place,reg.seat_row,reg.seat_number,
      reg.status==="checked_in"?"Acreditada":"Pendiente",
      checkin?.checked_in_at?new Date(checkin.checked_in_at).toLocaleString("es-CL"):"",
      reg.created_at?new Date(reg.created_at).toLocaleString("es-CL"):""
    ].map(csvField).join(";");
  });
  const csv="\uFEFF"+[header.map(csvField).join(";"),...body].join("\r\n");
  const filter=val("registrationFilter");
  const eventName=filter?(selectedActivity(filter)?.name||"actividad"):"todas-las-actividades";
  const safeName=eventName.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");
  const fileName=`${kind==="accredited"?"acreditados":"inscritos"}-${safeName||"eventos"}-${new Date().toISOString().slice(0,10)}.csv`;
  const blob=new Blob([csv],{type:"text/csv;charset=utf-8"});
  const url=URL.createObjectURL(blob);
  const link=document.createElement("a");link.href=url;link.download=fileName;
  document.body.append(link);link.click();link.remove();URL.revokeObjectURL(url);
  say("exportMessage",`Archivo ${fileName} generado con ${rows.length} registro(s).`);
}
function updateBulkSelectionUI(list=visibleRegistrations()){
  const ids=list.map(r=>r.id),selected=ids.filter(id=>selectedRegistrationIds.has(id)).length;
  $("selectionSummary").textContent=`${selectedRegistrationIds.size} seleccionados · ${list.length} visibles`;
  $("deleteSelectedBtn").disabled=selectedRegistrationIds.size===0;
  $("deleteSelectedBtn").textContent=selectedRegistrationIds.size?`Eliminar seleccionados (${selectedRegistrationIds.size})`:"Eliminar seleccionados";
  $("deleteAllVisibleBtn").disabled=list.length===0;
  updateExportButtons(list);
  $("selectAllRegistrations").checked=ids.length>0&&selected===ids.length;
  $("selectAllRegistrations").indeterminate=selected>0&&selected<ids.length;
}
function renderRegistrations(){
  const list=visibleRegistrations();
  if(!list.length){$("registrationsTable").innerHTML='<p class="muted">Sin inscripciones para mostrar.</p>';updateBulkSelectionUI(list);return;}
  const rows=list.map(r=>`<tr class="${selectedRegistrationIds.has(r.id)?"row-selected":""}">
    <td><input type="checkbox" class="registration-select" data-select-registration="${r.id}" aria-label="Seleccionar ${escapeHtml(r.attendee.full_name)}" ${selectedRegistrationIds.has(r.id)?"checked":""}></td>
    <td><span class="name-cell">${escapeHtml(r.attendee.full_name)}<button class="secondary danger-btn" data-delete="${r.id}" title="Eliminar inscrito" aria-label="Eliminar inscrito">🗑</button></span></td>
    <td>${escapeHtml(r.attendee.email||"—")}</td><td>${escapeHtml(r.attendee.organization||"—")}</td>
    <td>${escapeHtml(r.seat_row||"-")}</td><td>${escapeHtml(r.seat_number||"-")}</td>
    <td>${escapeHtml(selectedActivity(r.activity_id)?.name||"—")}</td>
    <td>${r.status==="checked_in"?"Acreditada":r.status==="cancelled"?"Cancelada":"Pendiente"}</td>
    <td><button class="secondary" data-ticket="${r.id}">PDF</button><button class="secondary" data-cancel="${r.id}" ${r.status==="cancelled"?"disabled":""}>Cancelar</button></td>
  </tr>`).join("");
  $("registrationsTable").innerHTML=`<table><thead><tr><th class="selection-column">Sel.</th><th>Persona</th><th>Correo</th><th>Organización</th><th>Fila</th><th>Asiento</th><th>Actividad</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>${rows}</tbody></table>`;
  updateBulkSelectionUI(list);
}
function renderTicketRegistrationOptions(){
 if(currentProfile?.role==="volunteer"){$("ticketRegistration").innerHTML="";$("ticketPreview").innerHTML="";return;}
 const aid=$("ticketActivity").value;
 $("ticketRegistration").innerHTML=registrations.filter(r=>r.activity_id===aid&&r.status!=="cancelled").map(r=>`<option value="${r.id}">${escapeHtml(r.attendee.full_name)} · ${escapeHtml(r.attendee.email||"sin correo")}</option>`).join("");
 renderTicketPreview();
}
function renderCheckins(){
 $("checkinTable").innerHTML=table(["Persona","Actividad","Fecha/hora"],checkins.slice(0,20).map(c=>`<tr><td>${escapeHtml(selectedRegistration(c.registration_id)?.attendee?.full_name||"Participante")}</td><td>${escapeHtml(selectedActivity(c.activity_id)?.name||"—")}</td><td>${escapeHtml(new Date(c.checked_in_at).toLocaleString("es-CL"))}</td></tr>`));
}
function renderManualCheckinList(){
 const host=$("manualCheckinList");
 if(!host)return;
 const activityId=val("checkinActivity");
 if(!activityId){
  $("manualCheckinCount").textContent="Seleccione una actividad para ver sus inscritos.";
  host.innerHTML='<p class="muted">No hay una actividad seleccionada.</p>';return;
 }
 const all=registrations.filter(r=>r.activity_id===activityId);
 const query=val("manualCheckinSearch").toLocaleLowerCase("es");
 const list=all.filter(r=>{
  const person=r.attendee||{};
  const fields=[person.full_name,person.email,person.organization,r.seat_row,r.seat_number].join(" ").toLocaleLowerCase("es");
  return fields.includes(query);
 }).sort((a,b)=>(a.attendee?.full_name||"").localeCompare(b.attendee?.full_name||"","es"));
 const accredited=all.filter(r=>r.status==="checked_in").length;
 $("manualCheckinCount").textContent=`${list.length} personas visibles de ${all.length} inscritas · ${accredited} acreditadas`;
 if(!list.length){
  host.innerHTML='<p class="muted">No se encontraron personas para esta búsqueda y actividad.</p>';return;
 }
 const rows=list.map(r=>{
  const status=r.status==="checked_in"
   ?'<span class="badge good">Acreditada</span>'
   :r.status==="cancelled"
    ?'<span class="badge bad">Cancelada</span>'
    :'<span class="badge warning">Pendiente</span>';
  const action=r.status==="registered"
   ?`<button class="primary manual-accredit-btn" type="button" data-manual-accredit="${r.id}">Acreditar</button>`
   :`<button class="secondary" type="button" disabled>${r.status==="checked_in"?"Acreditada":"No disponible"}</button>`;
  return `<tr><td><strong>${escapeHtml(r.attendee?.full_name||"Sin nombre")}</strong><div class="muted">${escapeHtml(r.attendee?.organization||"")}</div></td><td>${escapeHtml(r.attendee?.email||"—")}</td><td>${escapeHtml(r.seat_row||"—")}</td><td>${escapeHtml(r.seat_number||"—")}</td><td>${status}</td><td>${action}</td></tr>`;
 }).join("");
 host.innerHTML=`<table><thead><tr><th>Persona</th><th>Correo</th><th>Fila</th><th>Asiento</th><th>Estado</th><th>Acción</th></tr></thead><tbody>${rows}</tbody></table>`;
}
function renderUsers(profiles){
 const admin=currentProfile?.role==="admin";
 $("adminTab").classList.toggle("hidden",!admin);
 $("usersTable").innerHTML=admin?table(["Correo","Rol","Acción"],profiles.map(p=>`<tr><td>${escapeHtml(p.email||p.id)}</td><td>${escapeHtml(p.role)}</td><td><select data-role-user="${p.id}"><option value="staff" ${p.role==="staff"?"selected":""}>Personal</option><option value="volunteer" ${p.role==="volunteer"?"selected":""}>Voluntarios</option><option value="admin" ${p.role==="admin"?"selected":""}>Administrador</option></select><button class="secondary" data-save-role="${p.id}">Guardar rol</button></td></tr>`)):'<p class="muted">Se requiere rol administrador.</p>';
}
function clearActivityForm(){ $("activityForm").reset();$("activityId").value="";logoData={institution:"",project:"",partner:""}; }
async function saveActivity(ev){
 ev.preventDefault();const id=val("activityId");
 const payload={name:val("activityName"),description:val("activityDescription"),tagline:val("activityTagline"),place:val("activityPlace"),event_date:val("activityDate"),start_time:val("activityStart"),end_time:val("activityEnd")||null,status:val("activityStatus"),institution_logo:logoData.institution||null,project_logo:logoData.project||null,partner_logo:logoData.partner||null};
 let q=id?supabase.from("activities").update(payload).eq("id",id):supabase.from("activities").insert(payload);
 const {error}=await q;if(error){say("activityMessage",error.message,true);return;}say("activityMessage","Actividad guardada.");clearActivityForm();await loadAll();
}
async function saveRegistration(ev){
 ev.preventDefault();const activityId=val("registrationActivity");if(!activityId){say("registrationMessage","Primero crea una actividad abierta.",true);return;}
 const {data,error}=await supabase.rpc("register_attendee",{p_activity_id:activityId,p_full_name:val("registrationName"),p_email:val("registrationEmail")||null,p_organization:val("registrationOrg")||null,p_seat_row:val("registrationRow")||null,p_seat_number:val("registrationSeat")||null});
 if(error){say("registrationMessage",error.message,true);return;}
 $("registrationForm").reset();await loadAll();$("ticketActivity").value=activityId;renderTicketRegistrationOptions();if(data?.registration_id)$("ticketRegistration").value=data.registration_id;renderTicketPreview();say("registrationMessage","Inscripción guardada y QR único generado.");
}
function parseCsv(text){
 const lines=text.replace(/^\uFEFF/,"").split(/\r?\n/).filter(x=>x.trim());if(lines.length<2)return {rows:[],error:"El CSV no contiene filas de datos."};
 const sep=[",",";","\t"].map(c=>[c,lines[0].split(c).length]).sort((a,b)=>b[1]-a[1])[0][0];
 const parseLine=line=>{const out=[];let cur="",quoted=false;for(let i=0;i<line.length;i++){const ch=line[i];if(ch==='"'&&line[i+1]==='"'&&quoted){cur+='"';i++;}else if(ch==='"'){quoted=!quoted;}else if(ch===sep&&!quoted){out.push(cur.trim());cur="";}else cur+=ch;}out.push(cur.trim());return out;};
 const heads=parseLine(lines[0]).map(h=>h.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,""));
 const idx={name:heads.findIndex(h=>["nombre","nombre completo","name","full_name"].includes(h)),email:heads.findIndex(h=>["email","correo","correo electronico","e-mail"].includes(h)),org:heads.findIndex(h=>["organizacion","organization","institucion"].includes(h)),row:heads.findIndex(h=>["fila","row"].includes(h)),seat:heads.findIndex(h=>["asiento","seat"].includes(h))};
 if(idx.name<0)return {rows:[],error:"Falta una columna de nombre (nombre o nombre completo)."};
 const rows=lines.slice(1).map((line,i)=>{const cells=parseLine(line),name=cells[idx.name]||"",email=idx.email>=0?(cells[idx.email]||""):"",org=idx.org>=0?(cells[idx.org]||""):"",row=idx.row>=0?(cells[idx.row]||""):"",seat=idx.seat>=0?(cells[idx.seat]||""):"";let error="";if(!name)error="Nombre obligatorio";else if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))error="Correo inválido";else if(row.length>40||seat.length>40)error="Fila y asiento admiten hasta 40 caracteres";return {line:i+2,name,email,org,row,seat,error,valid:!error};});
 return {rows,error:""};
}
function normalizeEmail(email){return String(email||"").trim().toLocaleLowerCase("es");}
function refreshCsvDuplicateWarnings(){
 const activityId=val("csvActivity");
 const existingEmails=new Set(registrations.filter(r=>r.activity_id===activityId&&r.status!=="cancelled").map(r=>normalizeEmail(r.attendee?.email)).filter(Boolean));
 const counts=new Map();
 csvRows.forEach(row=>{const email=normalizeEmail(row.email);if(row.valid&&email)counts.set(email,(counts.get(email)||0)+1);});
 csvRows.forEach(row=>{
  const email=normalizeEmail(row.email);row.warnings=[];
  if(!row.valid||!email)return;
  if((counts.get(email)||0)>1)row.warnings.push("Correo duplicado dentro del CSV");
  if(existingEmails.has(email))row.warnings.push("Correo ya inscrito en esta actividad");
 });
 renderCsvPreview();
}
function renderCsvPreview(){
 const preview=$("csvPreview");
 if(!csvRows.length){preview.innerHTML="";$("importCsvBtn").disabled=true;return;}
 const visible=csvRows.map((r,index)=>{
  let status="";
  if(r.imported)status='<span class="badge good">Importada</span>';
  else if(!r.valid)status='<span class="badge bad">'+escapeHtml(r.error)+'</span>';
  else if(r.warnings.length)status='<span class="badge warning">⚠ '+r.warnings.map(escapeHtml).join("<br>⚠ ")+'</span>';
  else status='<span class="badge good">Válida</span>';
  if(r.importError)status+='<div class="csv-row-error">'+escapeHtml(r.importError)+'</div>';
  const canInclude=r.valid&&!r.imported;
  const include='<label class="csv-include"><input type="checkbox" data-csv-include="'+index+'" '+(canInclude&&!r.excluded?'checked':'')+' '+(canInclude?'':'disabled')+'> Incluir</label>';
  const excludeButton=r.valid&&!r.imported&&r.warnings.length
   ?'<button type="button" class="secondary csv-exclude" data-csv-exclude="'+index+'">'+(r.excluded?'Reincorporar':'Excluir duplicado')+'</button>':'';
  return '<tr class="'+(r.excluded?'csv-excluded':'')+'"><td>'+r.line+'</td><td>'+escapeHtml(r.name)+'</td><td>'+escapeHtml(r.email||"—")+'</td><td>'+escapeHtml(r.org||"—")+'</td><td>'+escapeHtml(r.row||"-")+'</td><td>'+escapeHtml(r.seat||"-")+'</td><td>'+status+'</td><td>'+include+' '+excludeButton+'</td></tr>';
 }).join("");
 preview.innerHTML='<table><thead><tr><th>Fila CSV</th><th>Nombre</th><th>Correo</th><th>Organización</th><th>Fila</th><th>Asiento</th><th>Validación</th><th>Importar</th></tr></thead><tbody>'+visible+'</tbody></table>';
 const included=csvRows.filter(r=>r.valid&&!r.excluded&&!r.imported).length;
 const duplicateIncluded=csvRows.filter(r=>r.valid&&!r.excluded&&!r.imported&&r.warnings.length).length;
 const excluded=csvRows.filter(r=>r.excluded).length,invalid=csvRows.filter(r=>!r.valid).length;
 $("importCsvBtn").disabled=included===0;
 $("importCsvBtn").textContent='Importar filas incluidas ('+included+')';
 say("csvMessage",included+' listas para importar · '+duplicateIncluded+' con alerta de correo duplicado · '+excluded+' excluidas · '+invalid+' con errores. Los correos repetidos son advertencias y se importan salvo que usted los excluya.');
}
$("csvFile").addEventListener("change",async ev=>{
 const file=ev.target.files?.[0];csvRows=[];$("importCsvBtn").disabled=true;
 if(!file){renderCsvPreview();return;}
 const result=parseCsv(await file.text());
 if(result.error){say("csvMessage",result.error,true);$("csvPreview").innerHTML="";return;}
 csvRows=result.rows.map(row=>({...row,warnings:[],excluded:false,imported:false,importError:""}));
 refreshCsvDuplicateWarnings();
});
$("csvPreview").addEventListener("change",ev=>{
 const checkbox=ev.target.closest("[data-csv-include]");if(!checkbox)return;
 const row=csvRows[Number(checkbox.dataset.csvInclude)];if(!row||!row.valid||row.imported)return;
 row.excluded=!checkbox.checked;renderCsvPreview();
});
$("csvPreview").addEventListener("click",ev=>{
 const button=ev.target.closest("[data-csv-exclude]");if(!button)return;
 const row=csvRows[Number(button.dataset.csvExclude)];if(!row||!row.valid||row.imported)return;
 row.excluded=!row.excluded;renderCsvPreview();
});
async function importCsv(){
 const aid=val("csvActivity"),selected=csvRows.filter(r=>r.valid&&!r.excluded&&!r.imported);
 if(!aid||!selected.length){say("csvMessage","Seleccione una actividad y al menos una fila para importar.",true);return;}
 $("importCsvBtn").disabled=true;let ok=0,failed=[];
 for(let i=0;i<selected.length;i++){
  const row=selected[i];say("csvMessage",'Importando '+(i+1)+' de '+selected.length+'…');
  const {error}=await supabase.rpc("register_attendee",{p_activity_id:aid,p_full_name:row.name,p_email:row.email||null,p_organization:row.org||null,p_seat_row:row.row||null,p_seat_number:row.seat||null});
  if(error){row.importError=error.message;failed.push('Fila '+row.line+': '+error.message);}
  else{row.imported=true;row.importError="";ok++;}
 }
 const duplicateImported=selected.filter(row=>row.imported&&row.warnings.length).length;
 await loadAll();refreshCsvDuplicateWarnings();
 say("csvMessage",'Importadas '+ok+' filas'+(duplicateImported?' (incluidas '+duplicateImported+' con correo repetido)':'')+'.'+(failed.length?' Errores: '+failed.slice(0,5).join(" | "):''),failed.length>0);
}
function ticketDocument(reg){
 const a=selectedActivity(reg.activity_id);if(!a)throw new Error("No se encontró la actividad de esta inscripción.");
 const host=document.createElement("div");host.innerHTML=`<article class="ticket">${ticketMarkup}</article>`;
 const root=host.querySelector(".ticket");
 const set=(id,text)=>{const el=root.querySelector("#"+id);if(el)el.textContent=text||"";};
 set("previewPerson",reg.attendee.full_name);set("previewOrg",reg.attendee.organization||"");
 set("previewEventName",a.name);set("previewEventDesc",a.tagline||a.description||"");
 const start=ticketTime(a.start_time),end=ticketTime(a.end_time);
 set("previewDate",ticketDateLabel(a.event_date));set("previewTime",start?`${start}${end?"–"+end:""}`:"Por definir");set("previewPlace",a.place);
 const seatLabels=root.querySelectorAll(".seat div");
 if(seatLabels[0])seatLabels[0].textContent=`FILA: ${reg.seat_row||"-"}`;
 if(seatLabels[1])seatLabels[1].textContent=`ASIENTO: ${reg.seat_number||"-"}`;
 const imgs=[["logoPreview",a.institution_logo],["projectLogoPreview",a.project_logo],["partnerLogoPreview",a.partner_logo]];
 imgs.forEach(([id,src])=>{const img=root.querySelector("#"+id);if(src){img.src=src;img.hidden=false;img.style.display="block";}else img.remove();});
 const qr=root.querySelector("#qrPreview");qr.removeAttribute("src");qr.alt="Código QR";
 const qrHolder=document.createElement("div");qrHolder.style.cssText="position:absolute;left:-99999px;top:0";
 document.body.appendChild(qrHolder);
 new QRCode(qrHolder,{text:reg.qr_token,width:320,height:320,colorDark:"#17151c",colorLight:"#ffffff",correctLevel:QRCode.CorrectLevel.M});
 const canvas=qrHolder.querySelector("canvas");if(canvas)qr.src=canvas.toDataURL("image/png");qrHolder.remove();
 return root;
}
function resizeTicketPreview(){
 const frame=$("ticketPreview").querySelector(".ticket-preview-frame"),ticket=frame?.querySelector(".ticket");
 if(!frame||!ticket)return;
 const width=ticket.offsetWidth,available=frame.clientWidth;
 if(width&&available)ticket.style.transform=`scale(${Math.min(1,available/width)})`;
}
function renderTicketPreview(){
 const id=$("ticketRegistration").value,reg=selectedRegistration(id),preview=$("ticketPreview");preview.innerHTML="";if(!reg)return;
 try{
  const frame=document.createElement("div");frame.className="ticket-preview-frame";
  frame.appendChild(ticketDocument(reg));preview.appendChild(frame);resizeTicketPreview();
 }catch(e){preview.textContent=e.message;}
}
new ResizeObserver(resizeTicketPreview).observe($("ticketPreview"));
function pdfWorker(root,scale=2){
 return html2pdf().set({
  margin:3,
  image:{type:"jpeg",quality:.98},
  html2canvas:{
   scale,useCORS:true,backgroundColor:"#fff",logging:false,scrollX:0,scrollY:0,
   onclone:clonedDocument=>{
    const stage=clonedDocument.getElementById("pdfStage");
    if(stage)Object.assign(stage.style,{left:"0px",top:"0px",opacity:"1",zIndex:"9999"});
   }
  },
  jsPDF:{unit:"mm",format:[303,104.08],orientation:"landscape"}
 }).from(root);
}
async function waitForTicketImages(root){
 const images=[...root.querySelectorAll("img")].filter(image=>image.getAttribute("src"));
 await Promise.all(images.map(image=>image.decode()));
}
async function downloadPdf(reg){
 const root=ticketDocument(reg),stage=$("pdfStage");
 stage.innerHTML="";stage.appendChild(root);
 try{
  await waitForTicketImages(root);
  const name=(reg.attendee.full_name||"entrada").normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-zA-Z0-9_-]+/g,"-").slice(0,45);
  await pdfWorker(root).set({filename:`entrada-${name}.pdf`}).save();
 }finally{stage.innerHTML="";}
}
async function downloadOne(){const reg=selectedRegistration($("ticketRegistration").value);if(!reg){say("ticketMessage","Selecciona una inscripción.",true);return;}try{await downloadPdf(reg);say("ticketMessage","PDF generado.");}catch(e){say("ticketMessage",e.message,true);}}
async function downloadZip(){
 const aid=val("ticketActivity"),list=registrations.filter(r=>r.activity_id===aid&&r.status!=="cancelled");if(!list.length){say("ticketMessage","No hay inscripciones para esta actividad.",true);return;}
 const btn=$("downloadZipBtn");btn.disabled=true;btn.textContent="Generando ZIP…";
 try{const zip=new JSZip(),stage=$("pdfStage");for(let i=0;i<list.length;i++){const reg=list[i],root=ticketDocument(reg);stage.innerHTML="";stage.appendChild(root);await waitForTicketImages(root);const pdf=await pdfWorker(root,1.6).toPdf().get("pdf");const blob=pdf.output("blob");const safe=(reg.attendee.full_name||"entrada").replace(/[^a-zA-Z0-9_-]+/g,"-").slice(0,45);zip.file(`${String(i+1).padStart(3,"0")}-${safe}.pdf`,blob);$("ticketMessage").textContent=`Generando entradas: ${i+1}/${list.length}`;}
  stage.innerHTML="";const blob=await zip.generateAsync({type:"blob"});const url=URL.createObjectURL(blob),link=document.createElement("a");link.href=url;link.download="espacio-acredita-entradas.zip";link.click();URL.revokeObjectURL(url);say("ticketMessage",`ZIP generado con ${list.length} entradas.`);
 }catch(e){$("pdfStage").innerHTML="";say("ticketMessage",e.message,true);}finally{btn.disabled=false;btn.textContent="Descargar todas las entradas (ZIP)";}
}
function parseQr(decoded){const raw=String(decoded||"").trim();const prefixes=["ESPACIO-ACREDITA:","EA:"];for(const p of prefixes)if(raw.startsWith(p))return raw.slice(p.length);return raw;}
async function checkin(token){
 token=parseQr(token);if(!token){$("checkinResult").className="checkin-result bad";$("checkinResult").textContent="Ingresa o escanea un QR.";return;}
 const aid=val("checkinActivity");
 const {data,error}=await supabase.rpc("check_in_ticket",{p_token:token,p_activity_id:aid||null});
 const result=$("checkinResult");result.className="checkin-result "+(!error&&data?.ok?"good":"bad");
 result.textContent=error?`Error de validación: ${error.message}`:(data?.message||"No se pudo validar la entrada.");
 await loadAll();
}
async function manualAccreditRegistration(id){
 const registration=selectedRegistration(id);
 const activityId=val("checkinActivity");
 if(!registration||registration.activity_id!==activityId)return;
 if(registration.status==="checked_in"){say("checkinResult","Esta persona ya está acreditada.");return;}
 if(registration.status==="cancelled"){say("checkinResult","No se puede acreditar una inscripción cancelada.",true);return;}
 if(!confirm(`¿Confirmar la acreditación manual de ${registration.attendee?.full_name||"esta persona"}? ${registration.seat_row||"Sin fila"} · Asiento ${registration.seat_number||"Sin asiento"}`))return;
 const button=document.querySelector(`[data-manual-accredit="${id}"]`);
 if(button){button.disabled=true;button.textContent="Acreditando…";}
 const {data,error}=await supabase.rpc("manual_check_in_registration",{
  p_registration_id:id,p_activity_id:activityId
 });
 if(error){
  say("checkinResult",`No se pudo acreditar: ${error.message}`,true);
  if(button){button.disabled=false;button.textContent="Acreditar";}
  return;
 }
 const result=$("checkinResult");
 result.className="checkin-result "+(data?.ok?"good":"bad");
 result.textContent=data?.message||"No se pudo completar la acreditación manual.";
 await loadAll();
}
async function startScanner(){
 if(!window.Html5Qrcode){say("checkinResult","No se cargó el lector QR; verifica la conexión a internet.",true);return;}
 try{scanner=new Html5Qrcode("qrReader");await scanner.start({facingMode:"environment"},{fps:10,qrbox:{width:250,height:250}},decoded=>{scanner.pause(true);checkin(decoded).finally(()=>setTimeout(()=>scanner?.resume(),1800));},()=>{});$("startScannerBtn").disabled=true;$("stopScannerBtn").disabled=false;}
 catch(e){say("checkinResult",`No se pudo activar la cámara: ${e.message}. Usa la validación manual.`,true);scanner=null;}
}
async function stopScanner(){if(scanner){try{await scanner.stop();await scanner.clear();}catch{}scanner=null;}$("startScannerBtn").disabled=false;$("stopScannerBtn").disabled=true;}
async function editActivity(id){const a=selectedActivity(id);if(!a)return;$("activityId").value=a.id;$("activityName").value=a.name;$("activityDescription").value=a.description||"";$("activityTagline").value=a.tagline||"";$("activityPlace").value=a.place;$("activityDate").value=a.event_date;$("activityStart").value=a.start_time;$("activityEnd").value=a.end_time||"";$("activityStatus").value=a.status;logoData={institution:a.institution_logo||"",project:a.project_logo||"",partner:a.partner_logo||""};switchTab("activities");}
async function toggleActivity(id){const a=selectedActivity(id);if(!a)return;const {error}=await supabase.from("activities").update({status:a.status==="open"?"closed":"open"}).eq("id",id);if(error)alert(error.message);else await loadAll();}
async function deleteRegistration(id){const r=selectedRegistration(id);if(!confirm(`¿Eliminar definitivamente a ${r?.attendee.full_name||"este inscrito"}? Se borrarán su inscripción y su QR; no se puede deshacer.`))return;const {error}=await supabase.rpc("delete_registration",{p_registration_id:id});if(error)alert(error.message);else{selectedRegistrationIds.delete(id);await loadAll();}}
async function deleteRegistrationBatch(ids,operationLabel){
  const uniqueIds=[...new Set(ids)];if(!uniqueIds.length)return;
  $("deleteSelectedBtn").disabled=true;$("deleteAllVisibleBtn").disabled=true;
  let deleted=0,failures=[];
  for(let i=0;i<uniqueIds.length;i++){
    say("bulkDeleteMessage",`${operationLabel}: eliminando ${i+1} de ${uniqueIds.length}…`);
    const {error}=await supabase.rpc("delete_registration",{p_registration_id:uniqueIds[i]});
    if(error)failures.push(error.message);else{deleted++;selectedRegistrationIds.delete(uniqueIds[i]);}
  }
  await loadAll();
  if(failures.length)say("bulkDeleteMessage",`Finalizado: ${deleted} eliminados; ${failures.length} con error. ${failures.slice(0,3).join(" | ")}`,true);
  else say("bulkDeleteMessage",`Finalizado: ${deleted} inscripción(es) eliminada(s), incluidos sus QR y registros de acreditación asociados.`);
}
async function deleteSelectedRegistrations(){
  const ids=[...selectedRegistrationIds];if(!ids.length)return;
  if(!confirm(`Va a eliminar definitivamente ${ids.length} inscripción(es) seleccionada(s). Se borrarán sus QR y registros de acreditación asociados. Otras inscripciones de las mismas personas en actividades distintas se conservarán. ¿Desea continuar?`))return;
  await deleteRegistrationBatch(ids,"Eliminación seleccionada");
}
async function deleteAllVisibleRegistrations(){
  const list=visibleRegistrations();if(!list.length)return;
  const filter=$("registrationFilter").value;
  const scope=filter?`la actividad «${selectedActivity(filter)?.name||"seleccionada"}»`:"TODAS las actividades";
  if(!confirm(`ATENCIÓN: se eliminarán TODOS los inscritos de ${scope}. Total: ${list.length} inscripción(es). También se eliminarán sus QR y registros de acreditación asociados. No se puede deshacer. Las inscripciones de esas personas en otras actividades se conservan. ¿Desea continuar?`))return;
  const typed=prompt(`Para confirmar, escriba exactamente ELIMINAR (se eliminarán ${list.length} inscripciones de ${scope}):`);
  if(typed!=="ELIMINAR"){say("bulkDeleteMessage","Eliminación cancelada: la confirmación no coincidió.");return;}
  await deleteRegistrationBatch(list.map(r=>r.id),"Eliminación masiva");
}
function downloadCsvTemplate(){const csv="\uFEFFnombre,email,organizacion,fila,asiento\nMaría Pérez,maria@ejemplo.cl,Fundación Ejemplo,A,12\nJuan Soto,juan@ejemplo.cl,,,\n";const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"}));a.download="formato_inscripcion_masiva.csv";document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}
async function cancelRegistration(id){if(!confirm("¿Cancelar esta inscripción? El QR dejará de ser válido."))return;const {error}=await supabase.from("registrations").update({status:"cancelled"}).eq("id",id);if(error)alert(error.message);else await loadAll();}
async function createManagedUser(ev){
 ev.preventDefault();
 if(currentProfile?.role!=="admin"){say("createUserMessage","Solo un administrador puede crear cuentas.",true);return;}
 const email=val("createUserEmail").toLowerCase();
 const password=$("createUserPassword").value;
 const passwordConfirm=$("createUserPasswordConfirm").value;
 const role=val("createUserRole");
 if(!email){say("createUserMessage","Ingrese el correo que servirá como cuenta de acceso.",true);return;}
 if(password.length<8){say("createUserMessage","La contraseña debe tener al menos 8 caracteres.",true);return;}
 if(password!==passwordConfirm){say("createUserMessage","Las contraseñas no coinciden.",true);return;}
 const button=$("createUserForm").querySelector('button[type="submit"]');
 button.disabled=true;button.textContent="Creando cuenta…";
 say("createUserMessage","Creando y habilitando la cuenta…");
 try{
  const {data,error}=await supabase.functions.invoke("admin-invite-user",{body:{email,password,role}});
  if(error){
   let message=error.message||"No fue posible crear la cuenta.";
   try{const response=error.context;const body=response?.clone?await response.clone().json():null;if(body?.error)message=body.error;}catch{}
   say("createUserMessage",message,true);return;
  }
  if(!data?.success){say("createUserMessage",data?.error||"No fue posible completar la creación de la cuenta.",true);return;}
  $("createUserForm").reset();
  say("createUserMessage",data.message||"Cuenta creada y habilitada para iniciar sesión.");
  await loadAll();
 }catch(error){
  say("createUserMessage",error?.message||"No fue posible conectar con el servicio de creación de cuentas.",true);
 }finally{
  button.disabled=false;button.textContent="Crear cuenta";
 }
}
async function saveRole(id){const role=document.querySelector(`[data-role-user="${id}"]`).value;const {error}=await supabase.from("profiles").update({role}).eq("id",id);if(error)alert(error.message);else await loadAll();}
function switchTab(name){
 if(currentProfile?.role==="superadmin")name="superadmin";
 else if(currentProfile?.role==="volunteer")name="checkin";
 document.querySelectorAll(".tab-panel").forEach(x=>x.classList.add("hidden"));
 $("tab-"+name)?.classList.remove("hidden");
 document.querySelectorAll("[data-tab]").forEach(x=>x.classList.toggle("active",x.dataset.tab===name));
 if(name==="tickets")resizeTicketPreview();
}
$("loginForm").addEventListener("submit",async ev=>{ev.preventDefault();say("loginMessage","Iniciando sesión…");if(!supabase){say("loginMessage","Configura Supabase en src/config.js.",true);return;}const {data,error}=await supabase.auth.signInWithPassword({email:val("loginEmail"),password:$("loginPassword").value});if(error){say("loginMessage",error.message,true);return;}currentUser=data.user;await afterLogin();});
$("showSignupBtn").addEventListener("click",()=>{
 $("loginView").classList.add("hidden");$("signupView").classList.remove("hidden");say("signupMessage","");
});
$("showLoginBtn").addEventListener("click",()=>{
 $("signupView").classList.add("hidden");$("loginView").classList.remove("hidden");say("loginMessage","");
});
async function signUpOrganization(ev){
 ev.preventDefault();
 if(!supabase){say("signupMessage","No se pudo conectar con Supabase.",true);return;}
 const fullName=val("signupFullName");
 const email=val("signupEmail").toLowerCase();
 const password=$("signupPassword").value;
 const passwordConfirm=$("signupPasswordConfirm").value;
 const organizationName=val("signupOrganization");
 if(fullName.length<2||fullName.length>180){say("signupMessage","Ingrese su nombre completo.",true);return;}
 if(organizationName.length<2||organizationName.length>180){say("signupMessage","El nombre de la organización debe tener entre 2 y 180 caracteres.",true);return;}
 if(password.length<8){say("signupMessage","La contraseña debe tener al menos 8 caracteres.",true);return;}
 if(password!==passwordConfirm){say("signupMessage","Las contraseñas no coinciden.",true);return;}
 const button=$("signupForm").querySelector('button[type="submit"]');
 button.disabled=true;button.textContent="Creando organización…";
 say("signupMessage","Creando su cuenta y espacio de trabajo…");
 try{
  const {data,error}=await supabase.auth.signUp({
   email,password,
   options:{data:{full_name:fullName,organization_name:organizationName}}
  });
  if(error){say("signupMessage",error.message,true);return;}
  if(data.session&&data.user){
   currentUser=data.user;
   await afterLogin();
   return;
  }
  $("signupForm").reset();
  say("signupMessage","Su cuenta y organización fueron creadas. Revise su correo para confirmar la dirección y luego inicie sesión.");
 }catch(error){
  say("signupMessage",error?.message||"No fue posible crear la cuenta.",true);
 }finally{
  button.disabled=false;button.textContent="Crear mi organización";
 }
}

$("passwordChangeForm").addEventListener("submit",async ev=>{
 ev.preventDefault();
 const password=$("forcedNewPassword").value,confirmPassword=$("forcedNewPasswordConfirm").value;
 if(password.length<14){say("passwordChangeMessage","La nueva contraseña debe tener al menos 14 caracteres.",true);return;}
 if(password!==confirmPassword){say("passwordChangeMessage","Las contraseñas no coinciden.",true);return;}
 const button=$("passwordChangeForm").querySelector('button[type="submit"]');
 button.disabled=true;button.textContent="Actualizando…";
 try{
  const {data,error}=await supabase.auth.updateUser({password,data:{...(currentUser?.user_metadata||{}),must_change_password:false}});
  if(error)throw error;
  currentUser=data.user;say("passwordChangeMessage","Contraseña actualizada correctamente.");
  await afterLogin();
 }catch(error){say("passwordChangeMessage",error?.message||"No se pudo actualizar la contraseña.",true);}
 finally{button.disabled=false;button.textContent="Actualizar contraseña y continuar";}
});
$("signupForm").addEventListener("submit",signUpOrganization);
$("logoutBtn").addEventListener("click",async()=>{await stopScanner();await supabase.auth.signOut();currentUser=null;currentProfile=null;setSignedIn(false);});
async function afterLogin(){
 if(currentUser?.user_metadata?.must_change_password===true){
  $("loginView").classList.add("hidden");$("signupView").classList.add("hidden");$("appView").classList.add("hidden");
  $("passwordChangeView").classList.remove("hidden");$("logoutBtn").classList.remove("hidden");
  $("userLabel").textContent=currentUser.email||"";return;
 }
 const {data,error}=await supabase.from("profiles").select("*, organizations(id,name,slug)").eq("id",currentUser.id).maybeSingle();
 const isSuperadmin=data?.role==="superadmin"&&(currentUser?.email||"").toLowerCase()==="vamoreno.maturana@gmail.com";
 if(error||!data||(!data.organization_id&&!isSuperadmin)||(!isSuperadmin&&!data.organizations)){
  const message="La cuenta no está asociada a una organización ni tiene permisos globales. Solicite al administrador que revise su configuración.";
  if(!$("signupView").classList.contains("hidden"))say("signupMessage",message,true);
  else say("loginMessage",message,true);
  await supabase.auth.signOut();currentUser=null;currentProfile=null;setSignedIn(false);return;
 }
 currentProfile=data;setSignedIn(true);
 if(isSuperadmin){await initSuperadmin(supabase,currentUser);switchTab("superadmin");return;}
 await loadAll();switchTab(currentProfile.role==="volunteer"?"checkin":"dashboard");
}
$("downloadCsvTemplateBtn").addEventListener("click",downloadCsvTemplate);$("createUserForm").addEventListener("submit",createManagedUser);$("activityForm").addEventListener("submit",saveActivity);$("clearActivity").addEventListener("click",clearActivityForm);$("registrationForm").addEventListener("submit",saveRegistration);$("importCsvBtn").addEventListener("click",importCsv);
$("registrationFilter").addEventListener("change",()=>{selectedRegistrationIds.clear();renderRegistrations();say("bulkDeleteMessage","Selección reiniciada al cambiar el filtro.");});
$("csvActivity").addEventListener("change",refreshCsvDuplicateWarnings);
$("selectAllRegistrations").addEventListener("change",ev=>{
  visibleRegistrations().forEach(reg=>ev.target.checked?selectedRegistrationIds.add(reg.id):selectedRegistrationIds.delete(reg.id));
  renderRegistrations();
});
$("registrationsTable").addEventListener("change",ev=>{
  const checkbox=ev.target.closest("[data-select-registration]");if(!checkbox)return;
  if(checkbox.checked)selectedRegistrationIds.add(checkbox.dataset.selectRegistration);
  else selectedRegistrationIds.delete(checkbox.dataset.selectRegistration);
  renderRegistrations();
});
$("deleteSelectedBtn").addEventListener("click",deleteSelectedRegistrations);
$("deleteAllVisibleBtn").addEventListener("click",deleteAllVisibleRegistrations);$("exportRegistrationsBtn").addEventListener("click",()=>downloadRegistrationCsv("registered"));$("exportAccreditedBtn").addEventListener("click",()=>downloadRegistrationCsv("accredited"));$("ticketActivity").addEventListener("change",renderTicketRegistrationOptions);$("ticketRegistration").addEventListener("change",renderTicketPreview);$("downloadOneBtn").addEventListener("click",downloadOne);$("downloadZipBtn").addEventListener("click",downloadZip);
$("manualCheckinForm").addEventListener("submit",ev=>{ev.preventDefault();checkin(val("manualToken"));});$("startScannerBtn").addEventListener("click",startScanner);$("stopScannerBtn").addEventListener("click",stopScanner);
document.addEventListener("click",ev=>{
 const t=ev.target.closest("[data-tab],[data-goto],[data-edit-activity],[data-toggle-activity],[data-ticket],[data-cancel],[data-delete],[data-save-role],[data-manual-accredit]");
 if(!t)return;
 if(t.dataset.goto==="auditorio"){
  if(currentProfile?.role==="volunteer")return;
  const aid=val("registrationFilter")||val("registrationActivity")||activities[0]?.id||"";
  location.href="./auditorio.html"+(aid?"?activity="+encodeURIComponent(aid):"");return;
 }
 if(t.dataset.tab)switchTab(t.dataset.tab);
 if(t.dataset.goto)switchTab(t.dataset.goto);
 if(t.dataset.editActivity)editActivity(t.dataset.editActivity);
 if(t.dataset.toggleActivity)toggleActivity(t.dataset.toggleActivity);
 if(t.dataset.ticket){const r=selectedRegistration(t.dataset.ticket);if(r){$("ticketActivity").value=r.activity_id;renderTicketRegistrationOptions();$("ticketRegistration").value=r.id;renderTicketPreview();switchTab("tickets");}}
 if(t.dataset.cancel)cancelRegistration(t.dataset.cancel);
 if(t.dataset.delete)deleteRegistration(t.dataset.delete);
 if(t.dataset.saveRole)saveRole(t.dataset.saveRole);
 if(t.dataset.manualAccredit)manualAccreditRegistration(t.dataset.manualAccredit);
});
for(const [input,key] of [["activityLogo","institution"],["projectLogo","project"],["partnerLogo","partner"]])$(input).addEventListener("change",async ev=>{const f=ev.target.files?.[0];if(!f)return;if(!f.type.startsWith("image/")){say("activityMessage","Selecciona un archivo de imagen.",true);return;}if(f.size>1_500_000){say("activityMessage","El logotipo supera 1,5 MB. Reduce su tamaño antes de subirlo.",true);return;}logoData[key]=await fileAsDataUrl(f);});
$("ticketActivity").addEventListener("change",()=>{activityOptions("ticketActivity");renderTicketRegistrationOptions();});
$("checkinActivity").addEventListener("change",renderManualCheckinList);
$("manualCheckinSearch").addEventListener("input",renderManualCheckinList);
$("adminTab").addEventListener("click",()=>{if(currentProfile?.role!=="admin")switchTab("dashboard");});
if(supabase){supabase.auth.getSession().then(async({data})=>{if(data.session){currentUser=data.session.user;await afterLogin();}});supabase.auth.onAuthStateChange((_event,session)=>{if(!session){currentUser=null;currentProfile=null;setSignedIn(false);}});}
