# Changelog

## 0.2.0

- Trigger: nuevo evento **Tarea Modificada (Incluye Calificaciones)**. Compara cada tarea de Aula Virtual con la última foto guardada en los datos del workflow y emite `cambios` (campo, antes, después), `camposModificados` y `cambioCalificacion`.
- Trigger: implementado el evento **Tarea Nueva** (antes no tenía fuente de datos), consultando `GET /umuapp/rest/v1.0/private/asignaturas/sitios/{sitio}/tareas`.
- Trigger: corregido que `emitExisting`, `daysAhead`, `holidays` y `maxCalendar` se leían de una colección `options` que no existía; ahora hay una colección «Opciones».
- `normalizeTask` usa los nombres del esquema real (`id_tarea`, `fecha_inicio`, `instrucciones`, `entrega`, `adjuntos`…).
- `package.json`: registrados los nodos reales y eliminado el nodo de ejemplo de la plantilla.
