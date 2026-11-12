import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";
import { ticketMarkup } from "./ticket-template.js";

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
function setSignedIn(on){$("loginView").classList.toggle("hidden",on);$("appView").classList.toggle("hidden",!on);$("logoutBtn").classList.toggle("hidden",!on);$("userLabel").textContent=on?(currentUser?.email||""):"";}
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
async function loadAll(){
  const [a,r,c,p]=await Promise.all([
    supabase.from("activities").select("*").order("event_date",{ascending:false}),
    supabase.from("registrations").select("*, attendees(*)").order("created_at",{ascending:false}),
    supabase.from("check_ins").select("*").order("checked_in_at",{ascending:false}).limit(100),
    supabase.from("profiles").select("*").order("created_at",{ascending:true})
  ]);
  for(const [name,res] of [["actividades",a],["inscripciones",r],["acreditaciones",c],["perfiles",p]]) if(res.error) console.warn(`Carga de ${name}:`,res.error.message);
  activities=a.data||[];registrations=(r.data||[]).map(x=>({...x,attendee:x.attendees||{}}));const validRegistrationIds=new Set(registrations.map(x=>x.id));for(const id of selectedRegistrationIds)if(!validRegistrationIds.has(id))selectedRegistrationIds.delete(id);checkins=c.data||[];
  activityOptions("registrationActivity");activityOptions("csvActivity");activityOptions("registrationFilter",true);activityOptions("ticketActivity");activityOptions("checkinActivity");
  renderAll();renderUsers(p.data||[]);
}
function renderAll(){
  const open=activities.filter(a=>a.status==="open").length, checked=registrations.filter(r=>r.status==="checked_in").length;
  $("statActivities").textContent=open;$("statRegistrations").textContent=registrations.length;$("statChecked").textContent=checked;$("statPending").textContent=registrations.filter(r=>r.status==="registered").length;
  const recent=activities.slice(0,6).map(a=>`<tr><td>${escapeHtml(a.name)}</td><td>${dateLabel(a.event_date)}</td><td><span class="badge ${a.status==="open"?"good":"bad"}">${a.status==="open"?"Abierta":"Cerrada"}</span></td><td>${registrations.filter(r=>r.activity_id===a.id).length}</td></tr>`);
  $("recentActivities").innerHTML=table(["Actividad","Fecha","Estado","Inscripciones"],recent);
  $("activitiesTable").innerHTML=table(["Actividad","Fecha","Lugar","Estado","Acciones"],activities.map(a=>`<tr><td>${escapeHtml(a.name)}</td><td>${dateLabel(a.event_date)}</td><td>${escapeHtml(a.place)}</td><td>${a.status==="open"?"Abierta":"Cerrada"}</td><td><button class="secondary" data-edit-activity="${a.id}">Editar</button><button class="secondary" data-toggle-activity="${a.id}">${a.status==="open"?"Cerrar":"Reabrir"}</button></td></tr>`));
  renderRegistrations();renderTicketRegistrationOptions();renderCheckins();
}
function visibleRegistrations(){
  const filter=$("registrationFilter").value;
  return registrations.filter(r=>!filter||r.activity_id===filter);
}
function updateBulkSelectionUI(list=visibleRegistrations()){
  const ids=list.map(r=>r.id),selected=ids.filter(id=>selectedRegistrationIds.has(id)).length;
  $("selectionSummary").textContent=`${selectedRegistrationIds.size} seleccionados · ${list.length} visibles`;
  $("deleteSelectedBtn").disabled=selectedRegistrationIds.size===0;
  $("deleteSelectedBtn").textContent=selectedRegistrationIds.size?`Eliminar seleccionados (${selectedRegistrationIds.size})`:"Eliminar seleccionados";
  $("deleteAllVisibleBtn").disabled=list.length===0;
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
 const aid=$("ticketActivity").value;
 $("ticketRegistration").innerHTML=registrations.filter(r=>r.activity_id===aid&&r.status!=="cancelled").map(r=>`<option value="${r.id}">${escapeHtml(r.attendee.full_name)} · ${escapeHtml(r.attendee.email||"sin correo")}</option>`).join("");
 renderTicketPreview();
}
function renderCheckins(){
 $("checkinTable").innerHTML=table(["Fecha/hora","Token","Estado"],checkins.slice(0,20).map(c=>`<tr><td>${escapeHtml(new Date(c.checked_in_at).toLocaleString("es-CL"))}</td><td>${escapeHtml(c.token||"—")}</td><td>Acreditada</td></tr>`));
}
function renderUsers(profiles){
 const admin=currentProfile?.role==="admin";
 $("adminTab").classList.toggle("hidden",!admin);
 $("usersTable").innerHTML=admin?table(["Correo","Rol","Acción"],profiles.map(p=>`<tr><td>${escapeHtml(p.email||p.id)}</td><td>${escapeHtml(p.role)}</td><td><select data-role-user="${p.id}"><option value="staff" ${p.role==="staff"?"selected":""}>Personal</option><option value="admin" ${p.role==="admin"?"selected":""}>Administrador</option></select><button class="secondary" data-save-role="${p.id}">Guardar rol</button></td></tr>`)):'<p class="muted">Se requiere rol administrador.</p>';
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
 await loadAll();refreshCsvDuplicateWarnings();
 const duplicateImported=selected.filter(row=>row.imported&&row.warnings.length).length;
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
async function saveRole(id){const role=document.querySelector(`[data-role-user="${id}"]`).value;const {error}=await supabase.from("profiles").update({role}).eq("id",id);if(error)alert(error.message);else await loadAll();}
function switchTab(name){document.querySelectorAll(".tab-panel").forEach(x=>x.classList.add("hidden"));$("tab-"+name)?.classList.remove("hidden");document.querySelectorAll("[data-tab]").forEach(x=>x.classList.toggle("active",x.dataset.tab===name));if(name==="tickets")resizeTicketPreview();}
$("loginForm").addEventListener("submit",async ev=>{ev.preventDefault();say("loginMessage","Iniciando sesión…");if(!supabase){say("loginMessage","Configura Supabase en src/config.js.",true);return;}const {data,error}=await supabase.auth.signInWithPassword({email:val("loginEmail"),password:$("loginPassword").value});if(error){say("loginMessage",error.message,true);return;}currentUser=data.user;await afterLogin();});
$("logoutBtn").addEventListener("click",async()=>{await stopScanner();await supabase.auth.signOut();currentUser=null;currentProfile=null;setSignedIn(false);});
async function afterLogin(){const {data,error}=await supabase.from("profiles").select("*").eq("id",currentUser.id).maybeSingle();if(error||!data){say("loginMessage","La cuenta no tiene perfil autorizado. Solicita al administrador que la habilite.",true);await supabase.auth.signOut();return;}currentProfile=data;setSignedIn(true);await loadAll();switchTab("dashboard");}
$("downloadCsvTemplateBtn").addEventListener("click",downloadCsvTemplate);$("activityForm").addEventListener("submit",saveActivity);$("clearActivity").addEventListener("click",clearActivityForm);$("registrationForm").addEventListener("submit",saveRegistration);$("importCsvBtn").addEventListener("click",importCsv);
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
$("deleteAllVisibleBtn").addEventListener("click",deleteAllVisibleRegistrations);$("ticketActivity").addEventListener("change",renderTicketRegistrationOptions);$("ticketRegistration").addEventListener("change",renderTicketPreview);$("downloadOneBtn").addEventListener("click",downloadOne);$("downloadZipBtn").addEventListener("click",downloadZip);
$("manualCheckinForm").addEventListener("submit",ev=>{ev.preventDefault();checkin(val("manualToken"));});$("startScannerBtn").addEventListener("click",startScanner);$("stopScannerBtn").addEventListener("click",stopScanner);
document.addEventListener("click",ev=>{const t=ev.target.closest("[data-tab],[data-goto],[data-edit-activity],[data-toggle-activity],[data-ticket],[data-cancel],[data-delete],[data-save-role]");if(!t)return;if(t.dataset.goto==="auditorio"){const aid=val("registrationFilter")||val("registrationActivity")||activities[0]?.id||"";location.href="./auditorio.html"+(aid?"?activity="+encodeURIComponent(aid):"");return;}if(t.dataset.tab)switchTab(t.dataset.tab);if(t.dataset.goto)switchTab(t.dataset.goto);if(t.dataset.editActivity)editActivity(t.dataset.editActivity);if(t.dataset.toggleActivity)toggleActivity(t.dataset.toggleActivity);if(t.dataset.ticket){const r=selectedRegistration(t.dataset.ticket);if(r){$("ticketActivity").value=r.activity_id;renderTicketRegistrationOptions();$("ticketRegistration").value=r.id;renderTicketPreview();switchTab("tickets");}}if(t.dataset.cancel)cancelRegistration(t.dataset.cancel);if(t.dataset.delete)deleteRegistration(t.dataset.delete);if(t.dataset.saveRole)saveRole(t.dataset.saveRole);});
for(const [input,key] of [["activityLogo","institution"],["projectLogo","project"],["partnerLogo","partner"]])$(input).addEventListener("change",async ev=>{const f=ev.target.files?.[0];if(!f)return;if(!f.type.startsWith("image/")){say("activityMessage","Selecciona un archivo de imagen.",true);return;}if(f.size>1_500_000){say("activityMessage","El logotipo supera 1,5 MB. Reduce su tamaño antes de subirlo.",true);return;}logoData[key]=await fileAsDataUrl(f);});
$("ticketActivity").addEventListener("change",()=>{activityOptions("ticketActivity");renderTicketRegistrationOptions();});
$("checkinActivity").addEventListener("change",()=>{});
$("adminTab").addEventListener("click",()=>{if(currentProfile?.role!=="admin")switchTab("dashboard");});
if(supabase){supabase.auth.getSession().then(async({data})=>{if(data.session){currentUser=data.session.user;await afterLogin();}});supabase.auth.onAuthStateChange((_event,session)=>{if(!session){currentUser=null;currentProfile=null;setSignedIn(false);}});}
