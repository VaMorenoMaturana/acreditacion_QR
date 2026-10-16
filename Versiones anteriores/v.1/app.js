/* Usa solamente la URL y clave pública/anon de Supabase. Nunca la service_role. */
const SUPABASE_URL = "https://kgkmjbvsirewbnmsxcts.supabase.co/";
const SUPABASE_ANON_KEY = "sb_publishable_VS2Q7eAuecprLbL0yKPScA_UrguRC-1";
const $ = id => document.getElementById(id);
const configured = SUPABASE_URL.startsWith("https://") && !SUPABASE_URL.includes("PEGA_AQUI") && !SUPABASE_ANON_KEY.includes("PEGA_AQUI");
let supabaseClient=null,currentUser=null,currentRole=null,scanner=null,scannerRunning=false,processingScan=false,attendeesCache=[],pendingTicket=null,realtimeChannel=null;

function show(id,visible=true){$(id).classList.toggle("hidden",!visible);}
function escapeHtml(v=""){return String(v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function setError(id,msg){$(id).textContent=msg||"";}
function formatDate(v){if(!v)return "—";return new Intl.DateTimeFormat("es-CL",{dateStyle:"short",timeStyle:"short"}).format(new Date(v));}
function normalizeCode(raw){let s=String(raw||"").trim();try{if(s.startsWith("http://")||s.startsWith("https://")){const u=new URL(s);s=u.searchParams.get("ticket")||u.pathname.split("/").filter(Boolean).pop()||s;}}catch{}return s.replace(/^L100P:/i,"").trim();}
function statusLabel(a){if(a.checked_out_at)return "Se fue";if(a.checked_in_at)return "Ingresó";return "Pendiente";}

async function init(){
 if(!configured){show("setupNotice");$("loginForm").querySelector("button").disabled=true;return;}
 supabaseClient=window.supabase.createClient(SUPABASE_URL,SUPABASE_ANON_KEY);
 const {data:{session}}=await supabaseClient.auth.getSession();if(session)await enterApp(session.user);
}
$("loginForm").addEventListener("submit",async e=>{e.preventDefault();setError("loginError","");const {data,error}=await supabaseClient.auth.signInWithPassword({email:$("email").value.trim(),password:$("password").value});if(error){setError("loginError","No fue posible iniciar sesión. Revisa tus credenciales o contacta al administrador.");return;}await enterApp(data.user);});
$("logoutBtn").addEventListener("click",async()=>{if(scannerRunning)await stopScanner();if(realtimeChannel)await supabaseClient.removeChannel(realtimeChannel);await supabaseClient.auth.signOut();currentUser=null;currentRole=null;show("appView",false);show("loginView",true);show("logoutBtn",false);});
async function enterApp(user){
 currentUser=user;const {data:profile,error}=await supabaseClient.from("user_profiles").select("display_name,role").eq("id",user.id).single();
 if(error||!profile||!["admin","staff"].includes(profile.role)){await supabaseClient.auth.signOut();setError("loginError","Tu cuenta no tiene un perfil habilitado. Solicita acceso al administrador.");show("loginView",true);return;}
 currentRole=profile.role;show("loginView",false);show("appView",true);show("logoutBtn",true);
 $("welcomeTitle").textContent=`Hola, ${profile.display_name||user.email}`;$("rolePill").textContent=currentRole==="admin"?"Director de Datos":"Equipo de acceso";$("roleDescription").textContent=currentRole==="admin"?"Administra invitaciones y monitorea ingresos y salidas.":"Escanea invitaciones y registra ingresos.";
 show("adminTab",currentRole==="admin");show("adminPanel",false);show("scanPanel",true);$("scanTab").classList.add("active");$("adminTab").classList.remove("active");
 if(currentRole==="admin"){await loadAttendees();subscribeRealtime();}
}
document.querySelectorAll(".tab").forEach(btn=>btn.addEventListener("click",async()=>{const admin=btn.dataset.tab==="adminPanel";if(admin&&currentRole!=="admin")return;show("scanPanel",!admin);show("adminPanel",admin);$("scanTab").classList.toggle("active",!admin);$("adminTab").classList.toggle("active",admin);if(admin)await loadAttendees();}));
$("startScanBtn").addEventListener("click",startScanner);$("stopScanBtn").addEventListener("click",stopScanner);
async function startScanner(){
 if(!window.Html5Qrcode){alert("No se pudo cargar el lector QR. Comprueba tu conexión.");return;}
 try{if(!scanner)scanner=new Html5Qrcode("reader");await scanner.start({facingMode:"environment"},{fps:10,qrbox:{width:250,height:250}},async decoded=>{if(processingScan)return;processingScan=true;await stopScanner();await lookupTicket(decoded);processingScan=false;},()=>{});scannerRunning=true;$("startScanBtn").disabled=true;$("stopScanBtn").disabled=false;}
 catch(err){alert("No se pudo activar la cámara. Permite el acceso y abre el sitio mediante HTTPS.");scannerRunning=false;}
}
async function stopScanner(){if(scanner&&scannerRunning){try{await scanner.stop();}catch{}try{await scanner.clear();}catch{}}scannerRunning=false;$("startScanBtn").disabled=false;$("stopScanBtn").disabled=true;}
$("manualForm").addEventListener("submit",async e=>{e.preventDefault();const code=$("manualCode").value.trim();if(code)await lookupTicket(code);$("manualCode").value="";});

async function lookupTicket(raw){
 const token=normalizeCode(raw);
 if(!/^[0-9a-f-]{30,40}$/i.test(token)){showScanMessage("failure","Código no válido","El QR no tiene el formato esperado.");return;}
 showScanMessage("","Consultando invitación…","Verificando con el registro oficial.");
 const {data,error}=await supabaseClient.rpc("lookup_ticket",{p_token:token});
 if(error){showScanMessage("failure","No se pudo validar","Comprueba la conexión o contacta al administrador.");return;}
 const r=Array.isArray(data)?data[0]:data;
 if(!r||!r.status){showScanMessage("failure","Respuesta inesperada","Contacta al administrador.");return;}
 if(r.status==="invalid"){showScanMessage("failure","Invitación no válida","El código no existe en el registro.");return;}
 pendingTicket={token,attendee:r};
 $("modalTitle").textContent=r.full_name||"Invitado";
 $("modalDetails").innerHTML=`<p><strong>Nombre:</strong> ${escapeHtml(r.full_name||"—")}</p><p><strong>Organización:</strong> ${escapeHtml(r.organization||"No indicada")}</p><p><strong>Correo:</strong> ${escapeHtml(r.email||"No indicado")}</p><p><strong>Estado:</strong> ${escapeHtml(r.checked_out_at?"Se fue":r.checked_in_at?"Ya ingresó":"Pendiente de ingreso")}</p>${r.checked_in_at?`<p><strong>Hora de ingreso:</strong> ${escapeHtml(formatDate(r.checked_in_at))}</p>`:""}${r.checked_out_at?`<p><strong>Hora de salida:</strong> ${escapeHtml(formatDate(r.checked_out_at))}</p>`:""}`;
 const already=!!r.checked_in_at;
 $("modalStatus").textContent=r.checked_out_at?"Este invitado ya fue marcado como salida.":already?"Este invitado ya tiene un ingreso registrado.":"Verifica que los datos correspondan a la persona presente antes de pulsar Ingresar.";
 $("confirmCheckinBtn").disabled=already;
 $("confirmCheckinBtn").textContent=already?"Ingreso ya registrado":"Ingresar";
 show("attendeeModal");
}
function showScanMessage(kind,title,message){const el=$("scanResult");el.className=`result ${kind}`;el.innerHTML=`<h3>${escapeHtml(title)}</h3><p>${escapeHtml(message)}</p>`;show("scanResult");}
function closeModal(){show("attendeeModal",false);pendingTicket=null;}
$("closeModalBtn").addEventListener("click",closeModal);$("cancelModalBtn").addEventListener("click",closeModal);
$("attendeeModal").addEventListener("click",e=>{if(e.target===$("attendeeModal"))closeModal();});
$("confirmCheckinBtn").addEventListener("click",async()=>{
 if(!pendingTicket)return;const btn=$("confirmCheckinBtn");btn.disabled=true;btn.textContent="Registrando…";
 const {data,error}=await supabaseClient.rpc("check_in_ticket",{p_token:pendingTicket.token});
 if(error){$("modalStatus").textContent="No se pudo registrar el ingreso. Comprueba la conexión e inténtalo nuevamente.";btn.disabled=false;btn.textContent="Ingresar";return;}
 const r=Array.isArray(data)?data[0]:data;
 if(r?.status==="valid"){closeModal();showScanMessage("success","✓ Ingreso registrado",`${r.full_name} · ${formatDate(r.checked_in_at)}`);if(currentRole==="admin")await loadAttendees();}
 else{$("modalStatus").textContent=r?.status==="already_checked_in"?"Este QR ya fue utilizado. No se registró un segundo ingreso.":"No fue posible registrar el ingreso.";btn.disabled=true;btn.textContent="Ingreso no disponible";}
});

$("attendeeForm").addEventListener("submit",async e=>{
 e.preventDefault();setError("createError","");const full_name=$("attendeeName").value.trim(),email=$("attendeeEmail").value.trim()||null,organization=$("attendeeOrg").value.trim()||null;if(!full_name)return;
 const {data,error}=await supabaseClient.from("attendees").insert({full_name,email,organization,qr_token:crypto.randomUUID(),created_by:currentUser.id}).select("id,full_name,organization,email,qr_token").single();
 if(error){setError("createError","No se pudo crear la invitación. Verifica los permisos y la base de datos.");return;}
 try{await downloadQr(data);$("attendeeForm").reset();await loadAttendees();}catch{setError("createError","La invitación se creó, pero no se pudo descargar el QR. Puedes intentarlo desde la tabla.");}
});
function makeQrCanvas(text){return new Promise((resolve,reject)=>{const stage=$("qrDownloadStage");stage.innerHTML="";try{new QRCode(stage,{text,width:320,height:320,colorDark:"#12233f",colorLight:"#ffffff",correctLevel:QRCode.CorrectLevel.H});}catch(e){reject(e);return;}setTimeout(()=>{const canvas=stage.querySelector("canvas"),img=stage.querySelector("img");if(canvas)resolve(canvas);else if(img){const image=new Image();image.onload=()=>{const c=document.createElement("canvas");c.width=320;c.height=320;c.getContext("2d").drawImage(image,0,0,320,320);resolve(c);};image.onerror=reject;image.src=img.src;}else reject(new Error("QR no disponible"));},120);});}
function safeFilename(name){return String(name||"invitado").normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-zA-Z0-9_-]+/g,"_").slice(0,70)||"invitado";}
async function downloadQr(person){const canvas=await makeQrCanvas(`L100P:${person.qr_token}`);const a=document.createElement("a");a.download=`QR_${safeFilename(person.full_name)}.png`;a.href=canvas.toDataURL("image/png");a.click();}
function parseCsv(text){
 const rows=[];let row=[],field="",quoted=false;
 const firstLine=(text.split(/\r?\n/)[0]||"");const delimiter=(firstLine.split(";").length>firstLine.split(",").length)?";":",";
 for(let i=0;i<text.length;i++){const c=text[i],n=text[i+1];if(c==='"'&&quoted&&n==='"'){field+='"';i++;}else if(c==='"'){quoted=!quoted;}else if(c===delimiter&&!quoted){row.push(field.trim());field="";}else if((c==="\n"||c==="\r")&&!quoted){if(c==="\r"&&n==="\n")i++;row.push(field.trim());if(row.some(x=>x!==""))rows.push(row);row=[];field="";}else field+=c;}
 if(field.length||row.length){row.push(field.trim());if(row.some(x=>x!==""))rows.push(row);}
 if(!rows.length)return [];
 const headers=rows.shift().map(h=>h.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").trim());
 const nameIdx=headers.findIndex(h=>["nombre","nombre completo","name","full_name"].includes(h));
 const emailIdx=headers.findIndex(h=>["correo","email","correo electronico"].includes(h));
 const orgIdx=headers.findIndex(h=>["organizacion","organization","institucion"].includes(h));
 if(nameIdx<0)throw new Error("El CSV debe incluir una columna llamada nombre (o full_name).");
 return rows.map(r=>({full_name:(r[nameIdx]||"").trim(),email:emailIdx>=0?(r[emailIdx]||"").trim()||null:null,organization:orgIdx>=0?(r[orgIdx]||"").trim()||null:null})).filter(r=>r.full_name);
}
$("templateCsvBtn").addEventListener("click",()=>{const blob=new Blob(["nombre,correo,organizacion\\nEjemplo Apellido,ejemplo@correo.cl,Organización Ejemplo\\n"],{type:"text/csv;charset=utf-8"});const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="plantilla_invitados.csv";a.click();URL.revokeObjectURL(a.href);});
$("csvFile").addEventListener("change",async e=>{
 const file=e.target.files[0];if(!file)return;const status=$("csvStatus");status.textContent="Leyendo archivo…";
 try{
  const records=parseCsv((await file.text()).replace(/^\uFEFF/,""));
  if(!records.length)throw new Error("No se encontraron filas con nombre.");
  if(records.length>500)throw new Error("El límite por importación es 500 invitados.");
  if(!confirm(`Se importarán ${records.length} invitados. Los registros nuevos se agregarán y no se modificarán los existentes. ¿Continuar?`)){status.textContent="Importación cancelada.";return;}
  const payload=records.map(r=>({...r,qr_token:crypto.randomUUID(),created_by:currentUser.id}));
  let inserted=0;
  for(let i=0;i<payload.length;i+=50){const {error}=await supabaseClient.from("attendees").insert(payload.slice(i,i+50));if(error)throw new Error(`Error al importar el bloque ${Math.floor(i/50)+1}. Revisa que los nombres sean válidos y que no haya columnas incorrectas. Se pudieron importar ${inserted} antes del error.`);inserted+=payload.slice(i,i+50).length;}
  status.textContent=`Importación completada: ${inserted} invitados. Puedes descargar sus QR en un ZIP.`;await loadAttendees();
 }catch(err){status.textContent=err.message||"No se pudo leer el CSV.";}finally{e.target.value="";}
});
async function loadAttendees(){
 if(currentRole!=="admin")return;
 const {data,error}=await supabaseClient.from("attendees").select("id,full_name,email,organization,qr_token,checked_in_at,checked_out_at,created_at").order("full_name");
 if(error){$("attendeesTable").innerHTML='<tr><td colspan="5">No fue posible cargar los asistentes.</td></tr>';return;}attendeesCache=data||[];renderAttendees();
}
function renderAttendees(){
 const rows=attendeesCache,checked=rows.filter(a=>a.checked_in_at&&!a.checked_out_at).length,left=rows.filter(a=>a.checked_out_at).length,total=rows.length;
 $("totalCount").textContent=total;$("checkedCount").textContent=checked;$("pendingCount").textContent=rows.filter(a=>!a.checked_in_at).length;$("attendanceRate").textContent=total?`${Math.round(rows.filter(a=>a.checked_in_at).length/total*100)}%`:"0%";
 $("attendeesTable").innerHTML=rows.length?rows.map(a=>`<tr><td><strong>${escapeHtml(a.full_name)}</strong></td><td>${escapeHtml(a.organization||"—")}</td><td class="${a.checked_out_at?"state-left":a.checked_in_at?"state-checked":"state-pending"}">${statusLabel(a)}</td><td>${a.checked_in_at?`Entrada: ${escapeHtml(formatDate(a.checked_in_at))}`:"—"}${a.checked_out_at?`<br>Salida: ${escapeHtml(formatDate(a.checked_out_at))}`:""}</td><td class="action-cell"><button class="button button-secondary button-small" data-qr="${escapeHtml(a.id)}">QR</button><button class="button button-secondary button-small" data-left="${escapeHtml(a.id)}" ${!a.checked_in_at||a.checked_out_at?"disabled":""}>Marcar salida</button><button class="button button-danger button-small" data-delete="${escapeHtml(a.id)}">Eliminar</button></td></tr>`).join(""):'<tr><td colspan="5" class="muted">Todavía no hay invitaciones creadas.</td></tr>';
 $("attendeesTable").querySelectorAll("[data-qr]").forEach(b=>b.addEventListener("click",()=>{const a=attendeesCache.find(x=>x.id===b.dataset.qr);if(a)downloadQr(a);}));
 $("attendeesTable").querySelectorAll("[data-delete]").forEach(b=>b.addEventListener("click",async()=>{const a=attendeesCache.find(x=>x.id===b.dataset.delete);if(!a||!confirm(`¿Eliminar la invitación de ${a.full_name}? Esta acción no se puede deshacer.`))return;const {error}=await supabaseClient.from("attendees").delete().eq("id",a.id);if(error)alert("No se pudo eliminar el invitado.");else await loadAttendees();}));
 $("attendeesTable").querySelectorAll("[data-left]").forEach(b=>b.addEventListener("click",async()=>{const a=attendeesCache.find(x=>x.id===b.dataset.left);if(!a||!confirm(`¿Marcar a ${a.full_name} como salida?`))return;const {data,error}=await supabaseClient.rpc("mark_departure",{p_token:a.qr_token});if(error){alert("No se pudo registrar la salida. Ejecuta la actualización SQL incluida en el proyecto.");return;}const r=Array.isArray(data)?data[0]:data;if(r?.status!=="left")alert("No se pudo registrar la salida: el invitado debe haber ingresado previamente.");await loadAttendees();}));
}
$("deleteAllBtn").addEventListener("click",async()=>{if(currentRole!=="admin")return;if(!attendeesCache.length){alert("No hay invitados que eliminar.");return;}const word=prompt(`Vas a eliminar ${attendeesCache.length} invitados y sus registros de entrada/salida. Esta acción es irreversible. Escribe ELIMINAR para confirmar:`);if(word!=="ELIMINAR")return;const {error}=await supabaseClient.from("attendees").delete().not("id","is",null);if(error){alert("No se pudieron eliminar todos los invitados.");return;}await loadAttendees();});
$("downloadAllQrBtn").addEventListener("click",async()=>{
 if(!attendeesCache.length){alert("No hay invitados para generar QR.");return;}if(!window.JSZip){alert("No se pudo cargar el generador ZIP. Comprueba la conexión.");return;}
 const btn=$("downloadAllQrBtn");btn.disabled=true;btn.textContent="Generando…";
 try{const zip=new JSZip();for(let i=0;i<attendeesCache.length;i++){const p=attendeesCache[i],canvas=await makeQrCanvas(`L100P:${p.qr_token}`);const data=canvas.toDataURL("image/png").split(",")[1];zip.file(`${String(i+1).padStart(3,"0")}_QR_${safeFilename(p.full_name)}.png`,data,{base64:true});}
  const blob=await zip.generateAsync({type:"blob"});const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="QR_Liderazgo_100_Palabras.zip";a.click();URL.revokeObjectURL(a.href);
 }catch(e){alert("No se pudo generar el ZIP de QR. Inténtalo nuevamente.");}finally{btn.disabled=false;btn.textContent="Descargar QR en ZIP";}
});
$("refreshBtn").addEventListener("click",loadAttendees);
function subscribeRealtime(){if(realtimeChannel)supabaseClient.removeChannel(realtimeChannel);realtimeChannel=supabaseClient.channel("admin-attendance-live").on("postgres_changes",{event:"*",schema:"public",table:"attendees"},()=>loadAttendees()).subscribe();}
window.addEventListener("beforeunload",()=>{if(realtimeChannel&&supabaseClient)supabaseClient.removeChannel(realtimeChannel);});
init();
