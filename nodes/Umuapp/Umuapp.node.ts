import { IDataObject, IExecuteFunctions, INodeExecutionData, INodeType, INodeTypeDescription, NodeConnectionTypes, NodeOperationError } from "n8n-workflow";
import { getEndpoint } from "./login";
import { decodeDeep, extractList, formatUmQuery, normalizeTask } from "./functions";
import {
    matchesAnnouncement,
    matchesAssignment,
    normalizeSakaiAnnouncement,
    normalizeSakaiAssignment,
    normalizeSakaiCalendarEvent,
    normalizeSakaiMail,
    normalizeSakaiMessageCounts,
    parseAnnouncementRef,
    parseAssignmentId,
    sakaiList,
} from "./sakai";
import { aulaGet, getWebSession } from "./webview";
import { fetchAvExams } from "./exams";

export class Umuapp implements INodeType {
    description: INodeTypeDescription = {
        displayName: "UMUApp",
        name: "umuapp",
        // eslint-disable-next-line @n8n/community-nodes/icon-prefer-themed-variants
        icon: "file:umuapp.svg",
        group: ["input"],
        version: 1,
        subtitle: "={{$parameter['resource'] + ': ' + $parameter['operation']}}",
        description: "Consulta calendario, alertas, asignaturas y tareas en UMUApp (Universidad de Murcia)",
        defaults: { name: "UMUApp" },
        usableAsTool: true,
        inputs: [NodeConnectionTypes.Main],
        outputs: [NodeConnectionTypes.Main],
        credentials: [{ name: "umuappApi", required: true, testedBy: "umuappApiTest" }],
        properties: [
            {
                displayName: "Recurso",
                name: "resource",
                type: "options",
                noDataExpression: true,
                default: "calendar",
                options: [
                    { name: "Alerta", value: "alert" },
                    { name: "Anuncio (Aula Virtual)", value: "avAnnouncement" },
                    { name: "Archivo De Correo (Aula Virtual)", value: "avMail" },
                    { name: "Asignatura", value: "subject" },
                    { name: "Calendario", value: "calendar" },
                    { name: "Calendario (Aula Virtual)", value: "avCalendar" },
                    { name: "Examen (Aula Virtual)", value: "avExam" },
                    { name: "Foro (Aula Virtual)", value: "avForum" },
                    { name: "Mensajes Privados (Aula Virtual)", value: "avMessages" },
                    { name: "Petición (Aula Virtual)", value: "avRequest" },
                    { name: "Tarea (Aula Virtual)", value: "task" },
                ],
            },

            // ---- Anuncios de Aula Virtual (Sakai) ----------------------------------
            {
                displayName: "Operación",
                name: "operation",
                type: "options",
                noDataExpression: true,
                displayOptions: { show: { resource: ["avAnnouncement"] } },
                default: "getAll",
                options: [
                    {
                        name: "Get Many",
                        value: "getAll",
                        action: "Get many anuncios de aula virtual",
                        description: "Tus anuncios recientes de todas las asignaturas",
                    },
                    {
                        name: "Obtener",
                        value: "get",
                        action: "Obtener un anuncio de aula virtual",
                        description: "Un anuncio concreto a partir de su referencia o del enlace de la alerta",
                    },
                    {
                        name: "Obtener De Un Sitio",
                        value: "getSite",
                        action: "Obtener anuncios de un sitio",
                    },
                ],
            },
            {
                displayName: "Referencia Del Anuncio",
                name: "announcementRef",
                type: "string",
                default: "",
                required: true,
                placeholder: "/announcement/msg/1898_G_2026_N_N/main/abc123",
                description:
                    "Referencia /announcement/msg/{sitio}/{canal}/{identificador}, o el enlace referencia_web de una alerta de anuncio, o {sitio}/{identificador}",
                displayOptions: { show: { resource: ["avAnnouncement"], operation: ["get"] } },
            },
            {
                displayName: "Sitio",
                name: "avSiteId",
                type: "string",
                default: "",
                required: true,
                placeholder: "1898_G_2026_N_N",
                description: "Es el campo sitio_av de la asignatura",
                displayOptions: { show: { resource: ["avAnnouncement", "avCalendar", "avForum", "avMail"], operation: ["getSite"] } },
            },
            {
                displayName: "Máximo De Anuncios",
                name: "avLimit",
                type: "number",
                typeOptions: { minValue: 1 },
                default: 20,
                description: "Max number of announcements to return",
                displayOptions: { show: { resource: ["avAnnouncement"], operation: ["getAll", "getSite"] } },
            },
            {
                displayName: "Días Hacia Atrás",
                name: "avDays",
                type: "number",
                typeOptions: { minValue: 1 },
                default: 30,
                description: "How many days back to look for announcements",
                displayOptions: { show: { resource: ["avAnnouncement"], operation: ["getAll", "getSite"] } },
            },


            // ---- Otras entidades de Aula Virtual (Sakai) ----------------------------
            {
                displayName: "Operación",
                name: "operation",
                type: "options",
                noDataExpression: true,
                displayOptions: { show: { resource: ["avCalendar"] } },
                default: "getAll",
                options: [
                    { name: "Get Many", value: "getAll", action: "Get many eventos del calendario de aula virtual", description: "Eventos de todos tus calendarios (entidad calendar/my)" },
                    { name: "Obtener De Un Sitio", value: "getSite", action: "Obtener eventos del calendario de un sitio" },
                ],
            },
            {
                displayName: "Desde (AAAA-MM-DD)",
                name: "avFirstDate",
                type: "string",
                default: "",
                placeholder: "2026-11-01",
                description: "Filtra desde esta fecha (opcional)",
                displayOptions: { show: { resource: ["avCalendar"] } },
            },
            {
                displayName: "Hasta (AAAA-MM-DD)",
                name: "avLastDate",
                type: "string",
                default: "",
                placeholder: "2026-12-31",
                description: "Filtra hasta esta fecha (opcional)",
                displayOptions: { show: { resource: ["avCalendar"] } },
            },
            {
                displayName: "Operación",
                name: "operation",
                type: "options",
                noDataExpression: true,
                displayOptions: { show: { resource: ["avExam"] } },
                default: "getAll",
                options: [
                    {
                        name: "Get Many",
                        value: "getAll",
                        action: "Get many examenes de aula virtual",
                        description: "Evaluaciones publicadas en Tests y cuestionarios (entidad sam_pub)",
                    },
                ],
            },
            {
                displayName: "Sitio (Opcional)",
                name: "examSite",
                type: "string",
                default: "",
                placeholder: "1898_G_2026_N_N",
                description: "Si lo dejas vacío se consultan todos tus sitios",
                displayOptions: { show: { resource: ["avExam"] } },
            },
            {
                displayName: "Operación",
                name: "operation",
                type: "options",
                noDataExpression: true,
                displayOptions: { show: { resource: ["avForum"] } },
                default: "getSite",
                options: [
                    {
                        name: "Obtener De Un Sitio",
                        value: "getSite",
                        action: "Obtener foros de un sitio",
                        description: "Foros del sitio; con foro y tema rellenos, baja un nivel cada vez",
                    },
                ],
            },
            {
                displayName: "ID Del Foro (Opcional)",
                name: "avForumId",
                type: "string",
                default: "",
                description: "Con el foro se obtienen sus temas",
                displayOptions: { show: { resource: ["avForum"] } },
            },
            {
                displayName: "ID Del Tema (Opcional)",
                name: "avTopicId",
                type: "string",
                default: "",
                description: "Con foro y tema se obtienen sus conversaciones",
                displayOptions: { show: { resource: ["avForum"] } },
            },
            {
                displayName: "Operación",
                name: "operation",
                type: "options",
                noDataExpression: true,
                displayOptions: { show: { resource: ["avMail"] } },
                default: "getSite",
                options: [
                    {
                        name: "Obtener De Un Sitio",
                        value: "getSite",
                        action: "Obtener mensajes del archivo de correo de un sitio",
                        description: "Correos enviados a la lista de la asignatura (entidad mailarchive)",
                    },
                ],
            },
            {
                displayName: "Operación",
                name: "operation",
                type: "options",
                noDataExpression: true,
                displayOptions: { show: { resource: ["avMessages"] } },
                default: "getCounts",
                options: [
                    {
                        name: "Obtener Contadores",
                        value: "getCounts",
                        action: "Obtener los contadores de mensajes privados nuevos",
                        description: "Cuántos mensajes privados y de foro nuevos tienes por sitio. No trae el texto de los mensajes.",
                    },
                ],
            },

            // ---- Petición libre a Aula Virtual -------------------------------------
            {
                displayName: "Operación",
                name: "operation",
                type: "options",
                noDataExpression: true,
                displayOptions: { show: { resource: ["avRequest"] } },
                default: "get",
                options: [
                    {
                        name: "GET",
                        value: "get",
                        action: "Hacer un get autenticado al aula virtual",
                        description: "Para explorar endpoints (por ejemplo /direct/describe lista los que tiene activos Sakai)",
                    },
                ],
            },
            {
                displayName: "Ruta",
                name: "avPath",
                type: "string",
                default: "/direct/describe",
                description: "Ruta bajo la URL de Aula Virtual, o una URL completa de aulavirtual.um.es",
                displayOptions: { show: { resource: ["avRequest"] } },
            },

            // ---- Tareas de Aula Virtual (Sakai) ----------------------------------
            {
                displayName: "Operación",
                name: "operation",
                type: "options",
                noDataExpression: true,
                displayOptions: { show: { resource: ["task"] } },
                default: "getAll",
                options: [
                    {
                        name: "Get Many",
                        value: "getAll",
                        action: "Get many tareas de aula virtual",
                        description: "Todas tus tareas del aula virtual (entidad assignment/my de Sakai)",
                    },
                    {
                        name: "Obtener",
                        value: "get",
                        action: "Obtener una tarea de aula virtual",
                        description: "Una tarea concreta por su identificador (entidad assignment/item de Sakai)",
                    },
                ],
            },
            {
                displayName: "ID De La Tarea",
                name: "taskId",
                type: "string",
                default: "",
                required: true,
                placeholder: "e3c73c3e-eda7-4e2c-8051-4a7415a847e4",
                description:
                    "Identificador de Sakai (UUID de la tarea, el valor que devuelve Get Many). También vale la referencia /assignment/a/{sitio}/{identificador} o el enlace referencia_web de una alerta de tarea: el nodo extrae el identificador.",
                displayOptions: { show: { resource: ["task"], operation: ["get"] } },
            },

            // ---- Calendario ----------------------------------------------------
            {
                displayName: "Operación",
                name: "operation",
                type: "options",
                noDataExpression: true,
                displayOptions: { show: { resource: ["calendar"] } },
                default: "getAll",
                options: [{ name: "Get Many", value: "getAll", action: "Obtener eventos del calendario" }],
            },
            {
                displayName: "Desde",
                name: "from",
                type: "dateTime",
                default: "={{ $now.startOf('day').toISO() }}",
                displayOptions: { show: { resource: ["calendar"], operation: ["getAll"] } },
            },
            {
                displayName: "Hasta",
                name: "to",
                type: "dateTime",
                default: "={{ $now.plus({ days: 60 }).toISO() }}",
                displayOptions: { show: { resource: ["calendar"], operation: ["getAll"] } },
            },
            {
                displayName: "Límite",
                name: "limit",
                type: "number",
                typeOptions: { minValue: 1 },
                default: 50,
                description: "Max number of results to return",
                displayOptions: { show: { resource: ["calendar"], operation: ["getAll"] } },
            },
            {
                displayName: "Incluir Festivos",
                name: "holidays",
                type: "boolean",
                default: false,
                displayOptions: { show: { resource: ["calendar"], operation: ["getAll"] } },
            },

            // ---- Alertas -------------------------------------------------------
            {
                displayName: "Operación",
                name: "operation",
                type: "options",
                noDataExpression: true,
                displayOptions: { show: { resource: ["alert"] } },
                default: "getAll",
                options: [
                    { name: "Marcar Estado", value: "setState", action: "Cambiar el estado de alertas" },
                    { name: "Obtener", value: "get", action: "Obtener una alerta" },
                    { name: "Get Many", value: "getAll", action: "Obtener alertas" },
                ],
            },
            {
                displayName: "ID De Alerta",
                name: "alertId",
                type: "number",
                default: 0,
                displayOptions: { show: { resource: ["alert"], operation: ["get"] } },
            },
            {
                displayName: "Marcar Como Leída Al Obtenerla",
                name: "markRead",
                type: "boolean",
                default: false,
                displayOptions: { show: { resource: ["alert"], operation: ["get"] } },
            },
            {
                displayName: "IDs De Alerta",
                name: "alertIds",
                type: "string",
                default: "",
                description: "Separados por comas",
                displayOptions: { show: { resource: ["alert"], operation: ["setState"] } },
            },
            {
                displayName: "Estado",
                name: "state",
                type: "options",
                default: "LE",
                options: [
                    { name: "Leída", value: "LE" },
                    { name: "No Leída", value: "NL" },
                ],
                displayOptions: { show: { resource: ["alert"], operation: ["setState"] } },
            },
            {
                displayName: "Límite",
                name: "limit",
                type: "number",
                typeOptions: { minValue: 1 },
                default: 50,
                description: "Max number of results to return",
                displayOptions: { show: { resource: ["alert"], operation: ["getAll"] } },
            },
            {
                displayName: "Filtros",
                name: "filters",
                type: "collection",
                placeholder: "Añadir filtro",
                default: {},
                displayOptions: { show: { resource: ["alert"], operation: ["getAll"] } },
                options: [
                    {
                        displayName: "Categoría Name or ID",
                        name: "category",
                        type: "options",
                        description: "Choose from the list, or specify an ID using an <a href=\"https://docs.n8n.io/code/expressions/\">expression</a>",
                        typeOptions: { loadOptionsMethod: "getCategories" },
                        default: 0,
                    },
                    {
                        displayName: "Código De Aplicación",
                        name: "application",
                        type: "number",
                        default: 0,
                    },
                    {
                        displayName: "Estados",
                        name: "states",
                        type: "multiOptions",
                        default: [],
                        options: [
                            { name: "Leída", value: "LE" },
                            { name: "No Leída", value: "NL" },
                        ],
                    },
                    { displayName: "Texto Contiene", name: "text", type: "string", default: "" },
                ],
            },

            // ---- Asignaturas ---------------------------------------------------
            {
                displayName: "Operación",
                name: "operation",
                type: "options",
                noDataExpression: true,
                displayOptions: { show: { resource: ["subject"] } },
                default: "getAll",
                options: [
                    { name: "Get Many", value: "getAll", action: "Obtener asignaturas" },
                    {
                        name: "Obtener Tareas De Todos Los Sitios",
                        value: "getAllTasks",
                        action: "Obtener tareas de todos los sitios de aula virtual",
                    },
                    { name: "Obtener Tareas De Un Sitio", value: "getTasks", action: "Obtener tareas de un sitio" },
                ],
            },
            {
                displayName: "ID Del Sitio (Aula Virtual)",
                name: "siteId",
                type: "string",
                default: "",
                description: "Es el campo sitio_av de la asignatura",
                displayOptions: { show: { resource: ["subject"], operation: ["getTasks"] } },
            },
            {
                displayName: "Solo Último Año",
                name: "lastYear",
                type: "boolean",
                default: true,
                // eslint-disable-next-line n8n-nodes-base/node-param-description-boolean-without-whether
                description: "Mostrar solo las tareas del último año",
                displayOptions: { show: { resource: ["subject"] } }
            },
            {
                displayName: "Salida Simplificada",
                name: "simplify",
                type: "boolean",
                default: true,
                description: "Whether to return normalised fields (ISO dates, googleCalendar block) plus the raw object",
                displayOptions: {
                    show: {
                        resource: ["calendar", "alert", "subject", "task", "avAnnouncement", "avCalendar", "avExam", "avMail", "avMessages"],
                        operation: ["getAll", "get", "getTasks", "getAllTasks", "getSite", "getCounts"],
                    },
                },
            },
        ],
    };

    async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
        const items = this.getInputData();
        const out: INodeExecutionData[] = [];
        // const rules = buildRules();

        for (let i = 0; i < items.length; i++) {
            const resource = this.getNodeParameter("resource", i) as string;
            const operation = this.getNodeParameter("operation", i) as string;
            const simplify = this.getNodeParameter("simplify", i, true) as boolean;
            const push = (json: IDataObject) => out.push({ json: decodeDeep(json), pairedItem: i });

            try {
                if (resource === "avAnnouncement") {
                    const { base } = await getWebSession(this);
                    const q = (path: string) =>
                        aulaGet(this, path, {
                            n: this.getNodeParameter("avLimit", i, 20) as number,
                            d: this.getNodeParameter("avDays", i, 30) as number,
                        });
                    const emit = (a: IDataObject) => push(simplify ? normalizeSakaiAnnouncement(a, base) : a);
                    const jsonOk = (r: { isJson: boolean; statusCode: number }) => r.isJson && r.statusCode < 400;

                    if (operation === "getAll" || operation === "getSite") {
                        let path = "/direct/announcement/user.json";
                        if (operation === "getSite") {
                            const site = (this.getNodeParameter("avSiteId", i) as string).trim();
                            if (!site) throw new NodeOperationError(this.getNode(), "Indica el sitio", { itemIndex: i });
                            path = `/direct/announcement/site/${encodeURIComponent(site)}.json`;
                        }
                        const res = await q(path);
                        if (!jsonOk(res))
                            throw new NodeOperationError(this.getNode(), `Aula Virtual respondió HTTP ${res.statusCode} sin JSON en ${path}`, { itemIndex: i });
                        for (const a of sakaiList(res.data)) emit(a);
                    } else if (operation === "get") {
                        const ref = parseAnnouncementRef(this.getNodeParameter("announcementRef", i) as string);
                        if (!ref) throw new NodeOperationError(this.getNode(), "No reconozco la referencia del anuncio. Usa /announcement/msg/{sitio}/{canal}/{identificador} o el enlace de la alerta", { itemIndex: i });
                        const enc = (v: string) => encodeURIComponent(v);
                        let found: IDataObject | undefined;
                        // 1) por su ruta interna, 2) por sitio+id, 3) buscándolo entre los anuncios del sitio.
                        for (const path of [
                            `/direct/announcement/msg/${enc(ref.site)}/${enc(ref.channel)}/${enc(ref.id)}.json`,
                            `/direct/announcement/message/${enc(ref.site)}/${enc(ref.id)}.json`,
                        ]) {
                            const r = await aulaGet(this, path);
                            if (jsonOk(r) && r.data && typeof r.data === "object") {
                                const d = r.data as IDataObject;
                                found = matchesAnnouncement(d, ref) || d.title !== undefined ? d : sakaiList(d).find((a) => matchesAnnouncement(a, ref));
                                if (found) break;
                            }
                        }
                        if (!found) {
                            const r = await aulaGet(this, `/direct/announcement/site/${enc(ref.site)}.json`, { n: 200, d: 3650 });
                            if (jsonOk(r)) found = sakaiList(r.data).find((a) => matchesAnnouncement(a, ref));
                        }
                        if (!found) throw new NodeOperationError(this.getNode(), `No se encontró el anuncio ${ref.site}/${ref.id}`, { itemIndex: i });
                        emit(found);
                    }
                } else if (resource === "avCalendar" || resource === "avExam" || resource === "avForum" || resource === "avMail" || resource === "avMessages") {
                    const { base } = await getWebSession(this);
                    const enc = (v: string) => encodeURIComponent(v);
                    const fetchJson = async (path: string, query: Record<string, string> = {}) => {
                        const r = await aulaGet(this, path, query);
                        if (!r.isJson || r.statusCode >= 400)
                            throw new NodeOperationError(this.getNode(), `Aula Virtual respondió HTTP ${r.statusCode} sin JSON en ${path}`, { itemIndex: i });
                        return r.data;
                    };
                    const wholeOrList = (d: unknown): IDataObject[] => {
                        const l = sakaiList(d);
                        if (l.length || !d || typeof d !== "object" || Array.isArray(d)) return l;
                        // Una colección vacía es una lista vacía; cualquier otro objeto es un único elemento.
                        return Object.keys(d).some((k) => /_collection$/.test(k)) ? [] : [d as IDataObject];
                    };
                    const site = (): string => {
                        const v = (this.getNodeParameter("avSiteId", i) as string).trim();
                        if (!v) throw new NodeOperationError(this.getNode(), "Indica el sitio", { itemIndex: i });
                        return v;
                    };

                    if (resource === "avCalendar") {
                        const query: Record<string, string> = {};
                        const from = (this.getNodeParameter("avFirstDate", i, "") as string).trim();
                        const to = (this.getNodeParameter("avLastDate", i, "") as string).trim();
                        if (from) query.firstDate = from;
                        if (to) query.lastDate = to;
                        const path = operation === "getSite" ? `/direct/calendar/site/${enc(site())}.json` : "/direct/calendar/my.json";
                        for (const e of wholeOrList(await fetchJson(path, query))) push(simplify ? normalizeSakaiCalendarEvent(e, base) : e);
                    } else if (resource === "avExam") {
                        const { exams, sitiosConsultados } = await fetchAvExams(this, (this.getNodeParameter("examSite", i, "") as string).trim());
                        if (!exams.length)
                            push({ evento: "examAv", sinResultados: true, sitiosConsultados, aviso: "Ninguna forma de consulta devolvió evaluaciones." });
                        exams.sort((a, b) => a.sortDate.localeCompare(b.sortDate));
                        for (const x of exams) push(simplify ? x.item : (x.item.raw as IDataObject));
                    } else if (resource === "avForum") {
                        const siteId = site();
                        const forum = (this.getNodeParameter("avForumId", i, "") as string).trim();
                        const topic = (this.getNodeParameter("avTopicId", i, "") as string).trim();
                        let path = `/direct/forums/site/${enc(siteId)}.json`;
                        if (forum) path = `/direct/forums/site/${enc(siteId)}/forum/${enc(forum)}.json`;
                        if (forum && topic) path = `/direct/forums/site/${enc(siteId)}/forum/${enc(forum)}/topic/${enc(topic)}.json`;
                        for (const e of wholeOrList(await fetchJson(path))) push(e);
                    } else if (resource === "avMail") {
                        const siteId = site();
                        for (const m of wholeOrList(await fetchJson(`/direct/mailarchive/siteMessages/${enc(siteId)}.json`)))
                            push(simplify ? normalizeSakaiMail(m, siteId) : m);
                    } else {
                        for (const c of wholeOrList(await fetchJson("/direct/synopticmsgcntritem.json")))
                            push(simplify ? normalizeSakaiMessageCounts(c) : c);
                    }
                } else if (resource === "avRequest") {
                    const res = await aulaGet(this, this.getNodeParameter("avPath", i) as string);
                    // Petición libre: se devuelve tal cual, sin decodificar entidades.
                    out.push({
                        pairedItem: i, json: {
                            statusCode: res.statusCode,
                            url: res.url,
                            data: res.isJson ? (res.data as IDataObject) : String(res.data).slice(0, 20000),
                        }
                    });
                } else if (resource === "task" && operation === "getAll") {
                    const { base } = await getWebSession(this);
                    const res = await aulaGet(this, "/direct/assignment/my.json");
                    if (!res.isJson || res.statusCode >= 400)
                        throw new NodeOperationError(this.getNode(), `Aula Virtual respondió HTTP ${res.statusCode} sin JSON en /direct/assignment/my.json`, { itemIndex: i });
                    for (const a of sakaiList(res.data)) push(simplify ? normalizeSakaiAssignment(a, base) : a);
                } else if (resource === "task" && operation === "get") {
                    const id = parseAssignmentId(this.getNodeParameter("taskId", i) as string);
                    if (!id) throw new NodeOperationError(this.getNode(), "Indica el ID de la tarea", { itemIndex: i });
                    const { base } = await getWebSession(this);

                    // 1) Directo por ID.
                    let task: IDataObject | undefined;
                    const direct = await aulaGet(this, `/direct/assignment/item/${encodeURIComponent(id)}.json`);
                    if (direct.isJson && direct.statusCode < 400) {
                        const d = direct.data as IDataObject;
                        task = matchesAssignment(d, id) ? d : sakaiList(d).find((a) => matchesAssignment(a, id));
                    }
                    // 2) Si el endpoint por ID no sirve en este Sakai, se busca en «mis tareas».
                    if (!task) {
                        const mine = await aulaGet(this, "/direct/assignment/my.json");
                        if (mine.isJson && mine.statusCode < 400) task = sakaiList(mine.data).find((a) => matchesAssignment(a, id));
                    }
                    if (!task) throw new NodeOperationError(this.getNode(), `No se encontró la tarea ${id} en Aula Virtual`, { itemIndex: i });
                    push(simplify ? normalizeSakaiAssignment(task, base) : task);
                } else if (resource === "calendar" && operation === "getAll") {
                    const from = new Date(this.getNodeParameter("from", i) as string);
                    const to = new Date(this.getNodeParameter("to", i) as string);
                    const body = await getEndpoint(this, {
                        method: "GET",
                        endpoint: "/umuapp/rest/v1.0/private/cidu/calendario/eventos/usuario",
                        host: "umuapp",
                        query: {
                            desde: formatUmQuery(from),
                            hasta: formatUmQuery(to),
                            limite: this.getNodeParameter("limit", i) as number,
                            festivos: this.getNodeParameter("holidays", i) as boolean,
                        },
                    });
                    push(body.body.datos);
                    // for (const e of extractList(body, ["id"])) {
                    //     const kind = classify(`${e.tipo ?? ""} ${e.subtipo ?? ""} ${e.titulo ?? ""}`, rules);
                    //     push(simplify ? normalizeCalendarEvent(e, kind ?? "calendarEvent") : e);
                    // }
                } else if (resource === "alert" && operation === "getAll") {
                    const f = this.getNodeParameter("filters", i, {}) as IDataObject;

                    const qs: IDataObject = {
                        size: this.getNodeParameter("limit", i) as number,
                        // fecha_desde: formatUmQuery(from),
                        // fecha_hasta: formatUmQuery(to),
                    };
                    if (f.category) qs.codigo_categoria = f.category;
                    if (f.text) qs.filtro = f.text;
                    if (Array.isArray(f.states) && f.states.length) qs.estados = f.states as string[];
                    // const body = await umuappRequest(this, "GET", "/private/cidu/notimovil/alertas/usuario", { qs });
                    const body = await getEndpoint(this, {
                        method: "GET",
                        host: "api",
                        endpoint: "/cidu/notimovil-api/private/v3.0/alertas",
                        query: qs,
                    });
                    push(body.body.datos);
                    // for (const a of extractList(body, ["codigo_alerta"])) {
                    //     const kind = classify(`${a.aplicacion ?? ""} ${a.categoria ?? ""} ${a.titulo ?? ""}`, rules);
                    //     push(simplify ? normalizeAlert(a, kind ?? "alert") : a);
                    // }
                } else if (resource === "alert" && operation === "get") {
                    const id = this.getNodeParameter("alertId", i) as number;
                    const qs: IDataObject = {};
                    if (this.getNodeParameter("markRead", i) as boolean) qs.leer = true;
                    // const body = await umuappRequest(this, "GET", `/private/cidu/notimovil/alertas/${id}`, { qs });
                    const body = await getEndpoint(this, {
                        method: "GET",
                        host: "api",
                        endpoint: `/cidu/notimovil-api/private/v3.0/alertas/${id}`,
                        query: qs
                    });
                    push(body.body);
                    // for (const a of extractList(body, ["codigo_alerta"])) {
                    //     const kind = classify(`${a.aplicacion ?? ""} ${a.categoria ?? ""} ${a.titulo ?? ""}`, rules);
                    //     push(simplify ? normalizeAlert(a, kind ?? "alert") : a);
                    // }
                } else if (resource === "alert" && operation === "setState") {
                    const ids = (this.getNodeParameter("alertIds", i) as string)
                        .split(",")
                        .map((s) => Number(s.trim()))
                        .filter((n) => Number.isFinite(n) && n > 0);
                    if (!ids.length) throw new NodeOperationError(this.getNode(), "Indica al menos un ID de alerta", { itemIndex: i });
                    // const body = await umuappRequest(this, "PUT", "/private/cidu/notimovil/alertas/usuario/estado", {
                    //     body: { ids_alerta: ids, estado: this.getNodeParameter("state", i) as string },
                    // });
                    const body = await getEndpoint(this, {
                        method: "PUT",
                        host: "umuapp",
                        endpoint: "/cidu/notimovil-api/private/v3.0/alertas/estado",
                        body: {
                            ids_alerta: ids,
                            estado: this.getNodeParameter("state", i) as string,
                        }
                    });
                    push((body && typeof body === "object" ? body : { ok: true }) as IDataObject);
                } else if (resource === "subject" && operation === "getAll") {
                    // const body = await umuappRequest(this, "GET", "/private/asignaturas");
                    const body = await getEndpoint(this, {
                        method: "GET",
                        host: "umuapp",
                        endpoint: "/umuapp/rest/v1.0/private/asignaturas",
                    });
                    // push(body)
                    const subjects = this.getNodeParameter("lastYear", i) as boolean ?
                        body.body.est_oficiales[0].titulaciones.map((t: { asignaturas: object[]; }) => t.asignaturas) :
                        body.body.est_oficiales.map((e: { titulaciones: { asignaturas: object[]; }[]; }) =>
                            e.titulaciones.map((t: { asignaturas: object[]; }) => t.asignaturas)).flat(Infinity);
                    push(subjects.flat(Infinity));
                } else if (resource === "subject" && operation === "getTasks") {
                    const siteId = this.getNodeParameter("siteId", i) as string;
                    // const body = await umuappRequest(this, "GET", `/private/asignaturas/sitios/${encodeURIComponent(siteId)}/tareas`);
                    const body = await getEndpoint(this, {
                        method: "GET",
                        host: "umuapp",
                        endpoint: `/umuapp/rest/v1.0/private/asignaturas/sitios/${siteId}/tareas`
                    });
                    const list = extractList(body, ["id", "identificador", "codigo"]);
                    if (!list.length) push({ sitio: siteId, raw: body as IDataObject });
                    for (const t of list) push(simplify ? normalizeTask(t, siteId) : t);
                } else if (resource === "subject" && operation === "getAllTasks") {
                    // const subjects = await umuappRequest(this, "GET", "/private/asignaturas");
                    const subjects = await getEndpoint(this, {
                        method: "GET",
                        host: "umuapp",
                        endpoint: "/umuapp/rest/v1.0/private/asignaturas"
                    });
                    const siteIds: string[] = subjects.body.est_oficiales.map(
                        (e: { curso_academico: number; titulaciones: { tipo: string; asignaturas: { identificador: object[]; }[]; }[]; }) => {
                            const año = e.curso_academico;
                            return e.titulaciones.map((t: { tipo: string; asignaturas: { identificador: object[]; }[]; }) => {
                                const tipo = t.tipo;
                                return t.asignaturas.map((a: { identificador: object[]; }) => `${a.identificador}_${tipo}_${año}_N_N`)
                            })
                        }).flat(Infinity);
                    for (const siteId of siteIds) {
                        let body: IDataObject;
                        try {
                            // body = await umuappRequest(this, "GET", `/private/asignaturas/sitios/${encodeURIComponent(siteId)}/tareas`);
                            body = await getEndpoint(this, {
                                method: "GET",
                                host: "umuapp",
                                endpoint: `/umuapp/rest/v1.0/private/asignaturas/sitios/${siteId}/tareas`
                            });
                        } catch {
                            continue;
                        }
                        // for (const t of extractList(body, ["id", "identificador", "codigo"])) {
                        //     push(simplify ? normalizeTask(t, siteId) : t);
                        // }
                        push(body.body as IDataObject);
                    }
                } else {
                    throw new NodeOperationError(this.getNode(), `Operación no soportada: ${resource}/${operation}`, { itemIndex: i });
                }
            } catch (error) {
                if (this.continueOnFail()) {
                    out.push({ json: { error: (error as Error).message }, pairedItem: { item: i } });
                    continue;
                }
                throw new NodeOperationError(this.getNode(), error as Error, { itemIndex: i });
            }
        }

        return [out];
    }
}