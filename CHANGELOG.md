# Changelog

## 0.3.2

- Aula Virtual: las cookies del primer paso del CAS (balanceador `AlteonP`) se reenvían en el paso del ticket de servicio y al cerrar el TGT.

## 0.3.1

- Aula Virtual: los errores de red indican en qué paso del login fallan (TGT, ST, canje del ticket, comprobar sesión, consulta) y a qué destino, sin mostrar contraseñas ni tickets. Un corte de conexión se reintenta una vez.
- El paso del ticket de servicio ya no envía `Content-Type` (la especificación solo manda la cabecera `UMUapp-Authentication-Token`).
- Credencial: campo opcional «User-Agent» para Aula Virtual.

## 0.3.0

- Nodo UMUApp: nuevo recurso **Tarea (Aula Virtual)** con las operaciones *Get Many* (`/direct/assignment/my.json`) y **Obtener** (una tarea concreta por ID, `/direct/assignment/item/{id}.json`). Si el endpoint por ID no responde en este Sakai, busca la tarea dentro de «mis tareas».
- El ID acepta el UUID, la referencia `/assignment/a/{sitio}/{id}` o el enlace `referencia_web` de una alerta de tarea.
- Sesión en Aula Virtual con el flujo de tickets CAS de los WebViews (`nodes/Umuapp/webview.ts`). Campos opcionales nuevos en la credencial: token de aplicación, URL de Aula Virtual, URL del servicio y URL del CAS.

## 0.2.0

- Trigger: nuevo evento **Tarea Modificada (Incluye Calificaciones)**. Compara cada tarea de Aula Virtual con la última foto guardada en los datos del workflow y emite `cambios` (campo, antes, después), `camposModificados` y `cambioCalificacion`.
- Trigger: implementado el evento **Tarea Nueva** (antes no tenía fuente de datos), consultando `GET /umuapp/rest/v1.0/private/asignaturas/sitios/{sitio}/tareas`.
- Trigger: corregido que `emitExisting`, `daysAhead`, `holidays` y `maxCalendar` se leían de una colección `options` que no existía; ahora hay una colección «Opciones».
- `normalizeTask` usa los nombres del esquema real (`id_tarea`, `fecha_inicio`, `instrucciones`, `entrega`, `adjuntos`…).
- `package.json`: registrados los nodos reales y eliminado el nodo de ejemplo de la plantilla.
