# Envío individual de entradas por correo

## Arquitectura

El envío se ejecuta desde la Edge Function `mail-manager`. El navegador genera el PDF de cada inscripción usando la plantilla y los colores seleccionados en «Entradas PDF/ZIP», y lo entrega a la función como adjunto. La función consulta nuevamente la inscripción, el participante y el evento en Supabase, valida que pertenezcan a la organización del administrador, obtiene el correo desde la base de datos y envía un mensaje individual mediante SMTP.

No se utiliza CCO ni se envía la lista completa de destinatarios en un mismo correo. La contraseña SMTP se cifra con AES-GCM antes de almacenarse; la clave de cifrado solo existe como secreto de la Edge Function. El navegador nunca recibe la contraseña almacenada.

## Requisitos de despliegue

1. Ejecute una sola vez en Supabase SQL Editor la migración `supabase/migrations/20261127000000_mail_smtp_ticket_delivery.sql`.
2. En Supabase Dashboard → Edge Functions → Secrets, cree `MAIL_SETTINGS_ENCRYPTION_KEY` con una cadena aleatoria de alta entropía de al menos 32 caracteres. Genérela con un gestor de contraseñas; no utilice una frase fácil de adivinar y no la guarde en GitHub.
3. Despliegue la Edge Function `mail-manager` desde `supabase/functions/mail-manager/index.ts`.
4. Despliegue el frontend desde Render una vez integradas las ramas y migración.

**No cambie ni elimine `MAIL_SETTINGS_ENCRYPTION_KEY` después de guardar credenciales SMTP**, porque las contraseñas existentes no podrán descifrarse con una clave diferente. Para rotarla, primero se debe implementar una migración de credenciales.

## Configuración SMTP por organización

El administrador ingresa el host, puerto, modo de seguridad, usuario, contraseña, correo remitente y nombre remitente desde Administración. El servidor almacena la contraseña cifrada y nunca la devuelve en las respuestas. Si el administrador cambia otros datos y deja la contraseña vacía, se conserva la contraseña que ya estaba guardada.

La acción «Probar conexión» utiliza la verificación SMTP de Nodemailer y comprueba que el servidor admita la conexión y autenticación. No envía un mensaje de prueba. El proveedor todavía puede exigir que el remitente o dominio esté verificado antes de aceptar mensajes.

## Restricciones de red SMTP

Supabase Edge Functions restringe conexiones SMTP salientes por los puertos 25 y 587. Configure un puerto alternativo que su proveedor admita, habitualmente 2587 o 2525. El puerto 465 no aparece entre las restricciones documentadas de Supabase y corresponde normalmente a SMTP con TLS directo; confírmelo con su proveedor. El ejemplo de Supabase para SMTP recomienda AWS SES con el puerto 2587. El modo STARTTLS es el valor predeterminado para este flujo.

Si su proveedor solo ofrece los puertos restringidos, esta conexión SMTP directa no funcionará desde Supabase. En ese caso se necesita un proveedor que acepte un puerto alternativo o una integración de envío mediante API.

## Flujo de envío

- Solo perfiles con rol `admin` pueden abrir la pestaña y utilizar la Edge Function.
- El administrador elige una actividad, redacta asunto y mensaje y envía a todos los inscritos vigentes con dirección de correo válida.
- Variables disponibles en asunto y cuerpo: `{{nombre}}`, `{{evento}}`, `{{fecha}}` y `{{lugar}}`.
- Cada persona recibe un correo dirigido únicamente a ella, con saludo personalizado y su propia entrada PDF adjunta.
- Se omiten registros cancelados y personas sin correo válido.
- Por defecto se omiten las personas que ya figuran como enviadas para esa actividad. La opción «Incluir también personas que ya recibieron una entrada anteriormente» permite reenvíos.
- Cada intento se registra como `sending` antes de conectar con SMTP y luego se actualiza a `sent` o `failed`. Un índice único impide que dos envíos simultáneos queden activos para la misma inscripción. Si el resultado queda como `sending`, el correo pudo haberse aceptado pero la confirmación se perdió. El sistema bloquea reintentos durante 10 minutos. Después de ese plazo, el administrador debe revisar el proveedor SMTP y activar expresamente el reenvío; esto podría generar un correo duplicado si el primer envío sí fue aceptado.
- Cada correo se procesa de forma individual y secuencial. La interfaz muestra avance y fallos por participante.

## Seguridad y límites

- Las credenciales SMTP no se almacenan en texto plano ni se exponen al frontend.
- Las tablas `mail_smtp_settings` y `mail_delivery_logs` tienen RLS activado y no entregan permisos directos a los roles `anon` ni `authenticated`. La Edge Function accede mediante el rol privilegiado en el servidor.
- La función valida la sesión, exige rol administrador, verifica la organización del registro y obtiene el destinatario desde la base de datos.
- El adjunto debe ser un PDF y no puede superar 3 MB.
- El servidor procesa un correo por solicitud. El frontend procesa destinatarios de forma secuencial y permite continuar aunque un envío individual falle.


## Interpretación del resultado

El estado «Enviada» significa que el servidor SMTP aceptó el mensaje y devolvió una respuesta satisfactoria. No garantiza que el mensaje haya llegado a la bandeja de entrada: el proveedor puede generar rebotes, aplicar filtros antispam o rechazar el dominio remitente posteriormente. Verifique SPF, DKIM y DMARC en el dominio del remitente y supervise los rebotes desde el proveedor.
