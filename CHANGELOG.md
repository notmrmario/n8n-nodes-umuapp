# Changelog

## 0.9.0

Hecho a partir de la salida real de varios endpoints del Aula Virtual de la UM:

- **Tarea (Aula Virtual) → Get Many Active** (`/direct/umuKernel/allActiveTasks.json`, entidad propia de la UM): tareas activas con el título real del sitio (`sitioTitulo`), datos de la asignatura y titulación (`codigoAsignatura`, `codigoTitulacion`, `cursoAcademico`, `titulacion`, `rol`) y la entrega del propio usuario en `entrega` (`estado`, `entregada`, `calificada`, `nota`, `comentarioProfesor`, `fechaEntrega`…). Es de donde se puede sacar la nota.
- **Sitio (Aula Virtual):** `descripcionTexto` salía con las etiquetas HTML porque `htmlDescription` viene escapado; ahora se parte de `description`. `paginas` ya no trae `herramientas` vacías cuando solo se dispone de `sitePages` (la lista de herramientas solo viene con «Incluir Páginas Y Herramientas»).

## 0.8.1

- Los anuncios de Aula Virtual (nodo y trigger) llevan `urlAnuncio`: enlace directo al anuncio, `…/portal/directtool/{herramienta Anuncios del sitio}?itemReference=/announcement/msg/{sitio}/{canal}/{id}&sakai_action=doShowmetadata`. El id de la herramienta «Anuncios» se obtiene de `/direct/site/{id}/pages.json`, una vez por sitio (se recuerda una hora). Si no se puede obtener, `urlAnuncio` es null y sigue valiendo `urlSitio`.

## 0.8.0

- **Corrección:** `sitioTitulo` salía siempre como «Mi Sitio» en los anuncios (y en el calendario no existía): Sakai devuelve ahí el título del sitio «actual» de la sesión, no el del sitio del anuncio. Ahora el título se toma de `/direct/site/{id}.json`, una consulta por sitio distinto (se recuerda una hora), tanto en el nodo como en el trigger. Los eventos del calendario de Aula Virtual también llevan `sitioTitulo`. Si la consulta falla, el elemento queda como estaba. El `raw` no se toca.
- **Nuevo recurso «Sitio (Aula Virtual)» → Get:** datos de un sitio a partir de su ID o de cualquier URL del sitio (`…/portal/site/{id}/…`). Devuelve título, tipo, descripción (HTML y texto), publicado, fechas, propietario, contacto, URL y el objeto original; opcionalmente las páginas y herramientas (`/pages.json`) y los grupos.

## 0.7.0

- **Examen (Aula Virtual)** consulta solo «Tests y cuestionarios» (`sam_pub`): cada cosa se clasifica según donde sale en el Aula Virtual. Las tareas siguen en «Tarea» y los eventos en «Calendario (Aula Virtual)».
- `sam_pub.json` solo lista las evaluaciones del «sitio actual» de la sesión, y una sesión nueva no tiene ninguno (devolvía vacío aunque en el navegador sí salían). Ahora se consulta sitio por sitio, probando tres formas de fijar el sitio; `consulta` indica cuál funcionó. Nuevo campo opcional «Sitio».
- Las entidades HTML (`&aacute;`, `&#241;`, `&nbsp;`…) se decodifican en todos los textos de salida, incluido `raw`. Los campos que llevan HTML a propósito (`descripcion`, `cuerpo`, `instrucciones`) se dejan como vienen; sus versiones `*Texto` sí salen decodificadas. «Petición (Aula Virtual)» no decodifica.
- **Trigger:** el valor por defecto de «Eventos» (`exam`, `announcement`) no coincidía con ninguna opción; ahora es Anuncio, Examen, Tarea nueva y Tarea modificada de Aula Virtual. Una prueba comprueba que todos los valores por defecto existan.
- **Examen (Aula Virtual) → Get:** busca un examen a partir de la `referencia_web` de su alerta, de una referencia de Samigo (`/samigo/s/{sitio}/p/{id}`), de un ID de evaluación o de un sitio. Las alertas de examen solo traen el sitio (`/portal/site/{sitio}/tool/{uuid}`), así que hay un filtro «Título Contiene» para elegir entre varias evaluaciones; si nada coincide, `candidatos` lista las que hay.
- **Examen → Get:** nuevo campo «Descripción De La Alerta». La descripción de una alerta de examen es «título - Autor: nombre» y la referencia web da el sitio (herramienta `sakai.samigo`), con lo que se localiza la evaluación concreta: título igual, si no título que lo contenga, y el autor desempata. `coincidencia` indica el criterio usado.
- **Trigger:** nuevo evento «Examen De Aula Virtual Nuevo» (nuevas evaluaciones de Tests y cuestionarios).

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
