import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

const $ = id => document.getElementById(id);
const supabase = window.supabase?.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const rowDefs = [
  {row:1,left:21,right:0},{row:2,left:21,right:0},{row:3,left:21,right:0},
  {row:4,left:21,right:0},{row:5,left:21,right:0},{row:6,left:21,right:0},
  {row:7,left:15,right:9},{row:8,left:14,right:9},{row:9,left:13,right:10},
  {row:10,left:11,right:10},{row:11,left:9,right:11},{row:12,left:7,right:11}
];
const seats = [];
let sequence = 1;
rowDefs.forEach(def => {
  for(let i=0;i<def.left;i++) seats.push({id:sequence++,row:def.row,side:def.right?"izquierdo":"único",registrationIds:[]});
  for(let i=0;i<def.right;i++) seats.push({id:sequence++,row:def.row,side:"derecho",registrationIds:[]});
});
let activities=[], people=[], selectedId=null, editMode=false, direction="left", activeActivityId=null;
const directionKey = "espacioAcredita.auditorio.directions";
const escapeHtml = value => String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const personById = id => people.find(person=>person.id===id);
const seatForPerson = id => seats.find(seat=>seat.registrationIds.includes(id));
const hasConflict = seat => seat.registrationIds.length>1;
const setStatus = (message,bad=false) => { $("activityStatus").textContent=message; $("activityStatus").style.color=bad?"#a33333":""; };
function readDirections(){try{return JSON.parse(localStorage.getItem(directionKey)||"{}");}catch{return {};}}
function saveDirection(){const all=readDirections();all[activeActivityId]=direction;localStorage.setItem(directionKey,JSON.stringify(all));}
function setDirectionForActivity(id){direction=readDirections()[id]==="right"?"right":"left";renumberSeats();updateNumberingUI();}
function renumberSeats(){
  let next=1;
  rowDefs.forEach(def=>{
    const rowSeats=seats.filter(seat=>seat.row===def.row);
    (direction==="left"?rowSeats:[...rowSeats].reverse()).forEach(seat=>seat.id=next++);
  });
}
function updateNumberingUI(){
  const left=direction==="left";
  $("numberingBtn").textContent=left?"Numeración: izquierda → derecha":"Numeración: derecha → izquierda";
  $("numberingHelp").textContent=left
    ?"La numeración se asigna fila por fila, desde la izquierda hacia la derecha, mirando desde el público al escenario. En las filas 7 a 12, el conteo continúa a través de ambos bloques y el pasillo central."
    :"La numeración se asigna fila por fila, desde la derecha hacia la izquierda, mirando desde el público al escenario. En las filas 7 a 12, el conteo continúa a través de ambos bloques y el pasillo central.";
}
function updateModeUI(){
  $("modeBtn").textContent=editMode?"Salir del modo edición":"Activar modo edición";
  $("modeBtn").className=editMode?"":"primary";
  $("selectionStatus").textContent=editMode
    ?"Modo edición activo: seleccione una persona y luego un asiento para asignarla. Los cambios se guardan en Supabase."
    :"Modo consulta: pase el cursor sobre un asiento para ver quién está asignado. Los clics no modifican las asignaciones.";
}
function showSeatInfo(seat){
  const assigned=seat.registrationIds.map(personById).filter(Boolean);
  let detail=`Asiento ${seat.id} · Fila ${seat.row}`;
  if(!assigned.length) detail+=" · Disponible";
  else if(assigned.length===1) detail+=` · ${assigned[0].name} · ${assigned[0].org||"Sin organización"}`;
  else detail+=` · ⚠ CONFLICTO: ${assigned.map(person=>person.name+" ("+(person.org||"Sin organización")+")").join(" / ")}`;
  $("seatInfo").textContent=detail;
}
function renderPeople(){
  const query=$("search").value.trim().toLocaleLowerCase("es");
  const list=people.filter(person=>(person.name+" "+person.org).toLocaleLowerCase("es").includes(query));
  const conflicted=new Set(seats.filter(hasConflict).flatMap(seat=>seat.registrationIds));
  $("listCount").textContent=`${people.length} inscritos · ${people.filter(person=>seatForPerson(person.id)).length} con asiento`;
  $("peopleList").innerHTML=list.length?list.map(person=>{
    const seat=seatForPerson(person.id), bad=conflicted.has(person.id);
    const tag=bad?'<span class="seat-tag" style="color:#a84e00">⚠ Conflicto</span>':seat?`<span class="seat-tag">Fila ${seat.row} · As. ${seat.id}</span>`:"";
    return `<div class="person ${selectedId===person.id?"active":""} ${seat?"assigned":""} ${bad?"conflict":""}" data-person="${escapeHtml(person.id)}">${tag}<div class="name">${escapeHtml(person.name)}</div><div class="org">${escapeHtml(person.org||"Sin organización")}</div></div>`;
  }).join(""):'<div class="empty">No hay coincidencias.</div>';
  document.querySelectorAll("[data-person]").forEach(element=>element.addEventListener("click",()=>{
    selectedId=element.dataset.person;renderAll();
  }));
  $("unassignBtn").disabled=!selectedId||!seatForPerson(selectedId);
}
function makeSeat(seat){
  const button=document.createElement("button");
  button.type="button";button.className="seat";
  const assigned=seat.registrationIds.map(personById).filter(Boolean);
  button.innerHTML=hasConflict(seat)?`<span class="conflict-mark">⚠</span>${seat.id}`:String(seat.id);
  if(assigned.length)button.classList.add(hasConflict(seat)?"conflict":"assigned");
  if(selectedId&&seat.registrationIds.includes(selectedId))button.classList.add("selected");
  button.title=`Asiento ${seat.id} · Fila ${seat.row}${assigned.length?": "+assigned.map(person=>person.name).join(" / "):" · Disponible"}`;
  button.addEventListener("mouseenter",()=>showSeatInfo(seat));
  button.addEventListener("focus",()=>showSeatInfo(seat));
  button.addEventListener("click",async()=>{
    if(!editMode){showSeatInfo(seat);return;}
    if(!selectedId){alert("Primero seleccione una persona en la lista.");return;}
    if(seat.registrationIds.includes(selectedId))return;
    if(seat.registrationIds.length&&!confirm(`El asiento ${seat.id} ya está ocupado. ¿Desea agregar también a la persona seleccionada y registrar el conflicto?`))return;
    const previous=seatForPerson(selectedId);
    if(previous)previous.registrationIds=previous.registrationIds.filter(id=>id!==selectedId);
    seat.registrationIds.push(selectedId);
    const ok=await saveSeat(seat);
    if(!ok)await loadActivity(activeActivityId);else renderAll();
  });
  return button;
}
function renderMap(){
  const host=$("seatMap");host.innerHTML="";
  rowDefs.forEach(def=>{
    const rowSeats=seats.filter(seat=>seat.row===def.row);
    const line=document.createElement("div");line.className="rowline";
    const label=document.createElement("div");label.className="rowlabel";label.textContent=`FILA ${def.row}`;line.append(label);
    if(def.right){
      const left=document.createElement("div");left.className="side";
      rowSeats.filter(seat=>seat.side==="izquierdo").forEach(seat=>left.append(makeSeat(seat)));
      const aisle=document.createElement("div");aisle.className="aisle";aisle.textContent="PASILLO";
      const right=document.createElement("div");right.className="side";
      rowSeats.filter(seat=>seat.side==="derecho").forEach(seat=>right.append(makeSeat(seat)));
      const split=document.createElement("div");split.className="split";split.append(left,aisle,right);line.append(split);
    }else{
      const group=document.createElement("div");group.className="seats";
      rowSeats.forEach(seat=>group.append(makeSeat(seat)));line.append(group);
    }
    host.append(line);
  });
}
function renderStats(){
  const assigned=seats.filter(seat=>seat.registrationIds.length).length;
  $("totalCount").textContent=seats.length;$("assignedCount").textContent=assigned;$("freeCount").textContent=seats.length-assigned;
  $("assignedCount").title=`${seats.filter(hasConflict).length} asiento(s) con conflicto`;
}
function renderAll(){renderPeople();renderMap();renderStats();}
function findSeat(row,number){return seats.find(seat=>String(seat.row)===String(row)&&String(seat.id)===String(number));}
async function saveSeat(seat){
  const updates=seat.registrationIds.map(id=>supabase.from("registrations")
    .update({seat_row:String(seat.row),seat_number:String(seat.id)})
    .eq("id",id).eq("activity_id",activeActivityId));
  const results=await Promise.all(updates);
  const failed=results.find(result=>result.error);
  if(failed){alert("No se pudo guardar la asignación en Supabase: "+failed.error.message);return false;}
  seat.registrationIds.forEach(id=>{const person=personById(id);if(person){person.seat_row=String(seat.row);person.seat_number=String(seat.id);}});
  return true;
}
async function loadActivity(activityId){
  activeActivityId=activityId||null;selectedId=null;
  seats.forEach(seat=>seat.registrationIds=[]);people=[];
  if(!activeActivityId){setStatus("Seleccione una actividad para cargar sus inscritos.");renderAll();return;}
  setDirectionForActivity(activeActivityId);
  setStatus("Cargando inscritos desde Supabase…");
  const {data,error}=await supabase.from("registrations")
    .select("id,activity_id,seat_row,seat_number,status,attendees(full_name,organization)")
    .eq("activity_id",activeActivityId).neq("status","cancelled")
    .order("created_at",{ascending:true});
  if(error){setStatus("No se pudieron cargar los inscritos: "+error.message,true);renderAll();return;}
  people=(data||[]).map(row=>({
    id:row.id,name:row.attendees?.full_name||"Sin nombre",
    org:row.attendees?.organization||"",seat_row:row.seat_row,seat_number:row.seat_number
  }));
  let invalid=0;
  for(const person of people){
    if(person.seat_number==null||person.seat_number==="")continue;
    const seat=findSeat(person.seat_row,person.seat_number);
    if(seat)seat.registrationIds.push(person.id);else invalid++;
  }
  const assigned=people.filter(person=>seatForPerson(person.id)).length;
  setStatus(`${people.length} inscritos · ${assigned} con asiento · ${invalid} asignación(es) previas fuera del plano`);
  renderAll();
}
async function loadSession(){
  if(!supabase){setStatus("No se pudo inicializar Supabase.",true);return;}
  const {data,error}=await supabase.auth.getSession();
  if(error||!data.session){
    setStatus("No hay una sesión activa. Vuelva a Espacio Acredita e inicie sesión.",true);
    $("peopleList").innerHTML='<div class="empty">Inicie sesión primero en Espacio Acredita.</div>';
    return;
  }
  $("userLabel").textContent=data.session.user.email||"Sesión autenticada";
  const {data:rows,error:activitiesError}=await supabase.from("activities")
    .select("id,name,event_date,status").order("event_date",{ascending:false});
  if(activitiesError){setStatus("No se pudieron cargar las actividades: "+activitiesError.message,true);return;}
  activities=rows||[];
  $("activitySelect").innerHTML='<option value="">Seleccione una actividad…</option>'+activities.map(activity=>
    `<option value="${escapeHtml(activity.id)}">${escapeHtml(activity.name)} · ${activity.status==="open"?"Abierta":"Cerrada"}</option>`).join("");
  const requested=new URLSearchParams(location.search).get("activity");
  const initial=activities.some(activity=>activity.id===requested)?requested:(activities[0]?.id||"");
  $("activitySelect").value=initial;
  await loadActivity(initial);
}
async function unassignSelected(){
  if(!selectedId||!activeActivityId)return;
  const {error}=await supabase.from("registrations").update({seat_row:null,seat_number:null})
    .eq("id",selectedId).eq("activity_id",activeActivityId);
  if(error){alert("No se pudo quitar el asiento: "+error.message);return;}
  const seat=seatForPerson(selectedId);if(seat)seat.registrationIds=seat.registrationIds.filter(id=>id!==selectedId);
  const person=personById(selectedId);if(person){person.seat_row=null;person.seat_number=null;}
  renderAll();
}
async function clearActivityAssignments(){
  if(!activeActivityId)return;
  const assigned=people.filter(person=>person.seat_number!=null&&person.seat_number!=="").length;
  if(!assigned){alert("Esta actividad no tiene asientos asignados.");return;}
  if(!confirm(`¿Liberar los asientos de ${assigned} inscripción(es) de esta actividad? Los participantes se conservarán.`))return;
  const {error}=await supabase.from("registrations").update({seat_row:null,seat_number:null})
    .eq("activity_id",activeActivityId).neq("status","cancelled");
  if(error){alert("No se pudieron liberar los asientos: "+error.message);return;}
  await loadActivity(activeActivityId);
}
function csvText(){
  const rows=[["Nombre","Organización","Número de asiento","Número de fila","Conflicto"]];
  people.forEach(person=>{
    const seat=seatForPerson(person.id);
    rows.push([person.name,person.org,seat?seat.id:"",seat?seat.row:"",seat&&hasConflict(seat)?"SI":"NO"]);
  });
  return "\uFEFF"+rows.map(row=>row.map(value=>{
    const text=String(value??"");return /[",;\r\n]/.test(text)?'"'+text.replace(/"/g,'""')+'"':text;
  }).join(";")).join("\r\n");
}
function downloadCsv(isBackup=false){
  if(!people.length){alert("No hay inscritos en esta actividad para exportar.");return;}
  const blob=new Blob([csvText()],{type:"text/csv;charset=utf-8"});
  const url=URL.createObjectURL(blob),a=document.createElement("a");
  const activity=(activities.find(item=>item.id===activeActivityId)?.name||"actividad").normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-zA-Z0-9_-]+/g,"-");
  const suffix=new Date().toISOString().slice(0,10);
  a.href=url;a.download=(isBackup?"respaldo-":"asignacion-")+activity+"-"+suffix+".csv";
  document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function changeNumbering(){
  if(!activeActivityId)return;
  const anyAssigned=people.some(person=>person.seat_number!=null&&person.seat_number!=="");
  if(anyAssigned){
    alert("Para evitar cambiar el asiento físico de personas ya ubicadas, elija el sentido de numeración antes de realizar asignaciones. Para cambiarlo ahora, primero libere todos los asientos de esta actividad.");
    return;
  }
  direction=direction==="left"?"right":"left";
  renumberSeats();saveDirection();updateNumberingUI();renderAll();
}
$("activitySelect").addEventListener("change",()=>loadActivity($("activitySelect").value));
$("search").addEventListener("input",renderPeople);
$("refreshBtn").addEventListener("click",()=>loadActivity(activeActivityId));
$("modeBtn").addEventListener("click",()=>{editMode=!editMode;updateModeUI();});
$("numberingBtn").addEventListener("click",changeNumbering);
$("unassignBtn").addEventListener("click",unassignSelected);
$("clearBtn").addEventListener("click",clearActivityAssignments);
$("exportBtn").addEventListener("click",()=>downloadCsv(false));
$("backupBtn").addEventListener("click",()=>downloadCsv(true));
$("backBtn").addEventListener("click",()=>location.href="./index.html");
$("logoutBtn").addEventListener("click",async()=>{await supabase?.auth.signOut();location.href="./index.html";});
updateModeUI();updateNumberingUI();loadSession();
