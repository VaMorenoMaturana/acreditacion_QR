import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

const $ = id => document.getElementById(id);
const supabase = window.supabase?.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let activities = [];
let templates = [];
let rowDefs = [];
let seats = [];
let people = [];
let selectedId = null;
let editMode = false;
let direction = "left_to_right";
let activeActivityId = null;
let activeTemplateId = null;
let currentRole = null;
let activeLayout = null;
let editorRows = [];

const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, c => ({
  "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
}[c]));
const personById = id => people.find(person => person.id === id);
const seatForPerson = id => seats.find(seat => seat.registrationIds.includes(id));
const hasConflict = seat => seat.registrationIds.length > 1;
const setStatus = (message, bad=false) => {
  $("activityStatus").textContent = message;
  $("activityStatus").style.color = bad ? "#a33333" : "";
};
const assignedCount = () => people.filter(person => person.seat_number !== null && person.seat_number !== "").length;

function normalizeLayout(layout) {
  if (!layout || !Array.isArray(layout.rows)) return null;
  const rows = layout.rows.map(row => ({
    label: String(row.label ?? "").trim(),
    sections: Array.isArray(row.sections) ? row.sections.map(section => ({
      label: String(section.label ?? "").trim(),
      seats: Number(section.seats)
    })) : []
  }));
  if (!rows.length || rows.some(row => !row.label || !row.sections.length ||
      row.sections.some(section => !Number.isInteger(section.seats) || section.seats < 1 || section.seats > 100))) return null;
  return {
    version: 1,
    stage_label: String(layout.stage_label || "ESCENARIO"),
    aisle_label: String(layout.aisle_label || "PASILLO"),
    numbering_direction: layout.numbering_direction === "right_to_left" ? "right_to_left" : "left_to_right",
    rows
  };
}

function buildSeats() {
  seats = [];
  rowDefs.forEach((row, rowIndex) => {
    row.sections.forEach((section, sectionIndex) => {
      for (let seatIndex = 0; seatIndex < section.seats; seatIndex++) {
        seats.push({
          id: 0,
          row: row.label,
          rowIndex,
          sectionIndex,
          sectionLabel: section.label,
          seatIndex,
          registrationIds: []
        });
      }
    });
  });
  renumberSeats();
}

function renumberSeats() {
  let next = 1;
  rowDefs.forEach((row, rowIndex) => {
    const physicalRow = seats
      .filter(seat => seat.rowIndex === rowIndex)
      .sort((a, b) => a.sectionIndex - b.sectionIndex || a.seatIndex - b.seatIndex);
    const ordered = direction === "left_to_right" ? physicalRow : [...physicalRow].reverse();
    ordered.forEach(seat => { seat.id = next++; });
  });
}

function updateNumberingUI() {
  const left = direction === "left_to_right";
  $("numberingBtn").textContent = left
    ? "Numeración: izquierda → derecha"
    : "Numeración: derecha → izquierda";
  $("numberingHelp").textContent = left
    ? "La numeración se asigna fila por fila, desde la izquierda hacia la derecha."
    : "La numeración se asigna fila por fila, desde la derecha hacia la izquierda.";
  $("stageDisplay").textContent = activeLayout?.stage_label || "ESCENARIO";
  $("auditoriumHeading").textContent = templates.find(item => item.id === activeTemplateId)?.name || "Plano del auditorio";
}

function updateModeUI() {
  $("modeBtn").textContent = editMode ? "Salir del modo edición" : "Activar modo edición";
  $("modeBtn").className = editMode ? "" : "primary";
  $("selectionStatus").textContent = editMode
    ? "Modo edición activo: seleccione una persona y luego un asiento. Los cambios se guardan en su organización."
    : "Modo consulta: pase el cursor sobre un asiento para ver quién está asignado. Active el modo edición para modificar asignaciones.";
}

function showSeatInfo(seat) {
  const assigned = seat.registrationIds.map(personById).filter(Boolean);
  let detail = `Asiento ${seat.id} · Fila ${seat.row}`;
  if (seat.sectionLabel) detail += ` · ${seat.sectionLabel}`;
  if (!assigned.length) detail += " · Disponible";
  else if (assigned.length === 1) detail += ` · ${assigned[0].name} · ${assigned[0].org || "Sin organización"}`;
  else detail += ` · CONFLICTO: ${assigned.map(person => person.name).join(" / ")}`;
  $("seatInfo").textContent = detail;
}

function renderPeople() {
  const query = $("search").value.trim().toLocaleLowerCase("es");
  const list = people.filter(person => (person.name + " " + person.org).toLocaleLowerCase("es").includes(query));
  const conflicted = new Set(seats.filter(hasConflict).flatMap(seat => seat.registrationIds));
  $("listCount").textContent = `${people.length} inscritos · ${people.filter(person => seatForPerson(person.id)).length} con asiento`;
  $("peopleList").innerHTML = list.length ? list.map(person => {
    const seat = seatForPerson(person.id), bad = conflicted.has(person.id);
    const tag = bad
      ? '<span class="seat-tag" style="color:#a84e00">⚠ Conflicto</span>'
      : seat ? `<span class="seat-tag">Fila ${seat.row} · As. ${seat.id}</span>` : "";
    return `<div class="person ${selectedId === person.id ? "active" : ""} ${seat ? "assigned" : ""} ${bad ? "conflict" : ""}" data-person="${escapeHtml(person.id)}">${tag}<div class="name">${escapeHtml(person.name)}</div><div class="org">${escapeHtml(person.org || "Sin organización")}</div></div>`;
  }).join("") : '<div class="empty">No hay coincidencias.</div>';
  document.querySelectorAll("[data-person]").forEach(element => element.addEventListener("click", () => {
    selectedId = element.dataset.person;
    renderAll();
  }));
  $("unassignBtn").disabled = !selectedId || !seatForPerson(selectedId);
}

function makeSeat(seat) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "seat";
  const assigned = seat.registrationIds.map(personById).filter(Boolean);
  button.innerHTML = hasConflict(seat) ? `<span class="conflict-mark">⚠</span>${seat.id}` : String(seat.id);
  if (assigned.length) button.classList.add(hasConflict(seat) ? "conflict" : "assigned");
  if (selectedId && seat.registrationIds.includes(selectedId)) button.classList.add("selected");
  button.title = `Asiento ${seat.id} · Fila ${seat.row}${seat.sectionLabel ? " · " + seat.sectionLabel : ""}${assigned.length ? ": " + assigned.map(person => person.name).join(" / ") : " · Disponible"}`;
  button.addEventListener("mouseenter", () => showSeatInfo(seat));
  button.addEventListener("focus", () => showSeatInfo(seat));
  button.addEventListener("click", async () => {
    if (!editMode) { showSeatInfo(seat); return; }
    if (!selectedId) { alert("Primero seleccione una persona en la lista."); return; }
    if (seat.registrationIds.includes(selectedId)) return;
    if (seat.registrationIds.length && !confirm(`El asiento ${seat.id} ya está ocupado. ¿Desea agregar también a la persona seleccionada y registrar el conflicto?`)) return;
    const previous = seatForPerson(selectedId);
    if (previous) previous.registrationIds = previous.registrationIds.filter(id => id !== selectedId);
    seat.registrationIds.push(selectedId);
    const ok = await saveSeat(seat);
    if (!ok) await loadActivity(activeActivityId);
    else renderAll();
  });
  return button;
}

function renderMap() {
  const host = $("seatMap");
  host.innerHTML = "";
  rowDefs.forEach((def, rowIndex) => {
    const line = document.createElement("div");
    line.className = "rowline";
    const label = document.createElement("div");
    label.className = "rowlabel";
    label.textContent = `FILA ${def.label}`;
    line.append(label);

    if (def.sections.length > 1) {
      const split = document.createElement("div");
      split.className = "split";
      def.sections.forEach((section, sectionIndex) => {
        const group = document.createElement("div");
        group.className = "side";
        const sectionLabel = document.createElement("div");
        sectionLabel.className = "section-label";
        sectionLabel.textContent = section.label || `Bloque ${sectionIndex + 1}`;
        const sectionSeats = seats
          .filter(seat => seat.rowIndex === rowIndex && seat.sectionIndex === sectionIndex)
          .sort((a, b) => a.seatIndex - b.seatIndex);
        sectionSeats.forEach(seat => group.append(makeSeat(seat)));
        const wrapper = document.createElement("div");
        wrapper.className = "seat-section";
        wrapper.append(sectionLabel, group);
        split.append(wrapper);
        if (sectionIndex < def.sections.length - 1) {
          const aisle = document.createElement("div");
          aisle.className = "aisle";
          aisle.textContent = activeLayout?.aisle_label || "PASILLO";
          split.append(aisle);
        }
      });
      line.append(split);
    } else {
      const group = document.createElement("div");
      group.className = "seats";
      seats.filter(seat => seat.rowIndex === rowIndex).sort((a, b) => a.seatIndex - b.seatIndex)
        .forEach(seat => group.append(makeSeat(seat)));
      line.append(group);
    }
    host.append(line);
  });
}

function renderStats() {
  const assigned = seats.filter(seat => seat.registrationIds.length).length;
  const total = seats.length;
  $("totalCount").textContent = total;
  $("assignedCount").textContent = assigned;
  $("freeCount").textContent = Math.max(0, total - assigned);
  $("assignedCount").title = `${seats.filter(hasConflict).length} asiento(s) con conflicto`;
}

function renderAll() {
  renderPeople();
  renderMap();
  renderStats();
}

function findSeat(row, number) {
  return seats.find(seat => String(seat.row) === String(row) && String(seat.id) === String(number));
}

async function saveSeat(seat) {
  const { error } = await supabase.from("registrations")
    .update({ seat_row: String(seat.row), seat_number: String(seat.id) })
    .in("id", seat.registrationIds)
    .eq("activity_id", activeActivityId);
  if (error) { alert("No se pudo guardar la asignación en Supabase: " + error.message); return false; }
  seat.registrationIds.forEach(id => {
    const person = personById(id);
    if (person) { person.seat_row = String(seat.row); person.seat_number = String(seat.id); }
  });
  return true;
}

async function loadActivityRegistrations(activityId) {
  const { data, error } = await supabase.from("registrations")
    .select("id,activity_id,seat_row,seat_number,status,attendees(full_name,organization)")
    .eq("activity_id", activityId)
    .neq("status", "cancelled")
    .order("created_at", { ascending: true });
  if (error) {
    setStatus("No se pudieron cargar los inscritos: " + error.message, true);
    return false;
  }
  people = (data || []).map(row => ({
    id: row.id,
    name: row.attendees?.full_name || "Sin nombre",
    org: row.attendees?.organization || "",
    seat_row: row.seat_row,
    seat_number: row.seat_number
  }));
  let invalid = 0;
  for (const person of people) {
    if (person.seat_number == null || person.seat_number === "") continue;
    const seat = findSeat(person.seat_row, person.seat_number);
    if (seat) seat.registrationIds.push(person.id);
    else invalid++;
  }
  const assigned = people.filter(person => seatForPerson(person.id)).length;
  setStatus(`${people.length} inscritos · ${assigned} con asiento · ${invalid} asignación(es) previas fuera del plano`);
  return true;
}

async function loadActivity(activityId) {
  activeActivityId = activityId || null;
  selectedId = null;
  people = [];
  if (!activeActivityId) {
    activeTemplateId = null; activeLayout = null; rowDefs = []; seats = [];
    setStatus("Seleccione una actividad para cargar sus inscritos.");
    renderAll(); updateNumberingUI(); return;
  }

  const activity = activities.find(item => item.id === activeActivityId);
  if (!activity) return;
  activeTemplateId = activity.auditorium_template_id || null;
  $("auditoriumSelect").value = activeTemplateId || "";
  const template = templates.find(item => item.id === activeTemplateId);
  if (!template) {
    activeLayout = null; rowDefs = []; seats = [];
    setStatus("Esta actividad no tiene una plantilla de auditorio. Cree una o seleccione una guardada y aplíquela.", true);
    renderAll(); updateNumberingUI(); return;
  }

  activeLayout = normalizeLayout(template.layout);
  if (!activeLayout) {
    activeLayout = null; rowDefs = []; seats = [];
    setStatus("La plantilla seleccionada tiene una distribución no válida.", true);
    renderAll(); updateNumberingUI(); return;
  }

  rowDefs = activeLayout.rows;
  direction = activity.seat_numbering_direction ||
    (activeLayout.numbering_direction === "right_to_left" ? "right_to_left" : "left_to_right");
  buildSeats();
  updateNumberingUI();
  setStatus("Cargando inscritos desde Supabase…");
  const ok = await loadActivityRegistrations(activeActivityId);
  if (!ok) { renderAll(); return; }
  renderAll();
}

function renderTemplateOptions() {
  const old = $("auditoriumSelect").value;
  $("auditoriumSelect").innerHTML = '<option value="">Seleccione una plantilla…</option>' +
    templates.map(template => `<option value="${escapeHtml(template.id)}">${escapeHtml(template.name)}</option>`).join("");
  if (templates.some(template => template.id === old)) $("auditoriumSelect").value = old;
  $("deleteAuditoriumBtn").disabled = currentRole !== "admin" || !templates.length || !templates.some(item => item.id === $("auditoriumSelect").value);
}

function renderActivityOptions() {
  $("activitySelect").innerHTML = '<option value="">Seleccione una actividad…</option>' +
    activities.map(activity => `<option value="${escapeHtml(activity.id)}">${escapeHtml(activity.name)} · ${activity.status === "open" ? "Abierta" : "Cerrada"}</option>`).join("");
}

async function applySelectedTemplate() {
  const templateId = $("auditoriumSelect").value;
  const template = templates.find(item => item.id === templateId);
  if (!activeActivityId) { setStatus("Seleccione primero una actividad.", true); return; }
  if (!template) { setStatus("Seleccione un auditorio guardado.", true); return; }
  if (templateId === activeTemplateId) { setStatus("Este auditorio ya está asignado a la actividad."); return; }
  if (assignedCount() > 0) {
    alert("Esta actividad ya tiene asientos asignados. Para proteger las ubicaciones existentes, primero libere todas las asignaciones antes de cambiar de auditorio.");
    $("auditoriumSelect").value = activeTemplateId || "";
    return;
  }
  const layout = normalizeLayout(template.layout);
  if (!layout) { setStatus("La plantilla seleccionada no contiene una distribución válida.", true); return; }
  const { error } = await supabase.from("activities").update({
    auditorium_template_id: template.id,
    seat_numbering_direction: layout.numbering_direction
  }).eq("id", activeActivityId);
  if (error) { setStatus("No se pudo asignar el auditorio: " + error.message, true); $("auditoriumSelect").value = activeTemplateId || ""; return; }
  activities = activities.map(item => item.id === activeActivityId
    ? { ...item, auditorium_template_id: template.id, seat_numbering_direction: layout.numbering_direction } : item);
  await loadActivity(activeActivityId);
}

function startNewTemplate() {
  editorRows = Array.from({ length: 5 }, (_, index) => ({
    label: String(index + 1),
    sections: [{ label: "Único", seats: 10 }]
  }));
  $("templateName").value = "";
  $("templateDescription").value = "";
  $("stageLabel").value = "ESCENARIO";
  $("aisleLabel").value = "PASILLO";
  $("templateEditor").classList.remove("hidden");
  renderLayoutEditor();
  $("templateName").focus();
}

function renderLayoutEditor() {
  $("layoutRows").innerHTML = editorRows.map((row, rowIndex) => `
    <div class="layout-row-editor" data-layout-row="${rowIndex}">
      <div class="layout-row-head">
        <label>Identificador de fila
          <input type="text" maxlength="40" data-row-label="${rowIndex}" value="${escapeHtml(row.label)}">
        </label>
        <button type="button" class="danger" data-remove-row="${rowIndex}" title="Eliminar fila">Quitar</button>
      </div>
      <div class="layout-sections">
        ${row.sections.map((section, sectionIndex) => `
          <div class="layout-section">
            <label>Nombre del bloque
              <input type="text" maxlength="40" data-section-label="${rowIndex}:${sectionIndex}" value="${escapeHtml(section.label)}">
            </label>
            <label>Asientos
              <input type="number" min="1" max="100" data-section-seats="${rowIndex}:${sectionIndex}" value="${section.seats}">
            </label>
            <button type="button" class="danger" data-remove-section="${rowIndex}:${sectionIndex}" ${row.sections.length === 1 ? "disabled" : ""}>Quitar</button>
          </div>
        `).join("")}
      </div>
      <div class="row-builder-actions">
        <button type="button" class="row-add-section" data-add-section="${rowIndex}">+ Agregar bloque / pasillo</button>
      </div>
    </div>
  `).join("");
  const totalRows = editorRows.length;
  const totalSeats = editorRows.reduce((total, row) =>
    total + row.sections.reduce((sum, section) => sum + (Number(section.seats) || 0), 0), 0);
  $("layoutSummary").textContent = `${totalRows} filas · ${totalSeats} asientos configurados`;
}

function handleLayoutEditorChange(event) {
  const target = event.target;
  if (target.matches("[data-row-label]")) {
    editorRows[Number(target.dataset.rowLabel)].label = target.value;
  } else if (target.matches("[data-section-label]")) {
    const [rowIndex, sectionIndex] = target.dataset.sectionLabel.split(":").map(Number);
    editorRows[rowIndex].sections[sectionIndex].label = target.value;
  } else if (target.matches("[data-section-seats]")) {
    const [rowIndex, sectionIndex] = target.dataset.sectionSeats.split(":").map(Number);
    editorRows[rowIndex].sections[sectionIndex].seats = Number(target.value);
  }
  renderLayoutSummaryOnly();
}

function renderLayoutSummaryOnly() {
  const totalSeats = editorRows.reduce((total, row) =>
    total + row.sections.reduce((sum, section) => sum + (Number(section.seats) || 0), 0), 0);
  $("layoutSummary").textContent = `${editorRows.length} filas · ${totalSeats} asientos configurados`;
}

function handleLayoutEditorClick(event) {
  const target = event.target.closest("button");
  if (!target) return;
  if (target.dataset.addSection !== undefined) {
    editorRows[Number(target.dataset.addSection)].sections.push({ label: `Bloque ${editorRows[Number(target.dataset.addSection)].sections.length + 1}`, seats: 10 });
    renderLayoutEditor();
  } else if (target.dataset.removeSection !== undefined) {
    const [rowIndex, sectionIndex] = target.dataset.removeSection.split(":").map(Number);
    if (editorRows[rowIndex].sections.length > 1) editorRows[rowIndex].sections.splice(sectionIndex, 1);
    renderLayoutEditor();
  } else if (target.dataset.removeRow !== undefined) {
    editorRows.splice(Number(target.dataset.removeRow), 1);
    renderLayoutEditor();
  }
}

function validateEditorLayout() {
  const name = $("templateName").value.trim();
  if (name.length < 2 || name.length > 120) return { error: "El nombre del auditorio debe tener entre 2 y 120 caracteres." };
  if (!editorRows.length || editorRows.length > 100) return { error: "El auditorio debe tener entre 1 y 100 filas." };
  const labels = editorRows.map(row => row.label.trim().toLocaleLowerCase("es"));
  if (labels.some(label => !label) || new Set(labels).size !== labels.length) {
    return { error: "Cada fila debe tener un identificador único." };
  }
  let totalSeats = 0;
  for (const row of editorRows) {
    if (!row.sections.length || row.sections.length > 6) return { error: `La fila ${row.label} debe tener entre 1 y 6 bloques.` };
    for (const section of row.sections) {
      if (!Number.isInteger(Number(section.seats)) || Number(section.seats) < 1 || Number(section.seats) > 100) {
        return { error: `Revise los asientos configurados en la fila ${row.label}. Cada bloque admite entre 1 y 100.` };
      }
      totalSeats += Number(section.seats);
    }
  }
  if (totalSeats > 3000) return { error: "El auditorio no puede superar los 3.000 asientos." };
  return {
    name,
    layout: {
      version: 1,
      stage_label: $("stageLabel").value.trim() || "ESCENARIO",
      aisle_label: $("aisleLabel").value.trim() || "PASILLO",
      numbering_direction: "left_to_right",
      rows: editorRows.map(row => ({
        label: row.label.trim(),
        sections: row.sections.map(section => ({
          label: section.label.trim(),
          seats: Number(section.seats)
        }))
      }))
    }
  };
}

async function saveNewTemplate() {
  const result = validateEditorLayout();
  if (result.error) { $("templateMessage").textContent = result.error; return; }
  const button = $("saveTemplateBtn");
  button.disabled = true;
  button.textContent = "Guardando…";
  const { data, error } = await supabase.from("auditorium_templates")
    .insert({
      name: result.name,
      description: $("templateDescription").value.trim() || null,
      layout: result.layout
    })
    .select("id,name,description,layout")
    .single();
  button.disabled = false;
  button.textContent = "Guardar auditorio";
  if (error) {
    $("templateMessage").textContent = "No se pudo guardar el auditorio: " + error.message;
    return;
  }
  templates = [...templates, data].sort((a, b) => a.name.localeCompare(b.name, "es"));
  renderTemplateOptions();
  $("auditoriumSelect").value = data.id;
  $("templateEditor").classList.add("hidden");
  if (activeActivityId && assignedCount() === 0) {
    await applySelectedTemplate();
    setStatus(`Auditorio «${data.name}» guardado y asignado a esta actividad.`);
  } else {
    $("auditoriumSelect").value = activeTemplateId || "";
    setStatus(`Auditorio «${data.name}» guardado para reutilizarlo. Esta actividad conserva su plantilla actual porque ya tiene asientos asignados.`);
  }
}

async function deleteSelectedTemplate() {
  const templateId = $("auditoriumSelect").value;
  const template = templates.find(item => item.id === templateId);
  if (!template) return;
  const used = activities.filter(activity => activity.auditorium_template_id === templateId);
  if (used.length) {
    alert(`No se puede eliminar «${template.name}»: está asignado a ${used.length} actividad(es). Cambie primero el auditorio de esas actividades.`);
    return;
  }
  if (!confirm(`¿Eliminar definitivamente la plantilla «${template.name}»? Las asignaciones de las actividades no se modificarán.`)) return;
  const { error } = await supabase.from("auditorium_templates").delete().eq("id", templateId);
  if (error) { alert("No se pudo eliminar la plantilla: " + error.message); return; }
  templates = templates.filter(item => item.id !== templateId);
  renderTemplateOptions();
  setStatus("Plantilla eliminada.");
}

async function unassignSelected() {
  if (!selectedId || !activeActivityId) return;
  const { error } = await supabase.from("registrations").update({ seat_row: null, seat_number: null })
    .eq("id", selectedId).eq("activity_id", activeActivityId);
  if (error) { alert("No se pudo quitar el asiento: " + error.message); return; }
  const seat = seatForPerson(selectedId);
  if (seat) seat.registrationIds = seat.registrationIds.filter(id => id !== selectedId);
  const person = personById(selectedId);
  if (person) { person.seat_row = null; person.seat_number = null; }
  renderAll();
}

async function clearActivityAssignments() {
  if (!activeActivityId) return;
  const assigned = assignedCount();
  if (!assigned) { alert("Esta actividad no tiene asientos asignados."); return; }
  if (!confirm(`¿Liberar los asientos de ${assigned} inscripción(es) de esta actividad? Los participantes se conservarán.`)) return;
  const { error } = await supabase.from("registrations").update({ seat_row: null, seat_number: null })
    .eq("activity_id", activeActivityId).neq("status", "cancelled");
  if (error) { alert("No se pudieron liberar los asientos: " + error.message); return; }
  await loadActivity(activeActivityId);
}

function csvText() {
  const rows = [["Nombre", "Organización", "Número de asiento", "Número de fila", "Conflicto"]];
  people.forEach(person => {
    const seat = seatForPerson(person.id);
    rows.push([person.name, person.org, seat ? seat.id : (person.seat_number || ""),
      seat ? seat.row : (person.seat_row || ""), seat && hasConflict(seat) ? "SI" : "NO"]);
  });
  return "\uFEFF" + rows.map(row => row.map(value => {
    const text = String(value ?? "");
    return /[",;\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
  }).join(";")).join("\r\n");
}

function downloadCsv(isBackup=false) {
  if (!people.length) { alert("No hay inscritos en esta actividad para exportar."); return; }
  const blob = new Blob([csvText()], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob), a = document.createElement("a");
  const activity = (activities.find(item => item.id === activeActivityId)?.name || "actividad")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9_-]+/g, "-");
  const suffix = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = (isBackup ? "respaldo-" : "asignacion-") + activity + "-" + suffix + ".csv";
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function changeNumbering() {
  if (!activeActivityId) return;
  if (assignedCount() > 0) {
    alert("Para evitar cambiar el asiento físico de personas ya ubicadas, elija el sentido de numeración antes de asignar asientos. Para cambiarlo ahora, primero libere todas las asignaciones de esta actividad.");
    return;
  }
  direction = direction === "left_to_right" ? "right_to_left" : "left_to_right";
  const { error } = await supabase.from("activities")
    .update({ seat_numbering_direction: direction })
    .eq("id", activeActivityId);
  if (error) { alert("No se pudo guardar el sentido de numeración: " + error.message); return; }
  const activity = activities.find(item => item.id === activeActivityId);
  if (activity) activity.seat_numbering_direction = direction;
  renumberSeats(); updateNumberingUI(); renderAll();
}

async function loadSession() {
  if (!supabase) { setStatus("No se pudo inicializar Supabase.", true); return; }
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) {
    setStatus("No hay una sesión activa. Vuelva a Espacio Acredita e inicie sesión.", true);
    $("peopleList").innerHTML = '<div class="empty">Inicie sesión primero en Espacio Acredita.</div>';
    return;
  }

  const { data: profile, error: profileError } = await supabase.from("profiles")
    .select("id,role,organization_id,organizations(name)")
    .eq("id", data.session.user.id).maybeSingle();
  if (profileError || !profile || !profile.organization_id || !["staff", "admin"].includes(profile.role)) {
    setStatus("La cuenta no tiene permisos de personal para gestionar auditorios.", true);
    $("peopleList").innerHTML = '<div class="empty">Acceso no autorizado. Vuelva a Espacio Acredita.</div>';
    return;
  }
  currentRole = profile.role;
  $("userLabel").textContent = [data.session.user.email, profile.organizations?.name].filter(Boolean).join(" · ");

  const [activityResult, templateResult] = await Promise.all([
    supabase.from("activities")
      .select("id,name,event_date,status,auditorium_template_id,seat_numbering_direction")
      .order("event_date", { ascending: false }),
    supabase.from("auditorium_templates")
      .select("id,name,description,layout")
      .order("name", { ascending: true })
  ]);
  if (activityResult.error) { setStatus("No se pudieron cargar las actividades: " + activityResult.error.message, true); return; }
  if (templateResult.error) { setStatus("No se pudieron cargar los auditorios: " + templateResult.error.message, true); return; }
  activities = activityResult.data || [];
  templates = templateResult.data || [];
  renderActivityOptions();
  renderTemplateOptions();

  const requested = new URLSearchParams(location.search).get("activity");
  const initial = activities.some(activity => activity.id === requested)
    ? requested : (activities[0]?.id || "");
  $("activitySelect").value = initial;
  await loadActivity(initial);
}

$("activitySelect").addEventListener("change", () => loadActivity($("activitySelect").value));
$("auditoriumSelect").addEventListener("change", () => {});
$("applyAuditoriumBtn").addEventListener("click", applySelectedTemplate);
$("createAuditoriumBtn").addEventListener("click", () => {
  if ($("templateEditor").classList.contains("hidden")) startNewTemplate();
  else $("templateEditor").classList.add("hidden");
});
$("deleteAuditoriumBtn").addEventListener("click", deleteSelectedTemplate);
$("addLayoutRowBtn").addEventListener("click", () => {
  const used = new Set(editorRows.map(row => row.label));
  let next = 1;
  while (used.has(String(next))) next++;
  editorRows.push({ label: String(next), sections: [{ label: "Único", seats: 10 }] });
  renderLayoutEditor();
});
$("saveTemplateBtn").addEventListener("click", saveNewTemplate);
$("cancelTemplateBtn").addEventListener("click", () => $("templateEditor").classList.add("hidden"));
$("layoutRows").addEventListener("change", handleLayoutEditorChange);
$("layoutRows").addEventListener("click", handleLayoutEditorClick);
$("search").addEventListener("input", renderPeople);
$("refreshBtn").addEventListener("click", () => loadActivity(activeActivityId));
$("modeBtn").addEventListener("click", () => { editMode = !editMode; updateModeUI(); });
$("numberingBtn").addEventListener("click", changeNumbering);
$("unassignBtn").addEventListener("click", unassignSelected);
$("clearBtn").addEventListener("click", clearActivityAssignments);
$("exportBtn").addEventListener("click", () => downloadCsv(false));
$("backupBtn").addEventListener("click", () => downloadCsv(true));
$("backBtn").addEventListener("click", () => location.href = "./index.html");
$("logoutBtn").addEventListener("click", async () => {
  await supabase?.auth.signOut();
  location.href = "./index.html";
});

updateModeUI();
loadSession();
