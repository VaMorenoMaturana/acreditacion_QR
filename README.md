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
1. Cree un proyecto Supabase para este sistema.
2. En un proyecto nuevo, revise y ejecute `supabase/schema.sql` y después `supabase/migrations/20261123000000_multi_tenant_and_auditoriums.sql`. En una instalación existente, realice un respaldo y ejecute únicamente la nueva migración multiempresa/auditorios; no vuelva a ejecutar el esquema completo sobre una base con datos.
3. En **Authentication → URL Configuration**, configure la URL de Render como Site URL y agregue las URL de retorno que utilizará la aplicación. Habilite la confirmación de correo electrónico para el registro público.
4. Copie la URL del proyecto y la clave pública anon/publishable a `src/config.js`.
5. Despliegue la función Edge `admin-invite-user` con el archivo actualizado. La función debe conservar la validación de sesión y administrador en su código; nunca publique la clave `service_role`.
6. Publique el contenido del repositorio como Static Site en Render. Build command vacío; Publish directory `.`.
7. En la pantalla de acceso, seleccione **Crear cuenta y organización**. La primera cuenta de cada organización recibe el rol `admin`; confirme el correo si Supabase lo solicita.
8. Cree una actividad de prueba y registre asistentes ficticios antes de usar datos reales.

## Administración de usuarios

La pestaña **Administración** permite crear cuentas dentro de la organización activa. El administrador ingresa el correo, define la contraseña y selecciona `staff`, `volunteer` o `admin`. La cuenta queda asociada a la misma organización; no se envía invitación ni correo de confirmación.

La creación se ejecuta mediante la función Edge `admin-invite-user`. La función valida el JWT del solicitante y comprueba que tenga rol `admin` y organización asignada. La cuenta nueva recibe el mismo `organization_id`; nunca se permite que el administrador del frontend indique otra organización. La clave `service_role` se utiliza exclusivamente en el entorno seguro de Supabase.

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

El trigger `handle_new_user` crea el perfil base y la función Edge asigna el rol y la organización del administrador que crea la cuenta. La contraseña solo se recibe durante la creación, no se escribe en los registros de auditoría ni se devuelve al frontend. El administrador debe entregarla por un canal seguro.
## Organizaciones y aislamiento multiempresa

La plataforma opera con una arquitectura multiempresa. Cada organización es un espacio de trabajo privado que agrupa sus actividades, inscritos, acreditaciones, usuarios y plantillas de auditorios. El campo visible **Dominio / organización** representa este espacio de trabajo; no es un dominio DNS ni crea un subdominio web.

### Registro público

En la pantalla de acceso, **Crear cuenta y organización** solicita nombre, correo, contraseña y nombre de la organización. Supabase Auth registra la cuenta y el trigger `handle_new_user` crea la organización y asigna a ese primer usuario el rol `admin`. Si está habilitada la confirmación de correo en Supabase Auth, la persona debe confirmar su dirección antes de iniciar sesión. El identificador técnico `slug` se genera internamente y es único.

### Aislamiento de datos

Las tablas de actividades, asistentes, inscripciones, acreditaciones, auditorios y auditoría tienen `organization_id`. Las políticas RLS comparan ese identificador con la organización del perfil autenticado. Las relaciones compuestas impiden enlazar una inscripción, actividad, asistente o plantilla de otra organización. Las cuentas creadas por el administrador quedan dentro de la misma organización.

Para conservar los datos existentes, la migración asigna los registros actuales a una organización inicial **Fundación Espacio Mejor**. No se elimina ni se recrea ninguna actividad o inscripción.

### Aplicación de la migración multiempresa

En una base existente, después de respaldarla, ejecute una sola vez el contenido de:

`supabase/migrations/20261123000000_multi_tenant_and_auditoriums.sql`

En un proyecto nuevo, ejecute primero `supabase/schema.sql` y después esta migración. No vuelva a ejecutar el esquema completo sobre una base con datos.

## Rol Voluntarios y acreditación manual

El rol `volunteer` solo muestra el módulo **Acreditación QR**. Puede seleccionar una actividad, consultar las personas inscritas y sus fila/asiento, acreditar manualmente con el botón **Acreditar** o utilizar el lector de cámara QR. No puede administrar usuarios, crear actividades, modificar inscripciones, eliminar registros ni asignar asientos.

Para una base de datos existente, ejecute una sola vez en **Supabase → SQL Editor** el contenido de `supabase/migrations/20261119000000_add_volunteer_role_manual_checkin.sql`. Esta migración:
- Amplía el conjunto de roles permitido en `profiles.role`.
- Permite a `volunteer` leer actividades, asistentes, inscripciones y acreditaciones.
- Autoriza a ese rol a validar QR y utilizar la función transaccional `manual_check_in_registration`.
- Conserva las operaciones de gestión (crear, editar, cancelar, eliminar y asignar asientos) limitadas a `staff` y `admin`.

El formulario de creación de usuarios permite seleccionar Personal, Voluntarios o Administrador. La Edge Function `admin-invite-user` debe desplegarse con el código actualizado para aceptar el rol `volunteer`. No es necesario modificar manualmente las filas existentes: el administrador puede cambiar el rol desde la tabla de usuarios.

## Auditorios personalizados y reutilizables

La tabla `auditorium_templates` guarda plantillas de auditorios por organización. Cada plantilla define nombre, escenario, filas y bloques de asientos. Cada fila puede contener uno o varios bloques; los bloques se separan visualmente con pasillos. Se pueden crear, reutilizar y asignar a distintas actividades de la misma organización.

La migración conserva la distribución original de 255 asientos como **Auditorio UAI · Viña del Mar** y la asigna a las actividades existentes. La dirección de numeración se guarda por actividad. Si una actividad ya tiene personas ubicadas, el sistema impide cambiar su plantilla hasta liberar las asignaciones para evitar alterar la ubicación física existente.

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
- No se envían correos transaccionales a los inscritos; Supabase Auth puede enviar el correo de confirmación del registro público si está habilitado.
- La acreditación requiere conexión activa a Supabase; no hay modo offline.
- No incluye certificados, integraciones externas ni check-out.
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

## Verificación de aislamiento antes de producción

En un proyecto de prueba, cree dos organizaciones con cuentas distintas. En cada una cree una actividad, una inscripción y una plantilla de auditorio. Inicie sesión alternadamente y compruebe que cada organización solo ve sus propios registros, usuarios y auditorios. También pruebe que una cuenta de una organización no pueda consultar por API el identificador de una actividad o plantilla de la otra.

Compruebe además:
- Que el administrador inicial de cada organización puede crear usuarios dentro de su propio espacio.
- Que un voluntario solo puede entrar a Acreditación QR y no puede acceder al módulo de auditorios.
- Que cambiar una plantilla o la dirección de numeración se bloquea cuando la actividad conserva asientos asignados.
- Que una acreditación manual y una por QR dejan el mismo estado final y no permiten un segundo check-in.

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
