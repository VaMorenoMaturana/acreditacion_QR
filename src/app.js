import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";
import { ticketMarkup } from "./ticket-template.js";
import { ticketMarkupVertical } from "./ticket-template-vertical.js";
import { initSuperadmin } from "./superadmin.js";
import { createDefaultTicketDesign, normalizeTicketDesign, renderTicketDesign, ticketFieldLabels } from "./ticket-designer.js";

const $ = id => document.getElementById(id);
const validConfig = SUPABASE_URL.startsWith("https://") && !SUPABASE_URL.includes("TU-PROYECTO") &&
  SUPABASE_ANON_KEY.length > 25 && !SUPABASE_ANON_KEY.includes("PEGA_AQUI");
if (!validConfig) $("setupNotice").classList.remove("hidden");
const supabase = window.supabase?.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
let currentUser = null, currentProfile = null, activities = [], registrations = [], checkins = [];
const selectedRegistrationIds = new Set();
let csvRows = [], scanner = null, logoData = {institution:"",project:"",partner:""};
const TICKET_DEFAULT_COLORS = {
 classic:{background:"#3c7894",accent:"#35105c",text:"#fffdf8"},
 vertical:{background:"#190b28",accent:"#83b6d0",text:"#f8f4fb"}
};
let ticketSettings={template:"classic",customTemplateId:null,customDesign:null,customTemplateName:"",colors:{classic:{...TICKET_DEFAULT_COLORS.classic},vertical:{...TICKET_DEFAULT_COLORS.vertical}}};
let ticketTemplates=[],ticketEditorDesign=null,ticketEditorTemplateId="",ticketEditorSelectedId="",ticketEditorDrag=null;
let mailSettingsMeta=null,mailConnected=false,mailLogsByRegistration=new Map(),mailSending=false,mailLogsReady=false,mailLogsActivityId="";
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
 const admin=currentProfile?.role==="admin";
 document.querySelectorAll(".tabs [data-tab],.tabs [data-goto]").forEach(button=>{
  if(superadmin) button.classList.toggle("hidden",button.id!=="superadminTab");
  else button.classList.toggle("hidden",button.id==="superadminTab"||(button.id==="mailTab"&&!admin)||(volunteer&&button.dataset.tab!=="checkin"));
 });
}
function table(headers, rows){if(!rows.length)return '<p class="muted">Sin registros para mostrar.</p>';return `<table><thead><tr>${headers.map(h=>`<th>${escapeHtml(h)}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table>`;}
function activityOptions(selectId, includeAll=false){const select=$(selectId);if(!select)return;const old=select.value;select.innerHTML=(includeAll?'<option value="">Todas las actividades</option>':'')+activities.map(a=>`<option value="${a.id}">${escapeHtml(a.name)}${a.status==="closed"?" (cerrada)":""}</option>`).join("");if([...select.options].some(o=>o.value===old))select.value=old;}
function selectedActivity(id){return activities.find(a=>a.id===id);}
function selectedRegistration(id){return registrations.find(r=>r.id===id);}
function ticketSettingsKey(){return `espacio-acredita:ticket-design:${currentProfile?.organization_id||"sin-organizacion"}`;}
function safeTicketColor(value,fallback){return /^#[0-9a-f]{6}$/i.test(String(value||""))?value:fallback;}
function loadTicketSettings(){
 const defaults={template:"classic",customTemplateId:null,customDesign:null,customTemplateName:"",colors:{classic:{...TICKET_DEFAULT_COLORS.classic},vertical:{...TICKET_DEFAULT_COLORS.vertical}}};
 try{
  const saved=JSON.parse(localStorage.getItem(ticketSettingsKey())||"null");
  if(!saved||typeof saved!=="object")return defaults;
  const colors={};
  for(const format of ["classic","vertical"]){
   colors[format]={
    background:safeTicketColor(saved.colors?.[format]?.background,defaults.colors[format].background),
    accent:safeTicketColor(saved.colors?.[format]?.accent,defaults.colors[format].accent),
    text:safeTicketColor(saved.colors?.[format]?.text,defaults.colors[format].text)
   };
  }
  return {
   template:["classic","vertical","custom"].includes(saved.template)?saved.template:"classic",
   customTemplateId:typeof saved.customTemplateId==="string"?saved.customTemplateId:null,
   customDesign:null,customTemplateName:"",colors
  };
 }catch(error){console.warn("No se pudieron leer los ajustes de entradas:",error);return defaults;}
}
function saveTicketSettings(){
 try{
  const persisted={template:ticketSettings.template,customTemplateId:ticketSettings.customTemplateId,colors:ticketSettings.colors};
  localStorage.setItem(ticketSettingsKey(),JSON.stringify(persisted));
 }catch(error){console.warn("No se pudieron guardar los ajustes de entradas:",error);}
}
function updateTicketDesignControls(){
 const format=$("ticketTemplate");if(!format)return;
 format.value=ticketSettings.template==="custom"&&ticketSettings.customTemplateId?"custom:"+ticketSettings.customTemplateId:ticketSettings.template;
 const custom=ticketSettings.template==="custom";
 $("ticketQuickColorControls").classList.toggle("hidden",custom);
 $("ticketOpenEditorBtn").textContent=custom?"Editar plantilla activa":"Crear una plantilla personalizada";
 if(!custom){
  const colors=ticketSettings.colors[ticketSettings.template]||ticketSettings.colors.classic;
  $("ticketBackground").value=colors.background;
  $("ticketAccent").value=colors.accent;
  $("ticketTextColor").value=colors.text;
 }
}
function selectTicketTemplate(){
 const value=$("ticketTemplate").value;
 if(value==="classic"||value==="vertical"){
  ticketSettings.template=value;ticketSettings.customTemplateId=null;ticketSettings.customDesign=null;ticketSettings.customTemplateName="";
 }else if(value.startsWith("custom:")){
  const id=value.slice(7),template=ticketTemplates.find(item=>item.id===id);
  if(!template)return;
  ticketSettings.template="custom";ticketSettings.customTemplateId=template.id;
  ticketSettings.customDesign=normalizeTicketDesign(template.design);ticketSettings.customTemplateName=template.name;
 }
 saveTicketSettings();updateTicketDesignControls();renderTicketPreview();
}
function changeTicketColors(){
 const colors=ticketSettings.colors[ticketSettings.template];
 colors.background=$("ticketBackground").value;
 colors.accent=$("ticketAccent").value;
 colors.text=$("ticketTextColor").value;
 saveTicketSettings();renderTicketPreview();
}
function resetTicketDesignColors(){
 ticketSettings.colors[ticketSettings.template]={...TICKET_DEFAULT_COLORS[ticketSettings.template]};
 saveTicketSettings();updateTicketDesignControls();renderTicketPreview();
}
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
    const registrationError=`No se pudieron cargar las inscripciones: ${r.error.message}. Los datos no se han eliminado; revise la relación y los permisos de Supabase.`;
    say("registrationLoadError",registrationError,true);
  }else{
    say("registrationLoadError","");
    registrations=(r.data||[]).map(x=>({...x,attendee:x.attendees||{}}));
    const validRegistrationIds=new Set(registrations.map(x=>x.id));
    for(const id of selectedRegistrationIds)if(!validRegistrationIds.has(id))selectedRegistrationIds.delete(id);
  }
  if(c.error){
    say("checkinLoadError",`No se pudo cargar el historial de acreditaciones: ${c.error.message}.`,true);
  }else{
    say("checkinLoadError",r.error?"No se pudo cargar el listado de inscritos; por eso la acreditación manual puede estar incompleta.":"");
    checkins=c.data||[];
  }
  if(r.error && volunteer){
    say("checkinLoadError",`No se pudieron cargar los inscritos para acreditar: ${r.error.message}.`,true);
  }
  activityOptions("registrationActivity");activityOptions("csvActivity");activityOptions("registrationFilter",true);activityOptions("ticketActivity");activityOptions("checkinActivity");activityOptions("mailActivity");
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
  document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  say("exportMessage",`Archivo ${fileName} generado con ${rows.length} registro(s).`);
}
function updateBulkSelectionUI(list=visibleRegistrations()){
  const ids=list.map(r=>r.id),selected=ids.filter(id=>selectedRegistrationIds.has(id)).length;
  $("selectionSummary").textContent=`${selectedRegistrationIds.size} seleccionados · ${list.length} visibles`;
  const downloadable=list.filter(reg=>selectedRegistrationIds.has(reg.id)&&reg.status!=="cancelled").length;
  const ticketButton=$("downloadSelectedTicketsBtn");
  ticketButton.disabled=downloadable===0;
  ticketButton.textContent=`Descargar entradas seleccionadas (${downloadable})`;
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
function ticketDataForRegistration(reg){
 const a=selectedActivity(reg.activity_id);if(!a)throw new Error("No se encontró la actividad de esta inscripción.");
 const start=ticketTime(a.start_time),end=ticketTime(a.end_time);
 return {
  attendeeName:reg.attendee?.full_name||"Participante",
  organization:reg.attendee?.organization||"",
  eventName:a.name||"Evento",
  eventDescription:a.tagline||a.description||"",
  date:ticketDateLabel(a.event_date),
  time:start?`${start}${end?"–"+end:""}`:"Por definir",
  place:a.place||"",
  row:reg.seat_row||"",
  seat:reg.seat_number||"",
  accessLabel:"ACCESO ÚNICO",
  website:"www.espaciomejor.org",
  logos:{institution:a.institution_logo||"",project:a.project_logo||"",partner:a.partner_logo||""}
 };
}
function ticketQrDataUrl(token){
 const qrHolder=document.createElement("div");qrHolder.style.cssText="position:absolute;left:-99999px;top:0";
 document.body.appendChild(qrHolder);
 new QRCode(qrHolder,{text:token||"ESPACIO-ACREDITA",width:320,height:320,colorDark:"#17151c",colorLight:"#ffffff",correctLevel:QRCode.CorrectLevel.M});
 const canvas=qrHolder.querySelector("canvas"),image=canvas?canvas.toDataURL("image/png"):"";
 qrHolder.remove();return image;
}
function ticketDocument(reg,design=ticketSettings){
 const a=selectedActivity(reg.activity_id);if(!a)throw new Error("No se encontró la actividad de esta inscripción.");
 const data=ticketDataForRegistration(reg);
 if(design.template==="custom"&&design.customDesign){
  return renderTicketDesign(design.customDesign,data,{print:true,qrSrc:ticketQrDataUrl(reg.qr_token)});
 }
 const format=design.template==="vertical"?"vertical":"classic";
 const markup=format==="vertical"?ticketMarkupVertical:ticketMarkup;
 const host=document.createElement("div");
 host.innerHTML=`<article class="ticket ${format==="vertical"?"ticket--vertical":""}">${markup}</article>`;
 const root=host.querySelector(".ticket");
 const colors=design.colors?.[format]||TICKET_DEFAULT_COLORS[format];
 root.style.setProperty("--ticket-background",safeTicketColor(colors.background,TICKET_DEFAULT_COLORS[format].background));
 root.style.setProperty("--ticket-accent",safeTicketColor(colors.accent,TICKET_DEFAULT_COLORS[format].accent));
 root.style.setProperty("--ticket-text",safeTicketColor(colors.text,TICKET_DEFAULT_COLORS[format].text));
 const set=(id,text)=>{const el=root.querySelector("#"+id);if(el)el.textContent=text||"";};
 set("previewPerson",data.attendeeName);set("previewOrg",data.organization);
 set("previewEventName",data.eventName);set("previewEventDesc",data.eventDescription);
 set("previewDate",data.date);set("previewTime",data.time);set("previewPlace",data.place);
 const seatLabels=root.querySelectorAll(".seat div");
 if(seatLabels[0])seatLabels[0].textContent="FILA: "+(data.row||"-");
 if(seatLabels[1])seatLabels[1].textContent="ASIENTO: "+(data.seat||"-");
 const imgs=[["logoPreview",a.institution_logo],["projectLogoPreview",a.project_logo],["partnerLogoPreview",a.partner_logo]];
 imgs.forEach(([id,src])=>{const img=root.querySelector("#"+id);if(src){img.src=src;img.hidden=false;img.style.display="block";}else if(img)img.remove();});
 const qr=root.querySelector("#qrPreview");qr.removeAttribute("src");qr.alt="Código QR";
 qr.src=ticketQrDataUrl(reg.qr_token);
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
  const custom=ticketSettings.template==="custom"&&ticketSettings.customDesign;
  const frame=document.createElement("div");frame.className="ticket-preview-frame"+(ticketSettings.template==="vertical"?" ticket-preview-vertical":"");
  if(custom){const d=normalizeTicketDesign(ticketSettings.customDesign);frame.style.aspectRatio=d.widthMm+"/"+d.heightMm;frame.style.width="min(100%,"+d.widthMm+"mm)";}
  frame.appendChild(ticketDocument(reg));preview.appendChild(frame);resizeTicketPreview();
 }catch(e){preview.textContent=e.message;}
}
function cloneTicketDesign(value){return JSON.parse(JSON.stringify(value));}
function selectedTicketEditorElement(){
 return ticketEditorDesign?.elements?.find(item=>item.id===ticketEditorSelectedId)||null;
}
function ticketEditorIsAdmin(){return currentProfile?.role==="admin";}
function refreshTicketTemplateOptions(){
 const select=$("ticketTemplate");if(!select)return;
 const current=ticketSettings.template==="custom"&&ticketSettings.customTemplateId?"custom:"+ticketSettings.customTemplateId:ticketSettings.template;
 select.innerHTML="";
 const builtins=[
  ["classic","Clásica horizontal · Liderazgo en 100 Palabras"],
  ["vertical","Moderna vertical · Genérica"]
 ];
 builtins.forEach(([value,label])=>{const option=document.createElement("option");option.value=value;option.textContent=label;select.appendChild(option);});
 if(ticketTemplates.length){
  const group=document.createElement("optgroup");group.label="Plantillas de su organización";
  ticketTemplates.forEach(template=>{const option=document.createElement("option");option.value="custom:"+template.id;option.textContent=template.name;group.appendChild(option);});
  select.appendChild(group);
 }
 if([...select.options].some(option=>option.value===current))select.value=current;
 else if(ticketSettings.template==="custom"){ticketSettings.template="classic";ticketSettings.customTemplateId=null;ticketSettings.customDesign=null;}
 updateTicketDesignControls();
}
async function loadTicketTemplates(){
 if(!currentProfile?.organization_id||!["admin","staff"].includes(currentProfile.role))return;
 const {data,error}=await supabase.from("ticket_templates")
  .select("id,name,design,updated_at").order("updated_at",{ascending:false});
 if(error){
  console.warn("No se pudieron cargar las plantillas de entradas:",error.message);
  say("ticketEditorMessage","No se pudieron cargar las plantillas guardadas. Compruebe que aplicó la migración ticket_templates en Supabase.",true);
  ticketTemplates=[];refreshTicketTemplateOptions();return;
 }
 ticketTemplates=data||[];
 if(ticketSettings.template==="custom"){
  const active=ticketTemplates.find(item=>item.id===ticketSettings.customTemplateId);
  if(active){ticketSettings.customDesign=normalizeTicketDesign(active.design);ticketSettings.customTemplateName=active.name;}
  else{ticketSettings.template="classic";ticketSettings.customTemplateId=null;ticketSettings.customDesign=null;ticketSettings.customTemplateName="";}
 }
 refreshTicketTemplateOptions();saveTicketSettings();renderTicketPreview();
}
function openTicketEditor(){
 const panel=$("ticketEditorPanel");panel.classList.remove("hidden");
 if(ticketSettings.template==="custom"&&ticketSettings.customDesign){
  ticketEditorDesign=normalizeTicketDesign(ticketSettings.customDesign);
  ticketEditorTemplateId=ticketSettings.customTemplateId||"";
  $("ticketEditorName").value=ticketSettings.customTemplateName||"";
 }else{
  ticketEditorDesign=createDefaultTicketDesign();
  ticketEditorTemplateId="";
  $("ticketEditorName").value="";
 }
 ticketEditorSelectedId="";
 $("ticketEditorNewBtn").classList.toggle("hidden",!ticketEditorIsAdmin());
 $("ticketEditorCopyBtn").classList.toggle("hidden",!ticketEditorIsAdmin()||!ticketEditorTemplateId);
 $("ticketEditorSaveBtn").classList.toggle("hidden",!ticketEditorIsAdmin());
 $("ticketEditorDeleteBtn").classList.toggle("hidden",!ticketEditorIsAdmin()||!ticketEditorTemplateId);
 const readOnly=!ticketEditorIsAdmin();
 document.querySelectorAll("#ticketEditorPanel input,#ticketEditorPanel select,#ticketEditorPanel textarea").forEach(control=>{control.disabled=readOnly;});
 document.querySelectorAll("#ticketEditorPanel button").forEach(button=>{button.disabled=readOnly&&button.id!=="ticketEditorCloseBtn";});
 $("ticketEditorStage").classList.toggle("ticket-editor-readonly",readOnly);
 renderTicketEditorControls();renderTicketEditorStage();renderTicketInspector();
 if(!ticketEditorIsAdmin())say("ticketEditorMessage","Vista de solo lectura. Solo el administrador puede crear, modificar o eliminar las plantillas de la organización.");
 else say("ticketEditorMessage",ticketEditorTemplateId?"Edite los elementos y guarde los cambios de esta plantilla.":"Diseñe una nueva plantilla y guárdela para reutilizarla.");
}
function closeTicketEditor(){$("ticketEditorPanel").classList.add("hidden");}
function newTicketEditorDesign(){
 if(!ticketEditorIsAdmin())return;
 ticketEditorDesign=createDefaultTicketDesign();ticketEditorTemplateId="";ticketEditorSelectedId="";
 $("ticketEditorName").value="";
 $("ticketEditorDeleteBtn").classList.add("hidden");
 renderTicketEditorControls();renderTicketEditorStage();renderTicketInspector();
 say("ticketEditorMessage","Nueva plantilla en blanco lista para editar. Puede añadir, mover, redimensionar y eliminar elementos.");
}
function copyTicketEditorTemplate(){
 if(!ticketEditorIsAdmin()||!ticketEditorDesign)return;
 const currentName=$("ticketEditorName").value.trim()||"Plantilla";
 ticketEditorTemplateId="";
 $("ticketEditorName").value=(currentName+" · copia").slice(0,80);
 $("ticketEditorDeleteBtn").classList.add("hidden");
 say("ticketEditorMessage","Está editando una copia independiente. Al guardar se creará una nueva plantilla y se conservará la original.");
}
function renderTicketEditorControls(){
 if(!ticketEditorDesign)return;
 const d=ticketEditorDesign;
 $("ticketCanvasWidth").value=d.widthMm;$("ticketCanvasHeight").value=d.heightMm;
 $("ticketBackgroundType").value=d.backgroundType;$("ticketPattern").value=d.pattern;
 $("ticketCanvasColor1").value=d.backgroundColor;$("ticketCanvasColor2").value=d.backgroundColor2;
 $("ticketGradientAngle").value=d.gradientAngle;$("ticketCornerStyle").value=d.cornerStyle;
 $("ticketCornerRadius").value=d.cornerRadiusMm;$("ticketBorderWidth").value=d.borderWidthMm;
 $("ticketBorderColor").value=d.borderColor;
 $("ticketBackgroundImageRemoveBtn").classList.toggle("hidden",!d.backgroundImage);
 $("ticketGradientColorLabel").classList.toggle("hidden",d.backgroundType!=="gradient");
 $("ticketGradientAngle").closest("label").classList.toggle("hidden",d.backgroundType!=="gradient");
}
function ticketEditorPreviewData(){
 const reg=selectedRegistration($("ticketRegistration").value);
 if(reg){try{return ticketDataForRegistration(reg);}catch{}}
 const activity=selectedActivity($("ticketActivity").value)||activities[0]||{};
 return {
  attendeeName:"Nombre del participante",organization:"Organización",
  eventName:activity.name||"Nombre del evento",eventDescription:activity.tagline||activity.description||"Descripción del evento",
  date:activity.event_date?ticketDateLabel(activity.event_date):"Fecha del evento",
  time:activity.start_time?ticketTime(activity.start_time):"Horario",
  place:activity.place||"Lugar",row:"A",seat:"12",accessLabel:"ACCESO ÚNICO",
  website:"www.espaciomejor.org",
  logos:{institution:activity.institution_logo||"",project:activity.project_logo||"",partner:activity.partner_logo||""}
 };
}
function scaleTicketEditorStage(){
 const stage=$("ticketEditorStage"),root=stage?.querySelector(".ticket-custom");if(!stage||!root||!ticketEditorDesign)return;
 const scale=stage.clientWidth/900;
 root.style.transform="scale("+scale+")";
}
function renderTicketEditorStage(){
 const stage=$("ticketEditorStage");if(!stage||!ticketEditorDesign)return;
 stage.innerHTML="";
 stage.style.aspectRatio=ticketEditorDesign.widthMm+"/"+ticketEditorDesign.heightMm;
 const data=ticketEditorPreviewData();
 const qrSrc=ticketQrDataUrl(selectedRegistration($("ticketRegistration").value)?.qr_token||"ESPACIO-ACREDITA");
 const root=renderTicketDesign(ticketEditorDesign,data,{editor:true,selectedId:ticketEditorSelectedId,qrSrc});
 root.style.position="absolute";root.style.left="0";root.style.top="0";root.style.transformOrigin="top left";
 stage.appendChild(root);scaleTicketEditorStage();
}
function setTicketInspectorValue(id,value){const el=$(id);if(el)el.value=value??"";}
function renderTicketInspector(){
 const element=selectedTicketEditorElement();
 $("ticketInspectorEmpty").classList.toggle("hidden",Boolean(element));
 $("ticketInspectorFields").classList.toggle("hidden",!element);
 if(!element)return;
 const e=element;
 setTicketInspectorValue("ticketPropX",e.x);setTicketInspectorValue("ticketPropY",e.y);
 setTicketInspectorValue("ticketPropW",e.w);setTicketInspectorValue("ticketPropH",e.h);
 const isText=e.type==="text",isField=e.type==="field";
 $("ticketTextProps").classList.toggle("hidden",!isText&&!isField);
 $("ticketPropTextLabel").classList.toggle("hidden",!isText);
 $("ticketPropText").value=isText?e.text:"";
 $("ticketPropFontSize").value=e.fontSize||24;$("ticketPropFontFamily").value=e.fontFamily||"Arial";
 $("ticketPropFontWeight").value=e.fontWeight||"400";$("ticketPropColor").value=e.color||"#ffffff";
 $("ticketPropAlign").value=e.align||"left";$("ticketPropVAlign").value=e.valign||"middle";
 if(isField){
  const label=ticketFieldLabels[e.field]||"Dato automático";
  $("ticketInspectorEmpty").classList.add("hidden");
  $("ticketPropText").value=label;$("ticketPropText").disabled=true;
  $("ticketPropTextLabel").classList.remove("hidden");$("ticketPropTextLabel").firstChild.textContent="Campo automático";
 }else{
  $("ticketPropText").disabled=false;$("ticketPropTextLabel").firstChild.textContent="Texto libre";
 }
 const isLogo=e.type==="logo",isShape=e.type==="shape",isQr=e.type==="qr";
 $("ticketLogoProps").classList.toggle("hidden",!isLogo);
 $("ticketShapeProps").classList.toggle("hidden",!isShape);
 $("ticketQrProps").classList.toggle("hidden",!isQr);
 if(isLogo){
  $("ticketPropLogoSource").value=e.source||"institution";
  $("ticketPropLogoFit").value=e.fit||"contain";
  $("ticketCustomLogoUploadLabel").classList.toggle("hidden",e.source!=="custom");
 }
 if(isShape){
  $("ticketPropShape").value=e.shape||"rect";$("ticketPropFill").value=e.fill||"#83b6d0";
  $("ticketPropStroke").value=e.stroke||"#ffffff";$("ticketPropStrokeWidth").value=e.strokeWidth||0;
  $("ticketPropRadius").value=e.radius||0;
 }
 if(isQr){
  $("ticketPropQrBackground").value=e.backgroundColor||"#ffffff";
  $("ticketPropQrBorder").value=e.borderColor||"#ffffff";
  $("ticketPropQrBorderWidth").value=e.borderWidth??1;$("ticketPropQrRadius").value=e.radius??3;
 }
}
function updateTicketEditorGlobal(){
 if(!ticketEditorDesign||!ticketEditorIsAdmin())return;
 const d=ticketEditorDesign;
 d.widthMm=Number($("ticketCanvasWidth").value)||d.widthMm;
 d.heightMm=Number($("ticketCanvasHeight").value)||d.heightMm;
 d.backgroundType=$("ticketBackgroundType").value;
 d.pattern=$("ticketPattern").value;
 d.backgroundColor=$("ticketCanvasColor1").value;
 d.backgroundColor2=$("ticketCanvasColor2").value;
 d.gradientAngle=Number($("ticketGradientAngle").value)||0;
 d.cornerStyle=$("ticketCornerStyle").value;
 d.cornerRadiusMm=Number($("ticketCornerRadius").value)||0;
 d.borderWidthMm=Number($("ticketBorderWidth").value)||0;
 d.borderColor=$("ticketBorderColor").value;
 ticketEditorDesign=normalizeTicketDesign(d);
 renderTicketEditorControls();renderTicketEditorStage();
}
function updateTicketEditorElement(){
 if(!ticketEditorDesign||!ticketEditorIsAdmin())return;
 const e=selectedTicketEditorElement();if(!e)return;
 e.x=Number($("ticketPropX").value);e.y=Number($("ticketPropY").value);
 e.w=Number($("ticketPropW").value);e.h=Number($("ticketPropH").value);
 if(e.type==="text"||e.type==="field"){
  e.fontSize=Number($("ticketPropFontSize").value);
  e.fontFamily=$("ticketPropFontFamily").value;e.fontWeight=$("ticketPropFontWeight").value;
  e.color=$("ticketPropColor").value;e.align=$("ticketPropAlign").value;e.valign=$("ticketPropVAlign").value;
  if(e.type==="text")e.text=$("ticketPropText").value;
 }
 if(e.type==="logo"){e.source=$("ticketPropLogoSource").value;e.fit=$("ticketPropLogoFit").value;}
 if(e.type==="shape"){
  e.shape=$("ticketPropShape").value;e.fill=$("ticketPropFill").value;e.stroke=$("ticketPropStroke").value;
  e.strokeWidth=Number($("ticketPropStrokeWidth").value);e.radius=Number($("ticketPropRadius").value);
 }
 if(e.type==="qr"){
  e.backgroundColor=$("ticketPropQrBackground").value;e.borderColor=$("ticketPropQrBorder").value;
  e.borderWidth=Number($("ticketPropQrBorderWidth").value);e.radius=Number($("ticketPropQrRadius").value);
 }
 ticketEditorDesign=normalizeTicketDesign(ticketEditorDesign);
 renderTicketEditorStage();renderTicketInspector();
}
function addTicketEditorElement(){
 if(!ticketEditorIsAdmin()||!ticketEditorDesign)return;
 if(ticketEditorDesign.elements.length>=32){say("ticketEditorMessage","La plantilla admite un máximo de 32 elementos.",true);return;}
 const value=$("ticketAddElement").value.split(":");
 const kind=value[0],subtype=value[1]||"";
 const logos=ticketEditorDesign.elements.filter(item=>item.type==="logo").length;
 if(kind==="logo"&&logos>=8){say("ticketEditorMessage","La plantilla admite un máximo de 8 logotipos.",true);return;}
 const base={id:crypto.randomUUID(),x:10,y:18,w:35,h:10,z:Math.max(0,...ticketEditorDesign.elements.map(item=>Number(item.z)||0))+1};
 let item;
 if(kind==="field")item={...base,type:"field",field:subtype,fontSize:24,fontFamily:"Arial",fontWeight:"700",color:"#ffffff",align:"left",valign:"middle"};
 else if(kind==="text")item={...base,type:"text",text:"Escriba su texto",fontSize:24,fontFamily:"Arial",fontWeight:"600",color:"#ffffff",align:"left",valign:"middle"};
 else if(kind==="logo")item={...base,type:"logo",source:subtype,fit:"contain",w:14,h:18,backgroundColor:"#ffffff"};
 else if(kind==="qr")item={...base,type:"qr",w:18,h:28,backgroundColor:"#ffffff",borderColor:"#ffffff",borderWidth:1,radius:2};
 else item={...base,type:"shape",shape:subtype||"rect",w:20,h:12,fill:"#83b6d0",stroke:"#ffffff",strokeWidth:0,radius:2};
 ticketEditorDesign.elements.push(item);ticketEditorSelectedId=item.id;
 renderTicketEditorStage();renderTicketInspector();
 say("ticketEditorMessage","Elemento añadido al lienzo. Puede moverlo y ajustar su tamaño.");
}
function duplicateTicketEditorElement(){
 const source=selectedTicketEditorElement();if(!source||!ticketEditorIsAdmin())return;
 if(ticketEditorDesign.elements.length>=32){say("ticketEditorMessage","La plantilla admite un máximo de 32 elementos.",true);return;}
 if(source.type==="logo"&&ticketEditorDesign.elements.filter(item=>item.type==="logo").length>=8){say("ticketEditorMessage","La plantilla admite un máximo de 8 logotipos.",true);return;}
 const copy={...cloneTicketDesign(source),id:crypto.randomUUID(),x:Math.min(100-source.w,source.x+3),y:Math.min(100-source.h,source.y+3),z:Math.max(...ticketEditorDesign.elements.map(item=>Number(item.z)||0))+1};
 ticketEditorDesign.elements.push(copy);ticketEditorSelectedId=copy.id;
 renderTicketEditorStage();renderTicketInspector();
}
function deleteTicketEditorElement(){
 if(!selectedTicketEditorElement()||!ticketEditorIsAdmin())return;
 ticketEditorDesign.elements=ticketEditorDesign.elements.filter(item=>item.id!==ticketEditorSelectedId);
 ticketEditorSelectedId="";renderTicketEditorStage();renderTicketInspector();
}
function ticketEditorPointerDown(ev){
 if(!ticketEditorIsAdmin()||!ticketEditorDesign)return;
 const stage=$("ticketEditorStage"),node=ev.target.closest("[data-design-id]");
 if(!node){ticketEditorSelectedId="";ticketEditorDrag=null;renderTicketEditorStage();renderTicketInspector();return;}
 const id=node.dataset.designId,e=ticketEditorDesign.elements.find(item=>item.id===id);if(!e)return;
 ticketEditorSelectedId=id;
 const rect=stage.getBoundingClientRect();
 ticketEditorDrag={id,startX:ev.clientX,startY:ev.clientY,rectWidth:rect.width,rectHeight:rect.height,
  x:e.x,y:e.y,w:e.w,h:e.h,resize:Boolean(ev.target.closest(".ticket-design-resize"))};
 stage.setPointerCapture?.(ev.pointerId);
 stage.querySelectorAll(".ticket-design-item.selected").forEach(item=>item.classList.remove("selected"));
 node.classList.add("selected");
 if(!node.querySelector(".ticket-design-resize")){
  const handle=document.createElement("span");handle.className="ticket-design-resize";handle.setAttribute("aria-hidden","true");node.appendChild(handle);
 }
 renderTicketInspector();ev.preventDefault();
}
function ticketEditorPointerMove(ev){
 if(!ticketEditorDrag||!ticketEditorIsAdmin())return;
 const drag=ticketEditorDrag,e=ticketEditorDesign.elements.find(item=>item.id===drag.id);if(!e)return;
 const dx=(ev.clientX-drag.startX)/Math.max(1,drag.rectWidth)*100;
 const dy=(ev.clientY-drag.startY)/Math.max(1,drag.rectHeight)*100;
 if(drag.resize){
  e.w=Math.min(100-drag.x,Math.max(1,drag.w+dx));
  e.h=Math.min(100-drag.y,Math.max(1,drag.h+dy));
 }else{
  e.x=Math.min(100-e.w,Math.max(0,drag.x+dx));
  e.y=Math.min(100-e.h,Math.max(0,drag.y+dy));
 }
 const node=$("ticketEditorStage").querySelector('[data-design-id="'+drag.id+'"]');
 if(node){node.style.left=e.x+"%";node.style.top=e.y+"%";node.style.width=e.w+"%";node.style.height=e.h+"%";}
}
function ticketEditorPointerUp(){
 if(!ticketEditorDrag)return;
 ticketEditorDrag=null;ticketEditorDesign=normalizeTicketDesign(ticketEditorDesign);
 renderTicketEditorStage();renderTicketInspector();
}
async function saveTicketEditorTemplate(){
 if(!ticketEditorIsAdmin()||!ticketEditorDesign){say("ticketEditorMessage","Solo el administrador puede guardar plantillas.",true);return;}
 const name=$("ticketEditorName").value.trim();
 if(name.length<2||name.length>80){say("ticketEditorMessage","El nombre de la plantilla debe tener entre 2 y 80 caracteres.",true);return;}
 const design=normalizeTicketDesign(ticketEditorDesign);
 const button=$("ticketEditorSaveBtn");button.disabled=true;button.textContent="Guardando…";
 try{
  let result;
  if(ticketEditorTemplateId){
   const response=await supabase.from("ticket_templates").update({name,design,updated_at:new Date().toISOString()})
    .eq("id",ticketEditorTemplateId).eq("organization_id",currentProfile.organization_id)
    .select("id,name,design,updated_at").single();
   if(response.error)throw response.error;result=response.data;
  }else{
   const response=await supabase.from("ticket_templates").insert({
    organization_id:currentProfile.organization_id,name,design,created_by:currentUser.id
   }).select("id,name,design,updated_at").single();
   if(response.error)throw response.error;result=response.data;
  }
  ticketEditorTemplateId=result.id;
  ticketSettings.template="custom";ticketSettings.customTemplateId=result.id;
  ticketSettings.customDesign=normalizeTicketDesign(result.design);ticketSettings.customTemplateName=result.name;
  ticketEditorDesign=normalizeTicketDesign(result.design);
  await loadTicketTemplates();
  ticketSettings.template="custom";ticketSettings.customTemplateId=result.id;
  ticketSettings.customDesign=normalizeTicketDesign(result.design);ticketSettings.customTemplateName=result.name;
  saveTicketSettings();updateTicketDesignControls();renderTicketPreview();
  $("ticketEditorDeleteBtn").classList.remove("hidden");
  say("ticketEditorMessage","Plantilla «"+result.name+"» guardada y disponible para su organización.");
 }catch(error){
  console.error("Error al guardar plantilla:",error);
  say("ticketEditorMessage",error.message||"No se pudo guardar la plantilla. Revise los permisos y la migración de Supabase.",true);
 }finally{button.disabled=false;button.textContent="Guardar plantilla";}
}
async function deleteTicketEditorTemplate(){
 if(!ticketEditorIsAdmin()||!ticketEditorTemplateId)return;
 const name=$("ticketEditorName").value.trim()||"esta plantilla";
 if(!confirm("¿Eliminar la plantilla «"+name+"»? Esta acción no se puede deshacer."))return;
 const {error}=await supabase.from("ticket_templates").delete().eq("id",ticketEditorTemplateId)
  .eq("organization_id",currentProfile.organization_id);
 if(error){say("ticketEditorMessage",error.message,true);return;}
 ticketTemplates=ticketTemplates.filter(item=>item.id!==ticketEditorTemplateId);
 ticketEditorTemplateId="";ticketEditorDesign=createDefaultTicketDesign();ticketEditorSelectedId="";
 ticketSettings.template="classic";ticketSettings.customTemplateId=null;ticketSettings.customDesign=null;ticketSettings.customTemplateName="";
 saveTicketSettings();refreshTicketTemplateOptions();renderTicketPreview();
 $("ticketEditorName").value="";$("ticketEditorDeleteBtn").classList.add("hidden");
 renderTicketEditorControls();renderTicketEditorStage();renderTicketInspector();
 say("ticketEditorMessage","Plantilla eliminada.");
}
function handleTicketBackgroundUpload(ev){
 const file=ev.target.files?.[0];if(!file||!ticketEditorDesign)return;
 if(!["image/png","image/jpeg","image/webp"].includes(file.type)){say("ticketEditorMessage","Use una imagen PNG, JPG o WebP.",true);ev.target.value="";return;}
 if(file.size>700*1024){say("ticketEditorMessage","La imagen de fondo debe pesar como máximo 700 KB. Optimícela antes de cargarla.",true);ev.target.value="";return;}
 const reader=new FileReader();
 reader.onload=()=>{
  ticketEditorDesign.backgroundImage=String(reader.result||"");
  ticketEditorDesign=normalizeTicketDesign(ticketEditorDesign);
  renderTicketEditorControls();renderTicketEditorStage();
  say("ticketEditorMessage","Imagen de fondo incorporada. Puede combinarla con patrones y elementos gráficos.");
 };
 reader.onerror=()=>say("ticketEditorMessage","No se pudo leer la imagen de fondo.",true);
 reader.readAsDataURL(file);ev.target.value="";
}
function removeTicketBackgroundImage(){
 if(!ticketEditorDesign||!ticketEditorIsAdmin())return;
 ticketEditorDesign.backgroundImage="";
 renderTicketEditorControls();renderTicketEditorStage();
 say("ticketEditorMessage","Imagen de fondo eliminada. Se mostrará el color o degradado configurado.");
}
function handleTicketEditorLogoUpload(ev){
 const file=ev.target.files?.[0],element=selectedTicketEditorElement();if(!file||!element||element.type!=="logo")return;
 if(!["image/png","image/jpeg","image/webp"].includes(file.type)){say("ticketEditorMessage","Use una imagen PNG, JPG o WebP.",true);ev.target.value="";return;}
 if(file.size>300*1024){say("ticketEditorMessage","El logo debe pesar como máximo 300 KB. Optimice la imagen antes de cargarla.",true);ev.target.value="";return;}
 const reader=new FileReader();
 reader.onload=()=>{
  element.source="custom";element.src=String(reader.result||"");ticketEditorDesign=normalizeTicketDesign(ticketEditorDesign);
  $("ticketPropLogoSource").value="custom";renderTicketEditorStage();renderTicketInspector();
  say("ticketEditorMessage","Logo incorporado a la plantilla. Se guardará junto con el diseño.");
 };
 reader.onerror=()=>say("ticketEditorMessage","No se pudo leer la imagen seleccionada.",true);
 reader.readAsDataURL(file);ev.target.value="";
}
function bindTicketEditorEvents(){
 $("ticketOpenEditorBtn").addEventListener("click",openTicketEditor);
 $("ticketEditorCloseBtn").addEventListener("click",closeTicketEditor);
 $("ticketEditorNewBtn").addEventListener("click",newTicketEditorDesign);
 $("ticketEditorCopyBtn").addEventListener("click",copyTicketEditorTemplate);
 $("ticketEditorSaveBtn").addEventListener("click",saveTicketEditorTemplate);
 $("ticketEditorDeleteBtn").addEventListener("click",deleteTicketEditorTemplate);
 $("ticketAddElementBtn").addEventListener("click",addTicketEditorElement);
 $("ticketDuplicateElementBtn").addEventListener("click",duplicateTicketEditorElement);
 $("ticketDeleteElementBtn").addEventListener("click",deleteTicketEditorElement);
 $("ticketCustomLogoUpload").addEventListener("change",handleTicketEditorLogoUpload);
 $("ticketBackgroundImageUpload").addEventListener("change",handleTicketBackgroundUpload);
 $("ticketBackgroundImageRemoveBtn").addEventListener("click",removeTicketBackgroundImage);
 const globalLiveIds=["ticketBackgroundType","ticketPattern","ticketCanvasColor1","ticketCanvasColor2","ticketCornerStyle","ticketBorderColor"];
 globalLiveIds.forEach(id=>{$(id).addEventListener("input",updateTicketEditorGlobal);$(id).addEventListener("change",updateTicketEditorGlobal);});
 const globalNumberIds=["ticketCanvasWidth","ticketCanvasHeight","ticketGradientAngle","ticketCornerRadius","ticketBorderWidth"];
 globalNumberIds.forEach(id=>$(id).addEventListener("change",updateTicketEditorGlobal));
 const propertyLiveIds=["ticketPropText","ticketPropFontFamily","ticketPropFontWeight","ticketPropColor","ticketPropAlign","ticketPropVAlign","ticketPropLogoSource","ticketPropLogoFit","ticketPropShape","ticketPropFill","ticketPropStroke","ticketPropRadius","ticketPropQrBackground","ticketPropQrBorder","ticketPropQrRadius"];
 propertyLiveIds.forEach(id=>{$(id).addEventListener("input",updateTicketEditorElement);$(id).addEventListener("change",updateTicketEditorElement);});
 const propertyNumberIds=["ticketPropX","ticketPropY","ticketPropW","ticketPropH","ticketPropFontSize","ticketPropStrokeWidth","ticketPropQrBorderWidth"];
 propertyNumberIds.forEach(id=>$(id).addEventListener("change",updateTicketEditorElement));
 $("ticketEditorStage").addEventListener("pointerdown",ticketEditorPointerDown);
 $("ticketEditorStage").addEventListener("pointermove",ticketEditorPointerMove);
 $("ticketEditorStage").addEventListener("pointerup",ticketEditorPointerUp);
 $("ticketEditorStage").addEventListener("pointercancel",ticketEditorPointerUp);
 window.addEventListener("resize",scaleTicketEditorStage);
}

new ResizeObserver(resizeTicketPreview).observe($("ticketPreview"));
function pdfWorker(root,scale=2){
 const custom=root.dataset.ticketCustom==="true";
 const vertical=root.classList.contains("ticket--vertical");
 const pageWidth=custom?Number(root.dataset.pageWidthMm)+6:(vertical?96:303);
 const pageHeight=custom?Number(root.dataset.pageHeightMm)+6:(vertical?156:104.08);
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
  jsPDF:{unit:"mm",format:[pageWidth,pageHeight],orientation:pageWidth>=pageHeight?"landscape":"portrait"}
 }).from(root);
}
async function waitForTicketImages(root){
 const images=[...root.querySelectorAll("img")].filter(image=>image.getAttribute("src"));
 await Promise.all(images.map(image=>image.decode()));
}
async function downloadPdf(reg,design=ticketSettings){
 const root=ticketDocument(reg,design),stage=$("pdfStage");
 stage.innerHTML="";stage.appendChild(root);
 try{
  await waitForTicketImages(root);
  const name=(reg.attendee.full_name||"entrada").normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-zA-Z0-9_-]+/g,"-").slice(0,45);
  await pdfWorker(root).set({filename:`entrada-${name}.pdf`}).save();
 }finally{stage.innerHTML="";}
}
async function downloadOne(){
 const reg=selectedRegistration($("ticketRegistration").value);
 if(!reg){say("ticketMessage","Selecciona una inscripción.",true);return;}
 try{await downloadPdf(reg,ticketSettings);say("ticketMessage","PDF generado con el diseño seleccionado.");}
 catch(error){say("ticketMessage",error.message,true);}
}
async function downloadTicketZip(list,downloadName,button){
 const valid=list.filter(reg=>reg&&reg.status!=="cancelled");
 if(!valid.length){say("ticketMessage","No hay inscritos vigentes para generar las entradas.",true);return;}
 const originalText=button.textContent;button.disabled=true;button.textContent="Generando ZIP…";
 const design=JSON.parse(JSON.stringify(ticketSettings));
 try{
  const zip=new JSZip(),stage=$("pdfStage");
  for(let i=0;i<valid.length;i++){
   const reg=valid[i],root=ticketDocument(reg,design);
   stage.innerHTML="";stage.appendChild(root);
   await waitForTicketImages(root);
   const pdf=await pdfWorker(root,1.6).toPdf().get("pdf");
   const safe=(reg.attendee.full_name||"entrada").normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-zA-Z0-9_-]+/g,"-").slice(0,45);
   zip.file(`${String(i+1).padStart(3,"0")}-${safe}.pdf`,pdf.output("blob"));
   $("ticketMessage").textContent=`Generando entradas: ${i+1}/${valid.length}…`;
  }
  stage.innerHTML="";
  const blob=await zip.generateAsync({type:"blob"});
  const url=URL.createObjectURL(blob),link=document.createElement("a");
  link.href=url;link.download=`espacio-acredita-${downloadName}.zip`;
  document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  say("ticketMessage",`ZIP generado con ${valid.length} entradas en formato ${design.template==="vertical"?"vertical":"horizontal"}.`);
 }catch(error){
  $("pdfStage").innerHTML="";say("ticketMessage",error?.message||"No se pudo generar el ZIP.",true);
 }finally{button.disabled=false;button.textContent=originalText;}
}
async function downloadZip(){
 const aid=val("ticketActivity");
 const list=registrations.filter(reg=>reg.activity_id===aid&&reg.status!=="cancelled");
 await downloadTicketZip(list,"actividad",$("downloadZipBtn"));
}
async function downloadSelectedTicketsZip(){
 const list=[...selectedRegistrationIds].map(selectedRegistration).filter(reg=>reg&&reg.status!=="cancelled");
 await downloadTicketZip(list,"seleccionadas",$("downloadSelectedTicketsBtn"));
}

function setMailConnectionStatus(state,message){
 const type=state==="connected"?"connected":state==="connecting"?"connecting":"disconnected";
 mailConnected=state==="connected";
 document.querySelectorAll(".mail-status-dot").forEach(dot=>{dot.className="mail-status-dot "+type;dot.title=message;});
 document.querySelectorAll(".mail-status-text").forEach(node=>{node.textContent=message;});
 const button=$("mailSendBtn");
 if(button)button.disabled=mailSending||!mailConnected||!mailEligibleRecipients().length;
}
async function callMailManager(action,payload={}){
 const response=await supabase.functions.invoke("mail-manager",{body:{action,...payload}});
 if(response.error){
  let message=response.error.message||"No fue posible comunicarse con el servicio de correo.";
  try{const ctx=response.error.context;const details=ctx?.clone?await ctx.clone().json():null;if(details?.error)message=details.error;}catch{}
  throw new Error(message);
 }
 if(response.data?.error)throw new Error(response.data.error);
 return response.data||{};
}
function mailSettingsPayload(){
 return {settings:{host:val("mailSmtpHost"),port:Number(val("mailSmtpPort")),security:val("mailSmtpSecurity"),username:val("mailSmtpUsername"),senderEmail:val("mailSenderEmail"),senderName:val("mailSenderName")},password:$("mailSmtpPassword").value};
}
async function refreshMailConnection(meta=mailSettingsMeta){
 if(!navigator.onLine){setMailConnectionStatus("disconnected","Sin conexión a internet");return false;}
 setMailConnectionStatus("connecting","Comprobando conexión SMTP…");
 try{
  const settings=meta||(await callMailManager("get_settings")).settings;mailSettingsMeta=settings;
  if(!settings?.configured||!settings?.hasPassword){setMailConnectionStatus("disconnected","SMTP no configurado");return false;}
  await callMailManager("test_connection");
  setMailConnectionStatus("connected","Conectado y listo para enviar");return true;
 }catch(error){setMailConnectionStatus("disconnected",error.message||"No se pudo conectar al servidor SMTP");return false;}
}
async function loadMailSettings(){
 if(currentProfile?.role!=="admin")return;
 try{
  const result=await callMailManager("get_settings"),settings=result.settings;mailSettingsMeta=settings;
  $("mailSmtpHost").value=settings.host||"";$("mailSmtpPort").value=settings.port||2587;
  $("mailSmtpSecurity").value=settings.security||"starttls";$("mailSmtpUsername").value=settings.username||"";
  $("mailSenderEmail").value=settings.senderEmail||"";$("mailSenderName").value=settings.senderName||"Espacio Acredita";
  $("mailSmtpPassword").value="";$("mailSmtpPassword").placeholder=settings.hasPassword?"Configurada; deje vacío para conservarla":"Ingrese la contraseña SMTP";
  await refreshMailConnection(settings);
 }catch(error){setMailConnectionStatus("disconnected","No se pudo consultar la configuración SMTP");say("mailSettingsMessage",error.message,true);}
}
async function testMailConnection(){
 if(!navigator.onLine){setMailConnectionStatus("disconnected","Sin conexión a internet");return;}
 setMailConnectionStatus("connecting","Probando credenciales SMTP…");
 try{await callMailManager("test_connection",mailSettingsPayload());setMailConnectionStatus("connected","Conexión SMTP verificada");say("mailSettingsMessage","Conexión y autenticación SMTP correctas.");}
 catch(error){setMailConnectionStatus("disconnected",error.message);say("mailSettingsMessage",error.message,true);}
}
async function saveMailSettings(ev){
 ev.preventDefault();const payload=mailSettingsPayload(),button=$("mailSaveSettingsBtn");
 button.disabled=true;button.textContent="Guardando…";say("mailSettingsMessage","Guardando configuración SMTP de forma cifrada…");
 try{
  const result=await callMailManager("save_settings",payload);mailSettingsMeta=result.settings;
  $("mailSmtpPassword").value="";$("mailSmtpPassword").placeholder="Configurada; deje vacío para conservarla";
  say("mailSettingsMessage","Configuración guardada. Comprobando conexión…");
  await refreshMailConnection(result.settings);
  if(mailConnected)say("mailSettingsMessage","Configuración guardada y conexión verificada.");
 }catch(error){setMailConnectionStatus("disconnected",error.message);say("mailSettingsMessage",error.message,true);}
 finally{button.disabled=false;button.textContent="Guardar configuración SMTP";}
}
function mailActivityRecipients(){
 const activityId=val("mailActivity");
 return registrations.filter(reg=>reg.activity_id===activityId&&reg.status!=="cancelled");
}
function mailEligibleRecipients(){
 if(!mailLogsReady||mailLogsActivityId!==val("mailActivity"))return [];
 const resend=$("mailResendSent")?.checked===true;
 return mailActivityRecipients().filter(reg=>{
  const email=String(reg.attendee?.email||"").trim();
  const valid=/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const previousStatus=mailLogsByRegistration.get(reg.id)?.status;
  const wasAlreadySent=previousStatus==="sent"||previousStatus==="sending";
  return valid&&(resend||!wasAlreadySent);
 });
}
function renderMailRecipients(){
 const activityId=val("mailActivity"),all=mailActivityRecipients();
 const valid=all.filter(reg=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(reg.attendee?.email||"").trim()));
 const sent=valid.filter(reg=>mailLogsByRegistration.get(reg.id)?.status==="sent").length;
 const eligible=mailEligibleRecipients(),missing=all.length-valid.length;
 $("mailRecipientSummary").textContent=eligible.length+" por enviar · "+sent+" ya enviadas · "+missing+" sin correo válido · "+all.length+" inscritos vigentes";
 if(!activityId)$("mailRecipientsTable").innerHTML='<p class="muted">Seleccione una actividad para revisar los destinatarios.</p>';
 else if(!all.length)$("mailRecipientsTable").innerHTML='<p class="muted">Esta actividad no tiene inscritos vigentes.</p>';
 else{
  const rows=all.slice(0,100).map(reg=>{
   const log=mailLogsByRegistration.get(reg.id),email=String(reg.attendee?.email||"").trim();
   const validEmail=/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
   const state=!validEmail?"Sin correo válido":log?.status==="sent"?"Enviada anteriormente":log?.status==="sending"?"Envío en proceso / resultado no confirmado":log?.status==="failed"?"Último intento fallido":"Lista para enviar";
   return "<tr><td>"+escapeHtml(reg.attendee?.full_name||"Sin nombre")+"</td><td>"+escapeHtml(email||"—")+"</td><td>"+escapeHtml(state)+"</td></tr>";
  }).join("");
  $("mailRecipientsTable").innerHTML='<table><thead><tr><th>Participante</th><th>Correo individual</th><th>Estado</th></tr></thead><tbody>'+rows+'</tbody></table>'+(all.length>100?'<p class="muted">Se muestran los primeros 100 inscritos. El envío considera todos los destinatarios válidos.</p>':"");
 }
 const button=$("mailSendBtn");button.disabled=mailSending||!mailConnected||eligible.length===0;
 button.textContent="Enviar entradas individuales ("+eligible.length+")";
}
async function loadMailDeliveryLogs(){
 if(currentProfile?.role!=="admin")return;
 const activityId=val("mailActivity");mailLogsByRegistration=new Map();mailLogsReady=false;mailLogsActivityId=activityId;
 if(!activityId){mailLogsReady=true;renderMailRecipients();return;}
 try{
  const result=await callMailManager("list_activity_logs",{activity_id:activityId});
  for(const log of result.logs||[])if(!mailLogsByRegistration.has(log.registration_id))mailLogsByRegistration.set(log.registration_id,log);
  mailLogsReady=true;
 }catch(error){say("mailProgressMessage",error.message,true);mailLogsReady=false;}
 renderMailRecipients();
}
async function ticketPdfBlob(reg){
 const root=ticketDocument(reg,ticketSettings),stage=$("pdfStage");stage.innerHTML="";stage.appendChild(root);
 try{await waitForTicketImages(root);const pdf=await pdfWorker(root,1.6).toPdf().get("pdf");return pdf.output("blob");}
 finally{stage.innerHTML="";}
}
async function blobToBase64(blob){
 const bytes=new Uint8Array(await blob.arrayBuffer());let binary="";
 for(let i=0;i<bytes.length;i+=0x8000)binary+=String.fromCharCode(...bytes.subarray(i,i+0x8000));
 return btoa(binary);
}
async function sendMailEntries(){
 if(currentProfile?.role!=="admin")return;
 if(!mailConnected){say("mailProgressMessage","Primero configure y verifique la conexión SMTP.",true);return;}
 const activity=selectedActivity(val("mailActivity")),subject=val("mailSubject"),body=val("mailBody"),recipients=mailEligibleRecipients();
 if(!activity){say("mailProgressMessage","Seleccione una actividad.",true);return;}
 if(!subject||!body){say("mailProgressMessage","Complete el asunto y el texto descriptivo.",true);return;}
 if(!recipients.length){say("mailProgressMessage","No hay destinatarios válidos pendientes de envío.",true);return;}
 if(!confirm("Se enviarán "+recipients.length+" correos individuales para «"+activity.name+"». Cada persona recibirá únicamente su propia entrada PDF. ¿Desea continuar?"))return;
 const button=$("mailSendBtn");mailSending=true;button.disabled=true;button.textContent="Enviando…";
 let sent=0,failed=0;const failures=[];
 try{
  for(let index=0;index<recipients.length;index++){
   if(!navigator.onLine){setMailConnectionStatus("disconnected","Sin conexión a internet");failures.push("Se perdió la conexión a internet; el envío se detuvo.");break;}
   const reg=recipients[index];
   $("mailProgressMessage").textContent="Preparando entrada y enviando "+(index+1)+" de "+recipients.length+": "+reg.attendee.full_name+"…";
   try{
    const pdfBlob=await ticketPdfBlob(reg);
    if(pdfBlob.size>3*1024*1024)throw new Error("La entrada PDF supera 3 MB.");
    const attachment=await blobToBase64(pdfBlob);
    await callMailManager("send_one",{registration_id:reg.id,subject:subject,body:body,attachment_base64:attachment,allow_resend:$("mailResendSent").checked});
    sent++;mailLogsByRegistration.set(reg.id,{registration_id:reg.id,status:"sent",recipient_email:reg.attendee.email});
   }catch(error){
    failed++;failures.push((reg.attendee?.full_name||"Participante")+": "+error.message);
    if(/connection|connect|timeout|socket|enotfound|econn|tls|authentication|network|fetch/i.test(error.message)){
     setMailConnectionStatus("disconnected","Conexión SMTP interrumpida durante el envío");
     failures.push("El servicio de correo se marcó como desconectado y el envío se detuvo.");
     break;
    }
   }
   $("mailProgressMessage").textContent="Envío en curso: "+(index+1)+"/"+recipients.length+" · "+sent+" enviados · "+failed+" fallidos";
  }
 }finally{
  mailSending=false;renderMailRecipients();button.disabled=!mailConnected||!mailEligibleRecipients().length;
 }
 await loadMailDeliveryLogs();
 const notAttempted=Math.max(0,recipients.length-sent-failed);
 say("mailProgressMessage","Proceso finalizado: "+sent+" aceptados por SMTP · "+failed+" fallidos · "+notAttempted+" no procesados.",failed>0||notAttempted>0);
 $("mailResults").innerHTML=failures.length
  ?"<strong>Detalles para revisar</strong><ul>"+failures.slice(0,20).map(item=>"<li>"+escapeHtml(item)+"</li>").join("")+"</ul>"
  :"El servidor SMTP aceptó todos los mensajes para su procesamiento. La entrega final depende del proveedor y del servidor de correo del destinatario.";
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
 else if(name==="mail"&&currentProfile?.role!=="admin")name="dashboard";
 document.querySelectorAll(".tab-panel").forEach(x=>x.classList.add("hidden"));
 $("tab-"+name)?.classList.remove("hidden");
 document.querySelectorAll("[data-tab]").forEach(x=>x.classList.toggle("active",x.dataset.tab===name));
 if(name==="tickets")resizeTicketPreview();
 if(name==="mail"){void loadMailDeliveryLogs();void refreshMailConnection();}
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
 currentProfile=data;ticketSettings=loadTicketSettings();updateTicketDesignControls();setSignedIn(true);
 if(isSuperadmin){await initSuperadmin(supabase,currentUser);switchTab("superadmin");return;}
 await loadAll();await loadTicketTemplates();if(currentProfile.role==="admin")void loadMailSettings();switchTab(currentProfile.role==="volunteer"?"checkin":"dashboard");
}
$("downloadCsvTemplateBtn").addEventListener("click",downloadCsvTemplate);$("createUserForm").addEventListener("submit",createManagedUser);$("activityForm").addEventListener("submit",saveActivity);$("clearActivity").addEventListener("click",clearActivityForm);$("registrationForm").addEventListener("submit",saveRegistration);$("importCsvBtn").addEventListener("click",importCsv);
bindTicketEditorEvents();
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
$("deleteAllVisibleBtn").addEventListener("click",deleteAllVisibleRegistrations);$("downloadSelectedTicketsBtn").addEventListener("click",downloadSelectedTicketsZip);$("exportRegistrationsBtn").addEventListener("click",()=>downloadRegistrationCsv("registered"));$("exportAccreditedBtn").addEventListener("click",()=>downloadRegistrationCsv("accredited"));$("ticketActivity").addEventListener("change",renderTicketRegistrationOptions);$("ticketRegistration").addEventListener("change",()=>{renderTicketPreview();if(!$("ticketEditorPanel").classList.contains("hidden"))renderTicketEditorStage();});$("ticketTemplate").addEventListener("change",selectTicketTemplate);$("ticketBackground").addEventListener("input",changeTicketColors);$("ticketAccent").addEventListener("input",changeTicketColors);$("ticketTextColor").addEventListener("input",changeTicketColors);$("ticketResetDesignBtn").addEventListener("click",resetTicketDesignColors);$("downloadOneBtn").addEventListener("click",downloadOne);$("downloadZipBtn").addEventListener("click",downloadZip);
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
$("ticketActivity").addEventListener("change",()=>{activityOptions("ticketActivity");renderTicketRegistrationOptions();if(!$("ticketEditorPanel").classList.contains("hidden"))renderTicketEditorStage();});
$("checkinActivity").addEventListener("change",renderManualCheckinList);
$("manualCheckinSearch").addEventListener("input",renderManualCheckinList);
$("adminTab").addEventListener("click",()=>{if(currentProfile?.role!=="admin")switchTab("dashboard");});
$("mailSettingsForm").addEventListener("submit",saveMailSettings);
$("mailTestConnectionBtn").addEventListener("click",testMailConnection);
$("mailActivity").addEventListener("change",()=>{$("mailProgressMessage").textContent="";$("mailResults").textContent="";void loadMailDeliveryLogs();});
$("mailResendSent").addEventListener("change",renderMailRecipients);
$("mailSendBtn").addEventListener("click",sendMailEntries);
window.addEventListener("offline",()=>setMailConnectionStatus("disconnected","Sin conexión a internet"));
window.addEventListener("online",()=>{if(currentProfile?.role==="admin")void refreshMailConnection();});
if(supabase){supabase.auth.getSession().then(async({data})=>{if(data.session){currentUser=data.session.user;await afterLogin();}});supabase.auth.onAuthStateChange((_event,session)=>{if(!session){currentUser=null;currentProfile=null;setSignedIn(false);}});}
