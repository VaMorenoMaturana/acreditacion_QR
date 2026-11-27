const FIELD_LABELS = {
  eventName: "Nombre del evento",
  eventDescription: "Descripción del evento",
  attendeeName: "Nombre del participante",
  organization: "Organización del participante",
  date: "Fecha",
  time: "Horario",
  place: "Lugar",
  row: "Fila",
  seat: "Asiento",
  accessLabel: "Texto de acceso",
  website: "Sitio web",
};
const ALLOWED_FIELDS = new Set(Object.keys(FIELD_LABELS));
const ALLOWED_FONTS = new Set(["Arial", "Georgia", "Inter", "Verdana", "Times New Roman", "Trebuchet MS", "Courier New"]);
const ALLOWED_TYPES = new Set(["field", "text", "logo", "qr", "shape"]);
const clamp = (value, min, max, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
const validColor = (value, fallback) => /^#[0-9a-f]{6}$/i.test(String(value || "")) ? value : fallback;
const newId = () => (globalThis.crypto?.randomUUID ? crypto.randomUUID() : "el-" + Math.random().toString(36).slice(2));

export function createDefaultTicketDesign() {
  return {
    version: 1,
    widthMm: 200,
    heightMm: 124,
    backgroundType: "gradient",
    backgroundColor: "#17253d",
    backgroundColor2: "#436b83",
    gradientAngle: 120,
    pattern: "none",
    cornerStyle: "rounded",
    cornerRadiusMm: 3,
    borderWidthMm: 0,
    borderColor: "#ffffff",
    elements: [
      { id: newId(), type: "shape", shape: "rect", x: 0, y: 0, w: 2.2, h: 100, fill: "#83b6d0", stroke: "#83b6d0", strokeWidth: 0, radius: 0, z: 1 },
      { id: newId(), type: "field", field: "eventName", x: 10, y: 8, w: 78, h: 17, fontSize: 36, fontFamily: "Arial", fontWeight: "700", color: "#ffffff", align: "center", valign: "middle", z: 3 },
      { id: newId(), type: "field", field: "eventDescription", x: 14, y: 26, w: 70, h: 9, fontSize: 16, fontFamily: "Arial", fontWeight: "400", color: "#e2eaf0", align: "center", valign: "middle", z: 3 },
      { id: newId(), type: "field", field: "attendeeName", x: 10, y: 43, w: 60, h: 12, fontSize: 27, fontFamily: "Arial", fontWeight: "700", color: "#ffffff", align: "left", valign: "middle", z: 3 },
      { id: newId(), type: "field", field: "organization", x: 10, y: 55, w: 60, h: 7, fontSize: 15, fontFamily: "Arial", fontWeight: "400", color: "#d9e2e8", align: "left", valign: "middle", z: 3 },
      { id: newId(), type: "field", field: "date", x: 10, y: 72, w: 23, h: 7, fontSize: 16, fontFamily: "Arial", fontWeight: "600", color: "#ffffff", align: "left", valign: "middle", z: 3 },
      { id: newId(), type: "field", field: "time", x: 36, y: 72, w: 20, h: 7, fontSize: 16, fontFamily: "Arial", fontWeight: "600", color: "#ffffff", align: "left", valign: "middle", z: 3 },
      { id: newId(), type: "field", field: "place", x: 10, y: 81, w: 50, h: 10, fontSize: 15, fontFamily: "Arial", fontWeight: "400", color: "#ffffff", align: "left", valign: "middle", z: 3 },
      { id: newId(), type: "field", field: "row", x: 67, y: 77, w: 10, h: 7, fontSize: 16, fontFamily: "Arial", fontWeight: "700", color: "#ffffff", align: "center", valign: "middle", z: 3 },
      { id: newId(), type: "field", field: "seat", x: 78, y: 77, w: 10, h: 7, fontSize: 16, fontFamily: "Arial", fontWeight: "700", color: "#ffffff", align: "center", valign: "middle", z: 3 },
      { id: newId(), type: "qr", x: 76, y: 20, w: 16, h: 26, z: 5, backgroundColor: "#ffffff", radius: 3, borderColor: "#ffffff", borderWidth: 1 },
    ],
  };
}

export function normalizeTicketDesign(value) {
  const source = value && typeof value === "object" ? value : createDefaultTicketDesign();
  const base = createDefaultTicketDesign();
  const widthMm = clamp(source.widthMm, 80, 350, base.widthMm);
  const heightMm = clamp(source.heightMm, 60, 350, base.heightMm);
  const elements = Array.isArray(source.elements) ? source.elements.slice(0, 32) : base.elements;
  return {
    version: 1,
    widthMm,
    heightMm,
    backgroundType: ["solid", "gradient"].includes(source.backgroundType) ? source.backgroundType : "solid",
    backgroundColor: validColor(source.backgroundColor, base.backgroundColor),
    backgroundColor2: validColor(source.backgroundColor2, base.backgroundColor2),
    backgroundImage: typeof source.backgroundImage === "string" && /^data:image\/(png|jpeg|webp);base64,/i.test(source.backgroundImage) ? source.backgroundImage.slice(0, 1000000) : "",
    gradientAngle: clamp(source.gradientAngle, 0, 360, 120),
    pattern: ["none", "grid", "dots", "diagonal"].includes(source.pattern) ? source.pattern : "none",
    cornerStyle: ["square", "rounded", "ticket"].includes(source.cornerStyle) ? source.cornerStyle : "rounded",
    cornerRadiusMm: clamp(source.cornerRadiusMm, 0, 25, 3),
    borderWidthMm: clamp(source.borderWidthMm, 0, 8, 0),
    borderColor: validColor(source.borderColor, "#ffffff"),
    elements: elements.map((item, index) => {
      const e = item && typeof item === "object" ? item : {};
      const type = ALLOWED_TYPES.has(e.type) ? e.type : "text";
      const normalized = {
        id: String(e.id || "element-" + index).slice(0, 60),
        type,
        x: clamp(e.x, 0, 100, 10),
        y: clamp(e.y, 0, 100, 10),
        w: clamp(e.w, 1, 100, 25),
        h: clamp(e.h, 1, 100, 10),
        z: clamp(e.z, 1, 100, index + 1),
        fontSize: clamp(e.fontSize, 6, 120, 24),
        fontFamily: ALLOWED_FONTS.has(e.fontFamily) ? e.fontFamily : "Arial",
        fontWeight: ["400", "500", "600", "700", "800"].includes(String(e.fontWeight)) ? String(e.fontWeight) : "400",
        color: validColor(e.color, "#ffffff"),
        align: ["left", "center", "right"].includes(e.align) ? e.align : "left",
        valign: ["top", "middle", "bottom"].includes(e.valign) ? e.valign : "middle",
        backgroundColor: validColor(e.backgroundColor, "#ffffff"),
        borderColor: validColor(e.borderColor, "#ffffff"),
        borderWidth: clamp(e.borderWidth, 0, 12, 0),
        radius: clamp(e.radius, 0, 50, 0),
        opacity: clamp(e.opacity, 0, 1, 1),
      };
      if (type === "field") normalized.field = ALLOWED_FIELDS.has(e.field) ? e.field : "attendeeName";
      if (type === "text") normalized.text = String(e.text ?? "Texto").slice(0, 500);
      if (type === "logo") {
        normalized.source = ["institution", "project", "partner", "custom"].includes(e.source) ? e.source : "institution";
        normalized.src = normalized.source === "custom" && typeof e.src === "string" && /^data:image\/(png|jpeg|webp|gif);base64,/i.test(e.src) ? e.src.slice(0, 450000) : "";
        normalized.fit = e.fit === "cover" ? "cover" : "contain";
      }
      if (type === "shape") {
        normalized.shape = ["rect", "circle", "line"].includes(e.shape) ? e.shape : "rect";
        normalized.fill = validColor(e.fill, "#83b6d0");
        normalized.stroke = validColor(e.stroke, "#ffffff");
        normalized.strokeWidth = clamp(e.strokeWidth, 0, 12, 0);
      }
      if (type === "qr") {
        normalized.backgroundColor = validColor(e.backgroundColor, "#ffffff");
        normalized.borderColor = validColor(e.borderColor, "#ffffff");
        normalized.borderWidth = clamp(e.borderWidth, 0, 12, 1);
        normalized.radius = clamp(e.radius, 0, 30, 3);
      }
      return normalized;
    }),
  };
}

const FIELD_VALUES = data => ({
  eventName: data.eventName || "Nombre del evento",
  eventDescription: data.eventDescription || "Descripción del evento",
  attendeeName: data.attendeeName || "Nombre del participante",
  organization: data.organization || "",
  date: data.date || "Fecha del evento",
  time: data.time || "Horario",
  place: data.place || "Lugar",
  row: data.row ? "FILA " + data.row : "",
  seat: data.seat ? "ASIENTO " + data.seat : "",
  accessLabel: data.accessLabel || "ACCESO ÚNICO",
  website: data.website || "www.ejemplo.cl",
});

export function renderTicketDesign(value, data = {}, options = {}) {
  const design = normalizeTicketDesign(value);
  const print = options.print === true;
  const editor = options.editor === true;
  const selectedId = options.selectedId || "";
  const widthMm = design.widthMm;
  const heightMm = design.heightMm;
  const root = document.createElement("article");
  root.className = "ticket ticket-custom";
  root.style.position = "relative";
  root.style.width = print ? widthMm + "mm" : "900px";
  root.style.height = print ? heightMm + "mm" : (900 * heightMm / widthMm) + "px";
  root.style.overflow = "hidden";
  root.style.boxSizing = "border-box";
  root.style.isolation = "isolate";
  root.style.backgroundColor = design.backgroundColor;
  root.style.backgroundImage = design.backgroundImage
    ? `url("${design.backgroundImage}")`
    : (design.backgroundType === "gradient" ? "linear-gradient(" + design.gradientAngle + "deg," + design.backgroundColor + "," + design.backgroundColor2 + ")" : "none");
  root.style.backgroundSize = "cover";
  root.style.backgroundPosition = "center";
  root.style.backgroundRepeat = "no-repeat";
  root.style.border = design.borderWidthMm + (print ? "mm " : "px ") + "solid " + design.borderColor;
  root.style.borderRadius = design.cornerStyle === "rounded"
    ? design.cornerRadiusMm + (print ? "mm" : "px")
    : "0";
  if (design.cornerStyle === "ticket") {
    root.style.clipPath = "polygon(0 0, 96% 0, 100% 7%, 100% 93%, 96% 100%, 0 100%, 0 0)";
  }
  root.dataset.pageWidthMm = String(widthMm);
  root.dataset.pageHeightMm = String(heightMm);
  root.dataset.ticketCustom = "true";
  if (design.pattern !== "none") {
    const pattern = document.createElement("div");
    pattern.setAttribute("aria-hidden", "true");
    pattern.style.cssText = "position:absolute;inset:0;pointer-events:none;z-index:0;";
    if (design.pattern === "grid") {
      pattern.style.backgroundImage = "linear-gradient(#ffffff18 1px,transparent 1px),linear-gradient(90deg,#ffffff18 1px,transparent 1px)";
      pattern.style.backgroundSize = print ? "6mm 6mm" : "27px 27px";
    } else if (design.pattern === "dots") {
      pattern.style.backgroundImage = "radial-gradient(#ffffff35 1px,transparent 1.5px)";
      pattern.style.backgroundSize = print ? "5mm 5mm" : "22px 22px";
    } else {
      pattern.style.backgroundImage = "repeating-linear-gradient(135deg,#ffffff18 0 1px,transparent 1px 10px)";
    }
    root.appendChild(pattern);
  }
  const fields = FIELD_VALUES(data);
  const logoSources = data.logos || {};
  for (const element of design.elements) {
    const node = document.createElement("div");
    node.className = "ticket-design-item" + (editor && selectedId === element.id ? " selected" : "");
    node.dataset.designId = element.id;
    node.dataset.designType = element.type;
    node.style.position = "absolute";
    node.style.left = element.x + "%";
    node.style.top = element.y + "%";
    node.style.width = element.w + "%";
    node.style.height = element.h + "%";
    node.style.zIndex = String(element.z || 1);
    node.style.boxSizing = "border-box";
    node.style.opacity = String(element.opacity ?? 1);
    node.style.overflow = "hidden";
    if (element.type === "field" || element.type === "text") {
      const text = document.createElement("div");
      text.textContent = element.type === "field" ? fields[element.field] : element.text;
      text.style.width = "100%";
      text.style.height = "100%";
      text.style.display = "flex";
      text.style.alignItems = element.valign === "top" ? "flex-start" : element.valign === "bottom" ? "flex-end" : "center";
      text.style.justifyContent = element.align === "left" ? "flex-start" : element.align === "right" ? "flex-end" : "center";
      text.style.textAlign = element.align;
      text.style.whiteSpace = "pre-wrap";
      text.style.overflowWrap = "anywhere";
      text.style.lineHeight = "1.12";
      text.style.fontFamily = element.fontFamily;
      text.style.fontWeight = element.fontWeight;
      text.style.fontSize = print ? (element.fontSize / 900 * widthMm) + "mm" : (element.fontSize * (900 / 900)) + "px";
      text.style.color = element.color;
      node.appendChild(text);
    } else if (element.type === "logo" || element.type === "qr") {
      const img = document.createElement("img");
      img.alt = element.type === "qr" ? "Código QR" : "Logotipo";
      img.style.width = "100%";
      img.style.height = "100%";
      img.style.display = "block";
      img.style.objectFit = element.type === "logo" ? element.fit : "contain";
      img.style.boxSizing = "border-box";
      img.style.background = element.backgroundColor;
      img.style.border = element.borderWidth + (print ? "mm " : "px ") + "solid " + element.borderColor;
      img.style.borderRadius = element.radius + (print ? "mm" : "px");
      const src = element.type === "qr" ? options.qrSrc : (element.source === "custom" ? element.src : logoSources[element.source]);
      if (src) img.src = src;
      else {
        img.style.visibility = "hidden";
        node.style.background = element.type === "qr" ? "#ffffff" : "#ffffff22";
      }
      node.appendChild(img);
      if (!src && editor) {
        const placeholder = document.createElement("span");
        placeholder.textContent = element.type === "qr" ? "QR" : "LOGO";
        placeholder.style.cssText = "position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#51475a;font:700 18px Arial,sans-serif;pointer-events:none;";
        node.appendChild(placeholder);
      }
    } else if (element.type === "shape") {
      node.style.background = element.shape === "line" ? "transparent" : element.fill;
      node.style.border = element.strokeWidth + (print ? "mm " : "px ") + "solid " + element.stroke;
      node.style.borderRadius = element.shape === "circle" ? "50%" : (element.radius + (print ? "mm" : "px"));
      if (element.shape === "line") {
        node.style.border = "0";
        node.style.borderTop = Math.max(element.strokeWidth, 1) + (print ? "mm " : "px ") + "solid " + element.stroke;
        node.style.height = "0";
        node.style.top = element.y + "%";
      }
    }
    if (editor && selectedId === element.id) {
      const handle = document.createElement("span");
      handle.className = "ticket-design-resize";
      handle.setAttribute("aria-hidden", "true");
      node.appendChild(handle);
    }
    root.appendChild(node);
  }
  return root;
}

export const ticketFieldLabels = FIELD_LABELS;
