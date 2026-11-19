# Espacio Acredita — versión inicial (v0.1)

Sistema interno para actividades, inscripciones, entradas PDF/ZIP y acreditación QR. La plantilla visual del ticket se toma del HTML entregado y se conserva como referencia de diseño.

## Incluye
- Inicio de sesión Supabase Auth.
- Actividades con fecha, lugar, horario, descripción y logotipos.
- Inscripción individual con fila y asiento opcionales por persona.
- Importación CSV con vista previa, validación básica y reporte de filas inválidas.
- Entradas PDF individuales y ZIP por actividad.
- Acreditación por cámara (requiere HTTPS y permiso de cámara) o token manual.
- Roles `staff`, `admin` y `volunteer` en Supabase.
- Registro de acreditaciones y operaciones básicas en `audit_logs`.

## Arquitectura
- Frontend estático: Render Static Site.
- Autenticación y base de datos: Supabase.
- Bibliotecas de navegador por CDN para QR, PDF, ZIP y lector QR.
- No contiene claves secretas. La configuración del navegador usa únicamente URL y clave pública de Supabase.

## Puesta en marcha
1. Crea un proyecto Supabase para este sistema.
2. En un proyecto Supabase nuevo, revisa y ejecuta `supabase/schema.sql`. Si ya tienes una base creada, respáldala y aplica las migraciones que correspondan. Para la función de voluntarios y acreditación manual, ejecuta en el SQL Editor el archivo `supabase/migrations/20261119000000_add_volunteer_role_manual_checkin.sql` (una sola vez). No vuelvas a ejecutar todo el esquema sobre una base existente.
3. En Authentication, crea la primera cuenta de usuario.
4. Asigna rol administrador ejecutando, en una consulta separada, por ejemplo:
   ```sql
   update public.profiles set role='admin' where email='correo-institucional@ejemplo.cl';
   ```
   Sustituye el correo de ejemplo por el correo real autorizado. No compartas credenciales.
5. Copia URL del proyecto y la clave pública anon/publishable a `src/config.js`.
6. Publica el contenido de esta carpeta como Static Site en Render. Build command vacío; Publish directory `.`.
7. Accede con la cuenta creada. Crea una actividad de prueba y registra asistentes ficticios antes de usar datos reales.

## Administración de usuarios

La pestaña **Administración** permite crear cuentas directamente. El administrador ingresa el correo (que funciona como nombre de usuario), define la contraseña y selecciona el rol (`staff` o `admin`). La cuenta queda habilitada para iniciar sesión inmediatamente; no se envía invitación ni correo de confirmación.

La creación se ejecuta mediante la función Edge `admin-invite-user` (nombre técnico conservado para mantener la ruta de función ya configurada). La función valida el JWT del solicitante y comprueba que tenga rol `admin` en `public.profiles`. La clave `service_role` se utiliza exclusivamente dentro del entorno seguro de Supabase y nunca debe agregarse a `src/config.js`, al frontend ni a Render.

### Despliegue de la función

Después de actualizar el repositorio, despliegue la función en el proyecto Supabase correspondiente:

1. Instale Supabase CLI y autentíquese:
   ```bash
   supabase login
   ```
2. Vincule el repositorio al proyecto (reemplace el identificador por el Project Ref de Supabase):
   ```bash
   supabase link --project-ref <PROJECT_REF>
   ```
3. Despliegue la función:
   ```bash
   supabase functions deploy admin-invite-user
   ```

La función utiliza las variables de entorno administradas por Supabase (`SUPABASE_URL`, `SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY`). No copie la clave privilegiada a archivos del repositorio ni a variables públicas del sitio.

No es necesario ejecutar una migración SQL adicional: el trigger `handle_new_user` existente crea el perfil y la función Edge asigna el rol solicitado. La contraseña solo se recibe durante la creación, no se escribe en los registros de auditoría ni se devuelve al frontend. El administrador debe entregarla al usuario por un canal seguro y verificar cuidadosamente el correo, ya que la cuenta se crea con ese correo confirmado para permitir acceso inmediato.
## Rol Voluntarios y acreditación manual

El rol `volunteer` solo muestra el módulo **Acreditación QR**. Puede seleccionar una actividad, consultar las personas inscritas y sus fila/asiento, acreditar manualmente con el botón **Acreditar** o utilizar el lector de cámara QR. No puede administrar usuarios, crear actividades, modificar inscripciones, eliminar registros ni asignar asientos.

Para una base de datos existente, ejecute una sola vez en **Supabase → SQL Editor** el contenido de `supabase/migrations/20261119000000_add_volunteer_role_manual_checkin.sql`. Esta migración:
- Amplía el conjunto de roles permitido en `profiles.role`.
- Permite a `volunteer` leer actividades, asistentes, inscripciones y acreditaciones.
- Autoriza a ese rol a validar QR y utilizar la función transaccional `manual_check_in_registration`.
- Conserva las operaciones de gestión (crear, editar, cancelar, eliminar y asignar asientos) limitadas a `staff` y `admin`.

El formulario de creación de usuarios permite seleccionar Personal, Voluntarios o Administrador. La Edge Function `admin-invite-user` debe desplegarse con el código actualizado para aceptar el rol `volunteer`. No es necesario modificar manualmente las filas existentes: el administrador puede cambiar el rol desde la tabla de usuarios.

## Plantilla del ticket
- `ticket-template-original.html` es el archivo original adjunto, preservado sin modificaciones.
- `src/ticket-template.js` conserva el markup del ticket y `src/ticket.css` define sus estilos compartidos para vista previa y exportación PDF.
- Los campos se rellenan desde la actividad y la inscripción. El QR contiene un token aleatorio UUID de la base de datos, no nombre, correo ni otros datos personales.
- La versión de la plantilla original puede incluir un QR de demostración. No uses ese QR para acreditar asistentes reales.

## CSV
Encabezados recomendados:
```csv
nombre,email,organizacion,fila,asiento
Ana Ejemplo,ana@example.cl,Fundación Ejemplo,A,12
Luis Prueba,luis@example.cl,Organización Prueba,,
```
El importador valida campos y duplicados dentro del archivo; la base de datos evita duplicar la misma inscripción para una misma persona. Para producción se recomienda acordar la regla de deduplicación de personas y probar CSV exportados de los sistemas reales.

## Límites conocidos de esta versión
- No se envían correos automáticamente.
- La acreditación requiere conexión activa a Supabase; no hay modo offline.
- No incluye registro público, certificados, integraciones externas ni check-out.
- Los logotipos se almacenan como data URL en registros de actividad; para uso sostenido conviene migrarlos a Supabase Storage con límites de tamaño y permisos.
- La importación CSV es secuencial y está pensada para lotes pequeños/medianos; probar el volumen real.
- La auditoría está iniciada, pero no todos los cambios quedan auditados aún.
- Antes de producción hay que realizar pruebas funcionales, de permisos/RLS, concurrencia de check-in, privacidad, respaldos y recuperación.

## Seguridad y privacidad
- No poner `service_role`, contraseñas ni tokens secretos en el frontend.
- Crear cuentas solo para personal autorizado; habilitar MFA para administradores.
- Usar datos ficticios durante pruebas.
- Definir aviso de privacidad, base de legitimación, retención y procedimiento de eliminación antes de cargar datos personales reales.
- La política inicial de perfiles permite que cada usuario vea su propio perfil y que administradores vean todos; el alta automática crea rol `staff`.
- Las funciones `SECURITY DEFINER` y políticas deben revisarse en un entorno de prueba antes de usar datos reales.

## Despliegue Render
- New > Static Site.
- Conectar repositorio con estos archivos.
- Build command: dejar vacío.
- Publish directory: `.`
- Usar HTTPS para habilitar la cámara del dispositivo.


## Módulo de auditorios
- El botón **Asignación de asientos** abre `auditorio.html`, una página independiente que conserva el diseño del Gestor de Asientos.
- El módulo utiliza la sesión de Supabase Auth existente y carga participantes de la actividad seleccionada desde `registrations` + `attendees`. Mantiene la interfaz aprobada del Gestor, con listado a la izquierda, plano de 255 asientos, modo consulta/edición, conflictos, cambio de numeración (configurable antes de asignar), CSV de exportación y respaldo.
- La asignación actualiza únicamente `registrations.seat_row` y `registrations.seat_number`. No cambia QR, estado de acreditación ni datos de asistentes.
- No requiere migración de base de datos. Las pruebas deben realizarse primero en actividad de prueba.
