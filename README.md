# n8n-nodes-umuapp

Nodos de n8n para UMUApp (Universidad de Murcia): **UMUApp** (consultas) y **UMUApp Trigger** (polling).

## Tarea (Aula Virtual) en el nodo UMUApp

- **Get Many:** todas tus tareas (`GET /direct/assignment/my.json`).
- **Obtener:** una tarea por su ID. El ID es el UUID de Sakai (campo `id` de Get Many). También puedes pegar la referencia `/assignment/a/{sitio}/{id}` o el enlace `referencia_web` de una alerta de tarea (`…?assignmentId=/assignment/a/1898_G_2026_N_N/{id}&…`) y el nodo saca el ID. Primero prueba `/direct/assignment/item/{id}.json`; si ese endpoint no existe en el Sakai de la UM, busca el ID dentro de `my.json`.
- La salida simplificada añade fechas ISO (`apertura`, `fechaLimite`, `cierre`), `notaMaxima`, `adjuntos` y un bloque `googleCalendar`; sin simplificar devuelve el objeto de Sakai tal cual.

La sesión se abre con el flujo de tickets CAS de los WebViews (`POST /cas/v1/tickets` → ticket de servicio → cookie `JSESSIONID`) y se renueva sola. **Probado solo con servidores simulados.** Si falla el login: rellena el *Token de aplicación* en la credencial (el CAS exige la cabecera `UMUapp-Authentication-Token`, que es una constante de la app y no el `access_token` de ningún login) o cambia la *URL del servicio* (por defecto `https://aulavirtual.um.es/sakai-login-tool/container`, es una suposición). Cada error indica el paso (TGT, ST, canje, comprobar sesión, consulta) y el destino. Si ves «la conexión se cerró inesperadamente», rellena el *Token de aplicación* (obligatorio: sin él el CAS corta la conexión) y, si sigue, el *User-Agent* con el de tu navegador.

## Anuncios y otras consultas de Aula Virtual

- **Anuncio (Aula Virtual):** *Get Many* (todas tus asignaturas), *Obtener de un sitio* y *Obtener* (pega la referencia `/announcement/msg/{sitio}/{canal}/{id}` o el enlace de la alerta). Máximo de anuncios y días hacia atrás configurables (Sakai devuelve solo 3 anuncios de los últimos 10 días si no se indica).
- **Petición (Aula Virtual):** GET a cualquier ruta del Aula Virtual. Sirve para explorar: `/direct/describe` lista los *entity providers* que tiene activos la UM.
- **Trigger → Anuncio De Aula Virtual Nuevo:** avisa de anuncios nuevos con el texto completo y los adjuntos.

Otras entidades del Aula Virtual de la UM (según su `/direct/describe`):

| Recurso del nodo | Entidad | Notas |
|---|---|---|
| Calendario (Aula Virtual) | `calendar/my`, `calendar/site/{sitio}` | filtros `firstDate`/`lastDate`; bloque `googleCalendar` |
| Examen (Aula Virtual) | `sam_pub` | Tests y cuestionarios; los campos no están descritos, se devuelve también el objeto original |
| Foro (Aula Virtual) | `forums/site/…` | foros → temas → conversaciones |
| Archivo de correo (Aula Virtual) | `mailarchive/siteMessages/{sitio}` | correos a la lista de la asignatura |
| Mensajes privados → contadores | `synopticmsgcntritem` | **solo cuántos nuevos**, no el texto |

**Mensajes privados (texto):** no hay ninguna entidad que los devuelva; para leerlos haría falta el HTML de la herramienta Mensajes. **Calificaciones:** la entidad `gradebook` no está activa (solo `gbng`, sin lectura de notas); la nota de una tarea hay que buscarla en `assignment` (`submissions`, `getGrade`, `itemSubmission`), cuyos parámetros no están descritos.

## UMUApp Trigger

Eventos seleccionables: alertas, eventos de calendario, tareas nuevas y **tareas modificadas**.

### Detección de tareas modificadas (calificaciones)

Cuando te califican una tarea no se publica ninguna alerta, así que el trigger la detecta comparando:

1. En cada consulta lee las tareas de todos los sitios de Aula Virtual de tus asignaturas.
2. Guarda por tarea una huella y los valores (recortados a 300 caracteres) en los datos estáticos del workflow (máx. 2000 tareas).
3. Si la huella cambia, emite un ítem `evento: "taskChanged"` con la tarea normalizada más:
   - `cambios`: lista `{ campo, antes, despues }` (rutas como `entrega.nota`, `fecha_limite`, `adjuntos[0].nombre`).
   - `camposModificados`: solo los nombres de campo.
   - `cambioCalificacion`: `true` si cambió algún campo cuyo nombre recuerda a nota/calificación.

La primera ejecución solo memoriza el estado (no emite). Si un sitio falla en una consulta, se conserva su estado anterior.

**Opciones:**
- *Campos de tarea a ignorar*: por defecto `estado,esta_activa,consultar_tiempo,registrar_tiempo`, porque el estado cambia solo al vencer la tarea. Quita `estado` si quieres aviso al cerrarse.
- *Solo tareas del último curso* (activado por defecto).

**Sin verificar contra la API real:** la documentación no describe la estructura de `entrega` (donde presumiblemente va la nota). Por eso se vigila la tarea completa, no un campo concreto. Mira una salida real y, si algún campo cambia constantemente sin interés (p. ej. un contador), añádelo a «Campos a ignorar».

## Desarrollo

```bash
npm install
npm run dev     # n8n local con recarga
npm test        # compila y ejecuta las pruebas de test/ (APIs simuladas)
npm run lint
```
