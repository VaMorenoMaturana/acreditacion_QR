# Liderazgo en 100 Palabras — acreditación QR

Aplicación web estática para Render Static Site con autenticación y base de datos gestionadas por Supabase. Incluye perfil administrador, perfil de equipo, creación/descarga de QR, validación y registro de ingreso con prevención de doble check-in, y panel con estadísticas que se actualizan en tiempo real.

## Arquitectura y límites importantes

- **Render Static Site** sirve la interfaz; no ejecuta una base de datos ni autentica usuarios por sí solo.
- **Supabase Auth + PostgreSQL + Realtime** proporciona autenticación, almacenamiento y sincronización.
- El QR contiene un token aleatorio (`L100P:<UUID>`), no nombre, correo ni otros datos personales.
- El personal no tiene acceso directo a la tabla de asistentes. La función SQL valida y registra el ingreso de forma transaccional.
- No se usa ni se debe publicar una clave `service_role` en el navegador.
- El acceso a la cámara requiere HTTPS (Render lo ofrece en el dominio publicado) y permiso del usuario.

## Archivos

- `index.html`: interfaz.
- `styles.css`: estilos adaptables a móvil.
- `app.js`: autenticación, lector QR, generación/descarga y panel.
- `supabase/schema.sql`: tablas, políticas RLS y función segura de check-in.
- `render.yaml`: configuración inicial para Render.

## Puesta en marcha

### 1. Crear Supabase

1. Crea un proyecto en Supabase.
2. Abre **SQL Editor** y ejecuta el contenido de `supabase/schema.sql`.
3. En **Project Settings → API** copia `Project URL` y la clave pública `anon`/publishable.
4. En `app.js`, reemplaza:
   - `PEGA_AQUI_TU_SUPABASE_URL`
   - `PEGA_AQUI_TU_SUPABASE_ANON_KEY`

   La clave pública/anon está diseñada para uso en el navegador cuando RLS está correctamente configurado. **No pegues la clave `service_role`**.
5. En **Authentication → Providers**, confirma que Email esté habilitado. Recomendación: desactiva el registro público de usuarios; el equipo debe ser invitado/creado por el administrador.
6. En **Authentication → Users**, crea manualmente las cuentas para el Director y el equipo. Usa contraseñas únicas y fuertes; habilita MFA para el perfil administrador si la configuración del proyecto lo permite.
7. Para cada usuario, copia su UUID desde Authentication → Users y ejecuta una sentencia como esta en SQL Editor:
   ```sql
   insert into public.user_profiles (id, display_name, role)
   values ('UUID_REAL_DEL_USUARIO', 'Director de Datos', 'admin');
   ```
   Para cada integrante del equipo usa `role = 'staff'`. **No compartas la cuenta del administrador.**
8. En **Database → Replication** o la sección Realtime, confirma que la tabla `public.attendees` esté habilitada para cambios en tiempo real. El SQL intenta agregarla a `supabase_realtime`.

### 2. Publicar en Render

1. Sube esta carpeta a un repositorio privado de GitHub.
2. En Render elige **New → Static Site** y conecta el repositorio.
3. Build command: dejar vacío (o `echo "Static site"` si la interfaz exige un comando).
4. Publish directory: `.`.
5. Publica. La cámara solo funcionará en HTTPS.
6. Prueba el acceso con una cuenta `staff` y otra `admin`.

También puedes usar el `render.yaml` como referencia para crear el Static Site.

## Uso el día de la ceremonia

### Antes de la ceremonia
1. Ingresa con la cuenta `admin`.
2. Abre **Administración**.
3. Registra nombre, correo opcional y organización opcional.
4. Se descargará un PNG por invitado. El panel permite volver a descargarlo.

### En la ceremonia
1. Cada integrante inicia sesión con su propia cuenta `staff`.
2. Pulsa **Activar cámara** y apunta al QR.
3. La app consulta el token contra la base de datos y registra el ingreso una sola vez.
4. Si el QR ya se usó, la aplicación muestra el nombre y la hora del primer ingreso y no vuelve a registrar otro.
5. El administrador ve totales, pendientes, porcentaje y estado de cada invitado; la tabla se refresca con Realtime.

## Pruebas mínimas antes de usar datos reales

- Iniciar sesión como administrador y como staff.
- Crear una invitación de prueba y descargar su QR.
- Validar un QR correcto: debe registrar un ingreso.
- Escanearlo por segunda vez: debe mostrar “ya utilizada” y conservar la hora original.
- Probar un token inventado: debe rechazarse.
- Comprobar que `staff` no puede consultar directamente la tabla `attendees` desde el cliente.
- Abrir la web desde un teléfono y comprobar permiso de cámara.
- Abrir dos sesiones de administración y confirmar que los cambios se reflejan.

## Consideraciones de seguridad y operación

- El QR funciona como una credencial: no publiques ni reenvíes códigos fuera de su destinatario.
- Si se pierde un QR, esta versión no incluye revocación/reemisión desde la interfaz. Puedes eliminar la invitación desde el panel de Supabase o solicitar esa mejora antes del evento.
- Esta versión registra el primer ingreso, no salidas ni múltiples accesos.
- Usa datos ficticios para las pruebas y minimiza el correo almacenado. Establece quién puede acceder a la lista de invitados y cuánto tiempo se conservará.
- Configura copias de seguridad y revisa las políticas RLS antes de producción.
- Las bibliotecas de QR se cargan desde CDN; para una ceremonia crítica conviene fijar versiones y probar con antelación.
- El panel muestra la hora en la zona horaria del navegador del dispositivo.

## Alcance de esta entrega

Es un prototipo funcional de base para un proyecto simple; requiere configurar Supabase y desplegarlo en Render. No se considera una auditoría de seguridad ni una certificación de cumplimiento normativo.
