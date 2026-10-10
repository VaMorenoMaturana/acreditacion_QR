/* Configuración: usa únicamente la URL y la clave anon/public de Supabase.
   Nunca coloques SUPABASE_SERVICE_ROLE_KEY en el navegador. */
const SUPABASE_URL = "https://kgkmjbvsirewbnmsxcts.supabase.co/";
const SUPABASE_ANON_KEY = "sb_publishable_VS2Q7eAuecprLbL0yKPScA_UrguRC-1";

const $ = (id) => document.getElementById(id);
const configured = SUPABASE_URL.startsWith("https://") && !SUPABASE_URL.includes("PEGA_AQUI") && !SUPABASE_ANON_KEY.includes("PEGA_AQUI");
let supabaseClient = null, currentUser = null, currentRole = null, scanner = null, scannerRunning = false, processingScan = false, attendeesCache = [];

function show(id, visible=true){ $(id).classList.toggle("hidden", !visible); }
function escapeHtml(value=""){return String(value).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function setError(id,msg){$(id).textContent=msg||"";}
function setResult(kind,title,lines=[]){const el=$("scanResult");el.className=`result ${kind}`;el.innerHTML=`<h3>${escapeHtml(title)}</h3>${lines.map(x=>`<p>${escapeHtml(x)}</p>`).join("")}`;show("scanResult");}
function formatDate(value){if(!value)return "—";return new Intl.DateTimeFormat("es-CL",{dateStyle:"short",timeStyle:"short"}).format(new Date(value));}
function normalizeCode(raw){let s=String(raw||"").trim();try{if(s.startsWith("http://")||s.startsWith("https://")){const u=new URL(s);s=u.searchParams.get("ticket")||u.pathname.split("/").filter(Boolean).pop()||s;}}catch{}return s.replace(/^L100P:/i,"").trim();}

async function init(){
  if(!configured){show("setupNotice");$("loginView").classList.remove("hidden");$("loginForm").querySelector("button").disabled=true;return;}
  supabaseClient=window.supabase.createClient(SUPABASE_URL,SUPABASE_ANON_KEY);
  const {data:{session}}=await supabaseClient.auth.getSession();
  if(session) await enterApp(session.user);
}
$("loginForm").addEventListener("submit",async e=>{
  e.preventDefault();setError("loginError","");
  const {data,error}=await supabaseClient.auth.signInWithPassword({email:$("email").value.trim(),password:$("password").value});
  if(error){setError("loginError","No fue posible iniciar sesión. Revisa tus credenciales o contacta al administrador.");return;}
  await enterApp(data.user);
});
$("logoutBtn").addEventListener("click",async()=>{if(scannerRunning)await stopScanner();await supabaseClient.auth.signOut();currentUser=null;currentRole=null;show("appView",false);show("loginView",true);show("logoutBtn",false);});
async function enterApp(user){
  currentUser=user;
  const {data:profile,error}=await supabaseClient.from("user_profiles").select("display_name,role").eq("id",user.id).single();
  if(error||!profile||!["admin","staff"].includes(profile.role)){
    await supabaseClient.auth.signOut();setError("loginError","Tu cuenta no tiene un perfil habilitado. Solicita acceso al administrador.");show("loginView",true);return;
  }
  currentRole=profile.role;show("loginView",false);show("appView",true);show("logoutBtn",true);
  $("welcomeTitle").textContent=`Hola, ${profile.display_name||user.email}`;
  $("rolePill").textContent=currentRole==="admin"?"Director de Datos":"Equipo de acceso";
  $("roleDescription").textContent=currentRole==="admin"?"Administra invitaciones y monitorea el ingreso en tiempo real.":"Escanea y valida invitaciones de los asistentes.";
  show("adminTab",currentRole==="admin");show("adminPanel",false);show("scanPanel",true);$("scanTab").classList.add("active");$("adminTab").classList.remove("active");
  if(currentRole==="admin"){await loadAttendees();subscribeRealtime();}
}
document.querySelectorAll(".tab").forEach(btn=>btn.addEventListener("click",async()=>{
  const admin=btn.dataset.tab==="adminPanel";
  if(admin&&currentRole!=="admin")return;
  show("scanPanel",!admin);show("adminPanel",admin);
  $("scanTab").classList.toggle("active",!admin);$("adminTab").classList.toggle("active",admin);
  if(admin)await loadAttendees();
  if(!admin)show("scanResult",false);
}));

$("startScanBtn").addEventListener("click",startScanner);
$("stopScanBtn").addEventListener("click",stopScanner);
async function startScanner(){
  if(!window.Html5Qrcode){setResult("failure","No se pudo cargar el lector QR",["Comprueba tu conexión e inténtalo nuevamente."]);return;}
  try{
    if(!scanner)scanner=new Html5Qrcode("reader");
    await scanner.start({facingMode:"environment"},{fps:10,qrbox:{width:250,height:250}},async decoded=>{if(processingScan)return;processingScan=true;await stopScanner();await validateTicket(decoded);processingScan=false;},()=>{});
    scannerRunning=true;$("startScanBtn").disabled=true;$("stopScanBtn").disabled=false;
  }catch(err){setResult("failure","No se pudo activar la cámara",["Permite el acceso a la cámara y abre el sitio mediante HTTPS. También puedes ingresar el código manualmente."]);scannerRunning=false;}
}
async function stopScanner(){
  if(scanner&&scannerRunning){try{await scanner.stop();}catch{}try{await scanner.clear();}catch{}}
  scannerRunning=false;$("startScanBtn").disabled=false;$("stopScanBtn").disabled=true;
}
$("manualForm").addEventListener("submit",async e=>{e.preventDefault();const code=$("manualCode").value.trim();if(!code)return;await validateTicket(code);$("manualCode").value="";});
async function validateTicket(raw){
  const token=normalizeCode(raw);
  if(!/^[0-9a-f-]{30,40}$/i.test(token)){setResult("failure","Código no válido",["El contenido escaneado no corresponde al formato de una invitación de Liderazgo en 100 Palabras."]);return;}
  setResult("","Validando invitación…",["Consultando el registro oficial."]);
  const {data,error}=await supabaseClient.rpc("validate_and_check_in",{p_token:token});
  if(error){setResult("failure","No se pudo validar",["Verifica la conexión. Si el problema continúa, informa al administrador; no autorices el ingreso sin validación."]);return;}
  const result=Array.isArray(data)?data[0]:data;
  if(!result||!result.status){setResult("failure","Respuesta inesperada",["Contacta al administrador."]);return;}
  if(result.status==="valid"){
    setResult("success","✓ Invitación válida — ingreso registrado",[result.full_name, result.organization?`Organización: ${result.organization}`:"",`Hora: ${formatDate(result.checked_in_at)}`].filter(Boolean));
  }else if(result.status==="already_checked_in"){
    setResult("failure","⚠ Invitación ya utilizada",[result.full_name||"Asistente registrado",`Ingreso registrado: ${formatDate(result.checked_in_at)}`,"No vuelvas a registrar el mismo código."]);
  }else if(result.status==="invalid"){
    setResult("failure","✕ Invitación no válida",["El código no existe o no corresponde a una invitación registrada."]);
  }else{setResult("failure","No se pudo autorizar el ingreso",[result.message||"Contacta al administrador."]);}
}

$("attendeeForm").addEventListener("submit",async e=>{
  e.preventDefault();setError("createError","");
  const full_name=$("attendeeName").value.trim(), email=$("attendeeEmail").value.trim()||null, organization=$("attendeeOrg").value.trim()||null;
  if(!full_name)return;
  const token=crypto.randomUUID();
  const {data,error}=await supabaseClient.from("attendees").insert({full_name,email,organization,qr_token:token,created_by:currentUser.id}).select("id,full_name,organization,qr_token").single();
  if(error){setError("createError","No se pudo crear la invitación. Verifica tus permisos y que la base de datos esté configurada.");return;}
  try{await downloadQr(data);$("attendeeForm").reset();await loadAttendees();}
  catch(err){setError("createError","La invitación fue creada, pero no se pudo descargar el QR. Usa el botón QR en la tabla para volver a descargarlo.");}
});
function makeQrCanvas(text){
  return new Promise((resolve,reject)=>{
    const stage=$("qrDownloadStage");stage.innerHTML="";
    try{new QRCode(stage,{text,width:320,height:320,colorDark:"#12233f",colorLight:"#ffffff",correctLevel:QRCode.CorrectLevel.H});}
    catch(e){reject(e);return;}
    setTimeout(()=>{const canvas=stage.querySelector("canvas");const img=stage.querySelector("img");if(canvas)resolve(canvas);else if(img){const image=new Image();image.onload=()=>{const c=document.createElement("canvas");c.width=320;c.height=320;c.getContext("2d").drawImage(image,0,0,320,320);resolve(c);};image.onerror=reject;image.src=img.src;}else reject(new Error("QR no disponible"));},120);
  });
}
async function downloadQr(person){
  const canvas=await makeQrCanvas(`L100P:${person.qr_token}`);
  const a=document.createElement("a");a.download=`QR_${person.full_name.normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-zA-Z0-9_-]+/g,"_").slice(0,70)}.png`;a.href=canvas.toDataURL("image/png");a.click();
}
async function loadAttendees(){
  if(currentRole!=="admin")return;
  const {data,error}=await supabaseClient.from("attendees").select("id,full_name,organization,checked_in_at,qr_token,created_at").order("full_name");
  if(error){$("attendeesTable").innerHTML='<tr><td colspan="5">No fue posible cargar los asistentes.</td></tr>';return;}
  attendeesCache=data||[];renderAttendees();
}
function renderAttendees(){
  const rows=attendeesCache;
  const checked=rows.filter(a=>a.checked_in_at).length,total=rows.length;
  $("totalCount").textContent=total;$("checkedCount").textContent=checked;$("pendingCount").textContent=total-checked;$("attendanceRate").textContent=total?`${Math.round(checked/total*100)}%`:"0%";
  $("attendeesTable").innerHTML=rows.length?rows.map(a=>`<tr><td><strong>${escapeHtml(a.full_name)}</strong></td><td>${escapeHtml(a.organization||"—")}</td><td class="${a.checked_in_at?"state-checked":"state-pending"}">${a.checked_in_at?"Ingresó":"Pendiente"}</td><td>${escapeHtml(formatDate(a.checked_in_at))}</td><td><button class="button button-secondary" data-qr="${escapeHtml(a.id)}">Descargar QR</button></td></tr>`).join(""):'<tr><td colspan="5" class="muted">Todavía no hay invitaciones creadas.</td></tr>';
  $("attendeesTable").querySelectorAll("[data-qr]").forEach(btn=>btn.addEventListener("click",()=>{const p=attendeesCache.find(a=>a.id===btn.dataset.qr);if(p)downloadQr(p);}));
}
$("refreshBtn").addEventListener("click",loadAttendees);
let realtimeChannel=null;
function subscribeRealtime(){
  if(realtimeChannel)supabaseClient.removeChannel(realtimeChannel);
  realtimeChannel=supabaseClient.channel("admin-attendance-live")
    .on("postgres_changes",{event:"*",schema:"public",table:"attendees"},()=>loadAttendees())
    .subscribe();
}
window.addEventListener("beforeunload",()=>{if(realtimeChannel&&supabaseClient)supabaseClient.removeChannel(realtimeChannel);});
init();
