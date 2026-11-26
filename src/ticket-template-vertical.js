export const ticketMarkupVertical = `
  <header class="vertical-header">
    <div class="vertical-brand"><strong>ESPACIO ACREDITA</strong><span>EVENT PASS</span></div>
    <div class="vertical-logo">
      <div class="asset-slot logo-em"><span class="placeholder">LOGO</span><img id="logoPreview" alt="Logotipo institucional" hidden></div>
      <div class="asset-slot logo-project"><span class="placeholder">PROYECTO</span><img id="projectLogoPreview" alt="Logotipo del proyecto" hidden></div>
      <div class="asset-slot logo-partner"><span class="placeholder">ALIADO</span><img id="partnerLogoPreview" alt="Logotipo aliado" hidden></div>
    </div>
  </header>
  <section class="vertical-event">
    <p class="vertical-eyebrow">ACCESO AL EVENTO</p>
    <h2 class="event-name" id="previewEventName">Nombre del evento</h2>
    <p class="event-desc" id="previewEventDesc"></p>
  </section>
  <div class="vertical-rule" aria-hidden="true"></div>
  <section class="vertical-person">
    <span>ENTRADA PERSONAL</span>
    <strong class="person" id="previewPerson">Nombre del participante</strong>
    <span class="org" id="previewOrg"></span>
  </section>
  <section class="vertical-details">
    <div class="vertical-detail"><span>FECHA</span><strong id="previewDate">Por definir</strong></div>
    <div class="vertical-detail"><span>HORARIO</span><strong id="previewTime">Por definir</strong></div>
    <div class="vertical-detail" style="grid-column:1/-1"><span>LUGAR</span><strong id="previewPlace">Por definir</strong></div>
  </section>
  <footer class="vertical-bottom">
    <div class="vertical-seat"><div class="admit">ACCESO ÚNICO</div><div class="seat"><div>FILA: -</div><div>ASIENTO: -</div></div></div>
    <div class="vertical-qr"><img class="qr-image" id="qrPreview" alt="Código QR de acceso"><span class="vertical-qr-label">ESCANEE PARA VALIDAR SU ENTRADA</span></div>
  </footer>
`;