import type {
    IDataObject,
    INodeExecutionData,
    INodeType,
    INodeTypeDescription,
    IPollFunctions,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';
import { EventType, formatUmQuery, normalizeTask } from './functions';
import { getEndpoint } from './login';
import { compareTasks, fetchAllTasks, StoredTask, taskKey } from './tasks';
import { Alert, CalendarEvent } from './types';

const MAX_CACHED = 500;
const MAX_TASKS = 2000;

/** Campos que cambian solos con el tiempo y no interesan por defecto. */
const DEFAULT_IGNORED_TASK_FIELDS = 'estado,esta_activa,consultar_tiempo,registrar_tiempo';

interface PollState {
    cached?: string[];
    initialized: boolean;
    /** Última foto conocida de cada tarea (para detectar cambios, p. ej. calificaciones). */
    tasks?: Record<string, StoredTask>;
    tasksInitialized?: boolean;
}

type AlertType =
    | "anuncio"
    | "anuncioMod"
    | "examen"
    | "llamamiento"
    | "llamamientoAnulado"
    | "tarea";

type CalendarEvtType =
    | "clase"
    | "practica"
    | "tarea"
    | "examen";

export class UmuappTrigger implements INodeType {
    description: INodeTypeDescription = {
        displayName: 'UMUApp Trigger',
        name: 'umuappTrigger',
        // eslint-disable-next-line @n8n/community-nodes/icon-prefer-themed-variants
        icon: 'file:umuapp.svg',
        group: ['trigger'],
        version: 1,
        subtitle: '={{$parameter["events"].join(", ")}}',
        description: 'Se dispara cuando aparece una tarea, examen, anuncio, evento de calendario o alerta nueva en UMUApp',
        defaults: { name: 'UMUApp Trigger' },
        polling: true,
        inputs: [],
        outputs: [NodeConnectionTypes.Main],
        credentials: [{ name: 'umuappApi', required: true, testedBy: 'umuappApiTest' }],
        properties: [
            {
                displayName: 'Eventos',
                name: 'events',
                type: 'multiOptions',
                required: true,
                default: ['exam', 'task', 'announcement'],
                options: [
                    {
                        name: 'Alerta',
                        value: 'alert',
                        description: 'Cualquier alerta/aviso de Notimovil (SIVA, Aula Virtual, etc.)',
                    },
                    {
                        name: 'Evento De Calendario Nuevo',
                        value: 'calendarEvent',
                        description: 'Cualquier evento nuevo del calendario del usuario',
                    },
                    {
                        name: 'Tarea Modificada (Incluye Calificaciones)',
                        value: 'taskChanged',
                        description:
                            'Compara cada tarea de Aula Virtual con la última vez que se vio y avisa si algo cambió (fecha límite, instrucciones, adjuntos, entrega o calificación)',
                    },
                    {
                        name: 'Tarea Nueva',
                        value: 'task',
                        description: 'Tareas nuevas de Aula Virtual (consulta los sitios de tus asignaturas)',
                    },
                ],
            },
            {
                displayName: "Tipos De Evento",
                name: "calendarEvtTypes",
                type: "multiOptions",
                default: ["tarea", "examen"],
                displayOptions: { show: { events: ["calendarEvent"] } },
                options: [
                    {
                        name: "Clase",
                        value: "clase",
                    },
                    {
                        name: "Práctica",
                        value: "practica",
                    },
                    {
                        name: "Tarea",
                        value: "tarea",
                    },
                    {
                        name: "Examen",
                        value: "examen",
                    },
                ]
            },
            {
                displayName: "Tipos De Alerta",
                name: "alertTypes",
                type: "multiOptions",
                displayOptions: { show: { events: ["alert"] } },
                default: [],
                options: [
                    {
                        name: "Anuncio",
                        value: "anuncio"
                    },
                    {
                        name: "Anuncio Modificado",
                        value: "anuncio modificado"
                    },
                    {
                        name: "Examen",
                        value: "examen"
                    },
                    {
                        name: "Llamamiento",
                        value: "llamamiento"
                    },
                    {
                        name: "Llamamiento Anulado",
                        value: "anulación de llamamiento"
                    },
                    {
                        name: "Tarea",
                        value: "tarea"
                    },
                ]
            },
            {
                displayName: "Max Alertas",
                name: "maxAlertas",
                type: "number",
                default: 100,
                displayOptions: { show: { events: ["alert"] } },
            },
            {
                displayName: 'Opciones',
                name: 'options',
                type: 'collection',
                placeholder: 'Añadir opción',
                default: {},
                options: [
                    {
                        displayName: 'Campos De Tarea A Ignorar',
                        name: 'ignoredTaskFields',
                        type: 'string',
                        default: DEFAULT_IGNORED_TASK_FIELDS,
                        description:
                            'Campos (separados por comas) que no cuentan como cambio al comparar tareas. Por defecto se ignora el estado (abierta/vencida/cerrada) porque cambia sola con el tiempo; quítalo de la lista si quieres que avise cuando una tarea se cierre. Admite rutas como «entrega.nota».',
                    },
                    {
                        displayName: 'Días Por Delante (Calendario)',
                        name: 'daysAhead',
                        type: 'number',
                        default: 60,
                    },
                    {
                        displayName: 'Emitir También Lo Existente En La Primera Ejecución',
                        name: 'emitExisting',
                        type: 'boolean',
                        default: false,
                        description:
                            'Whether to emit everything found in the first run. Si no, la primera ejecución solo memoriza el estado actual.',
                    },
                    {
                        displayName: 'Incluir Festivos (Calendario)',
                        name: 'holidays',
                        type: 'boolean',
                        default: false,
                        description: 'Whether to include holidays in the calendar query',
                    },
                    {
                        displayName: 'Máx. Eventos De Calendario',
                        name: 'maxCalendar',
                        type: 'number',
                        default: 100,
                    },
                    {
                        displayName: 'Solo Tareas Del Último Curso',
                        name: 'tasksLastYear',
                        type: 'boolean',
                        default: true,
                        description: 'Whether to check only the tasks of the most recent academic year',
                    },
                ],
            },
        ],
    };

    async poll(this: IPollFunctions): Promise<INodeExecutionData[][] | null> {
        const selected = this.getNodeParameter('events', []) as EventType[];
        const options = this.getNodeParameter('options', {}) as IDataObject;
        const isManual = this.getMode() === 'manual';
        const state = this.getWorkflowStaticData('node') as unknown as PollState;

        const candidates: { key: string; item: IDataObject; sortDate: string; }[] = [];
        // Tareas ya comparadas con el estado guardado: se emiten tal cual, sin pasar por el dedupe de claves.
        const taskExtra: { item: IDataObject; sortDate: string }[] = [];

        if (selected.includes("alert")) {
            const alertTypes = this.getNodeParameter('alertTypes', []) as AlertType[];
            const query = { num_alertas: this.getNodeParameter('maxAlertas', 100) as number };

            const body = await getEndpoint(this, {
                method: "GET",
                host: "api",
                endpoint: "/cidu/notimovil-api/private/v3.0/alertas",
                query
            });
            const alerts = body.body.datos as Alert[];
            for (const alert of alerts) {
                if ((alertTypes.length && alertTypes.some(t => alert.titulo.toLowerCase().startsWith(t))) || !alertTypes.length) {
                    candidates.push({
                        key: `alert:${alert.codigo_alerta}`,
                        item: alert,
                        sortDate: String(alert.fecha_envio)
                    });
                }
            }
        }

        if (selected.includes("calendarEvent")) {
            const evtTypes = this.getNodeParameter('calendarEvtTypes', []) as CalendarEvtType[];
            const now = new Date();
            const from = new Date(now);
            from.setHours(0, 0, 0, 0);
            const to = new Date(now.getTime() + Number(options.daysAhead ?? 60) * 86_400_000 /* dias -> ms */);
            const body = await getEndpoint(this, {
                method: "GET",
                host: "umuapp",
                endpoint: "/umuapp/rest/v1.0/private/cidu/calendario/eventos/usuario",
                query: {
                    desde: formatUmQuery(from),
                    hasta: formatUmQuery(to),
                    limite: Number(options.maxCalendar ?? 100),
                    festivos: options.holidays === true,
                }
            });
            const events = body.body.datos as CalendarEvent[];
            for (const event of events) {
                if ((evtTypes.length && evtTypes.includes(event.subtipo as CalendarEvtType)))
                    candidates.push({
                        key: `cal:${event.id}`,
                        item: event,
                        sortDate: String(event.inicio)
                    });
            }
        }

        // --- Tareas: nuevas y modificadas (comparando con lo guardado) -------------------
        const wantNewTasks = selected.includes('task');
        const wantChangedTasks = selected.includes('taskChanged');
        if (wantNewTasks || wantChangedTasks) {
            const sites = await fetchAllTasks(this, options.tasksLastYear !== false);
            const current = sites.flatMap((s) =>
                s.tasks.map((task) => ({ key: taskKey(s.siteId, task), task, siteId: s.siteId })),
            );
            const siteOf = new Map(current.map((c) => [c.key, c.siteId]));
            const ignore = String(options.ignoredTaskFields ?? DEFAULT_IGNORED_TASK_FIELDS)
                .split(',')
                .map((x) => x.trim())
                .filter(Boolean);

            if (isManual) {
                for (const c of current) {
                    candidates.push({
                        key: c.key,
                        item: normalizeTask(c.task, c.siteId, 'task'),
                        sortDate: String(c.task.fecha_inicio ?? ''),
                    });
                }
            } else {
                const taskFirstRun = !state.tasksInitialized;
                const taskResult = compareTasks(state.tasks ?? {}, current, {
                    ignore,
                    now: Date.now(),
                    maxEntries: MAX_TASKS,
                });
                const emitFirst = options.emitExisting === true || !taskFirstRun;
                if (wantNewTasks && emitFirst) {
                    for (const c of taskResult.added) {
                        taskExtra.push({
                            item: normalizeTask(c.task, siteOf.get(c.key) ?? '', 'task'),
                            sortDate: String(c.task.fecha_inicio ?? ''),
                        });
                    }
                }
                if (wantChangedTasks && !taskFirstRun) {
                    for (const ch of taskResult.changed) {
                        const item = normalizeTask(ch.candidate.task, siteOf.get(ch.candidate.key) ?? '', 'taskChanged');
                        item.cambios = ch.cambios as unknown as IDataObject[];
                        item.camposModificados = ch.cambios.map((x) => x.campo);
                        item.cambioCalificacion = ch.calificacion;
                        taskExtra.push({ item, sortDate: new Date().toISOString() });
                    }
                }
                state.tasks = taskResult.next;
                state.tasksInitialized = true;
            }
        }

        const unique = new Map<string, { key: string; item: IDataObject; sortDate: string }>();
        for (const c of candidates) if (!unique.has(c.key)) unique.set(c.key, c);
        const all = [...unique.values()];

        if (isManual) {
            // Prueba manual: devolvemos lo más reciente para poder ver la estructura.
            const sample = all.sort((a, b) => b.sortDate.localeCompare(a.sortDate)).slice(0, 5);
            return sample.length ? [sample.map((c) => ({ json: c.item }))] : null;
        }

        const seen = new Set(state.cached ?? []);
        const firstRun = !state.initialized;
        const fresh = all.filter((c) => !seen.has(c.key));

        for (const c of all) seen.add(c.key);
        state.cached = [...seen].slice(-MAX_CACHED);
        state.initialized = true;

        const toEmit = firstRun && options.emitExisting !== true ? [] : fresh;
        const merged = [...toEmit.map((c) => ({ item: c.item, sortDate: c.sortDate })), ...taskExtra];
        if (!merged.length) return null;
        merged.sort((a, b) => a.sortDate.localeCompare(b.sortDate));
        return [merged.map((c) => ({ json: c.item }))];
    }
}