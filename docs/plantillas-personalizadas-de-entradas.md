# Plantillas personalizadas de entradas

## Qué incorpora

Espacio Acredita conserva las plantillas integradas:

- **Clásica horizontal:** diseño original de «Liderazgo en 100 Palabras».
- **Moderna vertical:** formato genérico vertical.

Además, cada organización puede crear y guardar sus propias plantillas desde **Entradas PDF/ZIP → Crear o editar una plantilla**.

## Editor visual

El lienzo permite:

- Definir ancho y alto del documento en milímetros.
- Usar fondo de color sólido, degradado o imagen PNG/JPG/WebP.
- Aplicar patrones de cuadrícula, puntos o líneas diagonales.
- Configurar esquinas rectas, redondeadas o con recorte y definir el borde.
- Añadir texto libre, datos automáticos, logotipos, QR, rectángulos, círculos y líneas.
- Arrastrar elementos para moverlos y usar el control inferior derecho para cambiar su tamaño.
- Ajustar posición, dimensiones, tipografía, tamaño, peso, color y alineación.
- Incorporar varios logotipos institucionales, de proyecto, de aliados o imágenes propias.

Los datos automáticos disponibles son nombre del participante, organización, nombre y descripción del evento, fecha, horario, lugar, fila, asiento, texto de acceso y sitio web. El QR se genera individualmente para cada inscripción.

Límites actuales: 32 elementos por plantilla, hasta 8 logotipos y 300 KB por imagen de logotipo propia; la imagen de fondo admite hasta 700 KB. Se recomiendan imágenes optimizadas en PNG o WebP.

## Guardado y permisos

Las plantillas se almacenan en Supabase asociadas a `organization_id`, por lo que están disponibles para los usuarios de la misma organización desde otros equipos.

- Personal y administradores pueden consultar y utilizar las plantillas guardadas.
- Solo el administrador de la organización puede crear, editar o eliminar plantillas.
- Las políticas RLS impiden consultar o modificar plantillas de otras organizaciones.

## Despliegue de base de datos

La funcionalidad incorpora la migración:

`supabase/migrations/20261127010000_ticket_templates.sql`

Después de integrar los cambios en GitHub, aplique el SQL de ese archivo en **Supabase → SQL Editor → New query → Run**. La migración crea la tabla `ticket_templates`, los índices, los permisos y las políticas RLS.

No se agregan Edge Functions ni secretos.

## Generación de entradas

La plantilla activa se utiliza para:

- Descarga individual en PDF.
- Descarga masiva de entradas en ZIP.
- PDF adjunto al envío individual de correo.

El tamaño de página del PDF se adapta a las dimensiones físicas configuradas. Las plantillas clásicas existentes mantienen sus tamaños y su comportamiento original.

## Notas de uso

1. Seleccione una plantilla guardada o uno de los dos formatos integrados.
2. Para crear una plantilla propia, abra el editor y seleccione **Nueva**. También puede abrir una plantilla existente y elegir **Guardar como copia** para crear una variante sin sobrescribir el original.
3. Añada y organice los elementos en el lienzo.
4. Revise la vista previa con una inscripción real seleccionada.
5. Guarde la plantilla. Quedará disponible para el resto de usuarios de la organización.

Las plantillas integradas no se sobrescriben: una plantilla personalizada se guarda como un diseño independiente.
