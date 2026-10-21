# n8n-nodes-umuapp

Nodos de n8n para UMUApp (Universidad de Murcia): **UMUApp** (consultas) y **UMUApp Trigger** (polling).

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
npm test        # compila y ejecuta test/changes.js (API simulada)
npm run lint
```
