# Espacio Acredita — versión inicial (v0.1)

Sistema interno para actividades, inscripciones, entradas PDF/ZIP y acreditación QR. La plantilla visual del ticket se toma del HTML entregado y se conserva como referencia de diseño.

## Incluye
- Inicio de sesión Supabase Auth.
- Actividades con fecha, lugar, horario, descripción y logotipos.
- Inscripción individual con fila y asiento opcionales por persona.
- Importación CSV con vista previa, validación básica y reporte de filas inválidas.
- Entradas PDF individuales y ZIP por actividad.
- Acreditación por cámara (requiere HTTPS y permiso de cámara) o token manual.
- Roles `staff` y `admin` en Supabase.
- Registro de acreditaciones y operaciones básicas en `audit_logs`.

## Arquitectura
- Frontend estático: Render Static Site.
- Autenticación y base de datos: Supabase.
- Bibliotecas de navegador por CDN para QR, PDF, ZIP y lector QR.
- No contiene claves secretas. La configuración del navegador usa únicamente URL y clave pública de Supabase.

## Puesta en marcha
1. Crea un proyecto Supabase para este sistema.
2. En un proyecto Supabase nuevo, revisa y ejecuta `supabase/schema.sql`. Si ya tienes una base creada, respáldala y ejecuta `supabase/migrations/20261017000000_add_registration_seats.sql` antes de desplegar esta versión; no vuelvas a ejecutar todo el esquema sobre una base existente sin revisar conflictos.
3. En Authentication, crea la primera cuenta de usuario.
4. Asigna rol administrador ejecutando, en una consulta separada, por ejemplo:
   ```sql
   update public.profiles set role='admin' where email='correo-institucional@ejemplo.cl';
   ```
   Sustituye el correo de ejemplo por el correo real autorizado. No compartas credenciales.
5. Copia URL del proyecto y la clave pública anon/publishable a `src/config.js`.
6. Publica el contenido de esta carpeta como Static Site en Render. Build command vacío; Publish directory `.`.
7. Accede con la cuenta creada. Crea una actividad de prueba y registra asistentes ficticios antes de usar datos reales.

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
