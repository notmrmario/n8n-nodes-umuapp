import { IDataObject, IExecuteFunctions, INodeExecutionData, INodeType, INodeTypeDescription, NodeConnectionTypes, NodeOperationError } from "n8n-workflow";
import { getEndpoint } from "./login";
import { extractList, formatUmQuery, normalizeTask } from "./functions";

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
                    { name: "Asignatura", value: "subject" },
                    { name: "Calendario", value: "calendar" },
                ],
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
                        resource: ["calendar", "alert", "subject"],
                        operation: ["getAll", "get", "getTasks", "getAllTasks"],
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
            const push = (json: IDataObject) => out.push({ json, pairedItem: i });

            try {
                if (resource === "calendar" && operation === "getAll") {
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