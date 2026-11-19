# Changelog

## 0.6.0

Hecho a partir de `/direct/describe` del Aula Virtual de la UM (99 entidades), no de suposiciones:

- Nodo UMUApp, nuevos recursos de Aula Virtual: **Calendario** (`/direct/calendar/my` y `/site/{sitio}`, con desde/hasta), **Examen** (`/direct/sam_pub.json`), **Foro** (`/direct/forums/site/…`, baja de foro a tema a conversación), **Archivo de correo** (`/direct/mailarchive/siteMessages/{sitio}`) y **Mensajes privados → Obtener contadores** (`/direct/synopticmsgcntritem`, solo cuántos mensajes nuevos, no su texto).
- Fechas de Sakai: `dueTime`/`openTime`/`closeTime` son `java.time.Instant`; se aceptan segundos (con decimales), `{epochSecond}` y, si faltan, los campos `*TimeString` (`yyyyMMddHHmmssSSS` en UTC).
- `/direct/sam_pub/context/{sitio}` solo redirige a la colección completa, así que Examen usa `/direct/sam_pub.json`.

## 0.5.0

- Nodo UMUApp: nuevo recurso **Anuncio (Aula Virtual)** con *Get Many* (`/direct/announcement/user.json`), *Obtener de un sitio* (`/direct/announcement/site/{sitio}.json`) y *Obtener* (por `/announcement/msg/{sitio}/{canal}/{id}` o por el enlace `referencia_web` de una alerta). Salida: título, cuerpo en HTML y en texto, autor, fecha ISO, adjuntos y sitio.
- Nodo UMUApp: nuevo recurso **Petición (Aula Virtual)**: GET autenticado a cualquier ruta, para explorar (`/direct/describe` lista los endpoints que tiene activos el Sakai de la UM).
- Trigger: nuevo evento **Anuncio De Aula Virtual Nuevo** (con opciones de máximo y días hacia atrás).
- Trigger: «Anuncio» ya no coincide con «Anuncio modificado»; nuevos tipos de alerta «Tarea modificada», «Asignatura calificada» y «Mensaje».
- Corregido: `urlEncode` codifica bien contraseñas con `&`, `+`, `%`; y el formulario del CAS solo lleva usuario y contraseña (antes enviaba todos los campos de la credencial, incluido el token de aplicación).

## 0.4.0

- Trigger: opción «Elementos En La Prueba Manual» (por defecto 5) para elegir cuántos devuelve «Fetch Test Event».
- Trigger: la prueba manual y los avisos se ordenan por fecha real; antes se comparaba el texto `dd/MM/yyyy`, que ordena mal entre meses y años.

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
