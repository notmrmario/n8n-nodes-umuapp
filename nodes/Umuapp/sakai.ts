import type { IDataObject } from 'n8n-workflow';
import { stripHtml, TIME_ZONE, toIsoMadrid } from './functions';

/** Sakai serializa fechas de varias formas según la versión: {time}, {epochSecond}, epoch o ISO. */
export function sakaiTimeToIso(v: unknown): string | null {
    if (v === null || v === undefined || v === '') return null;
    // Cadena de tiempo de Sakai: yyyyMMddHHmmssSSS en UTC (campos *TimeString).
    if (typeof v === 'string' && /^\d{17}$/.test(v)) {
        const n = (a: number, b: number) => Number(v.slice(a, b));
        return toIsoMadrid(Date.UTC(n(0, 4), n(4, 6) - 1, n(6, 8), n(8, 10), n(10, 12), n(12, 14), n(14, 17)));
    }
    if (typeof v === 'number') return toIsoMadrid(v > 1e11 ? v : v * 1000);
    if (typeof v === 'string') return /^\d{10,13}$/.test(v) ? sakaiTimeToIso(Number(v)) : toIsoMadrid(v);
    if (typeof v === 'object') {
        const o = v as IDataObject;
        if (typeof o.time === 'number') return toIsoMadrid(o.time);
        if (typeof o.epochSecond === 'number') return toIsoMadrid(o.epochSecond * 1000);
    }
    return null;
}

function firstString(o: IDataObject, keys: string[]): string {
    for (const k of keys) if (typeof o[k] === 'string' && o[k] !== '') return o[k] as string;
    return '';
}

export function normalizeSakaiAssignment(a: IDataObject, base: string): IDataObject {
    const site = firstString(a, ['context', 'siteId']);
    const title = firstString(a, ['title']);
    const instructions = firstString(a, ['instructions']);
    const due = sakaiTimeToIso(a.dueTime ?? a.dueDate) ?? sakaiTimeToIso(a.dueTimeString);
    return {
        evento: 'task',
        fuente: 'aulavirtual',
        id: a.id ?? null,
        sitio: site || null,
        titulo: title,
        instrucciones: instructions,
        instruccionesTexto: stripHtml(instructions),
        apertura: sakaiTimeToIso(a.openTime ?? a.openDate) ?? sakaiTimeToIso(a.openTimeString),
        fechaLimite: due,
        cierre: sakaiTimeToIso(a.closeTime ?? a.closeDate) ?? sakaiTimeToIso(a.closeTimeString),
        estado: a.status ?? null,
        borrador: a.draft ?? null,
        notaMaxima: a.gradeScaleMaxPoints ?? null,
        escalaNota: a.gradeScale ?? null,
        nombreGradebook: a.gradebookItemName ?? null,
        tipoEntrega: a.submissionType ?? null,
        permiteReenvio: a.allowResubmission ?? null,
        adjuntos: a.attachments ?? [],
        urlSitio: site ? `${base}/portal/site/${site}` : null,
        zonaHoraria: TIME_ZONE,
        googleCalendar: due
            ? { summary: title, description: stripHtml(instructions), start: due, end: due, allDay: false, timeZone: TIME_ZONE }
            : null,
        raw: a,
    };
}

/** Samigo (Tests y cuestionarios): los nombres de campo no están verificados, se aceptan varios. */
export function normalizeSakaiExam(e: IDataObject, siteId: string): IDataObject {
    const title = firstString(e, ['title', 'name', 'displayName']);
    const start = sakaiTimeToIso(e.startDate ?? e.start ?? e.openDate ?? e.availableDate);
    const due = sakaiTimeToIso(e.dueDate ?? e.due ?? e.endDate);
    const retract = sakaiTimeToIso(e.retractDate ?? e.lateHandling);
    const end = due ?? retract;
    return {
        evento: 'exam',
        fuente: 'aulavirtual',
        id: e.publishedAssessmentId ?? e.id ?? null,
        sitio: siteId || firstString(e, ['ownerSiteId', 'context']) || null,
        titulo: title,
        inicio: start,
        fin: end,
        limiteTiempo: e.timeLimit ?? null,
        intentosMax: e.maxAttempts ?? e.submissionsAllowed ?? null,
        zonaHoraria: TIME_ZONE,
        googleCalendar: start ? { summary: title, description: '', start, end: end ?? start, allDay: false, timeZone: TIME_ZONE } : null,
        raw: e,
    };
}

/** Saca la lista de un JSON de Sakai (`assignment_collection`, `*_collection`, array...). */
export function sakaiList(data: unknown): IDataObject[] {
    if (Array.isArray(data)) return data as IDataObject[];
    if (data && typeof data === 'object') {
        const o = data as IDataObject;
        for (const [k, v] of Object.entries(o)) if (/_collection$/.test(k) && Array.isArray(v)) return v as IDataObject[];
        for (const k of ['data', 'items', 'content', 'assessments', 'datos']) if (Array.isArray(o[k])) return o[k] as IDataObject[];
    }
    return [];
}

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/**
 * Saca el id de tarea de Sakai de lo que pegue el usuario: el id a secas (UUID), una referencia
 * `/assignment/a/{sitio}/{id}` o el enlace `referencia_web` de una alerta
 * (`…?assignmentId=/assignment/a/1898_G_2026_N_N/{id}&panel=Main…`).
 */
export function parseAssignmentId(input: string): string {
    const raw = input.trim();
    let text = raw;
    try {
        text = decodeURIComponent(raw);
    } catch {
        // texto con % suelto: se usa tal cual
    }
    const ref = /\/assignment\/a\/[^/\s]+\/([^/&?#\s]+)/.exec(text);
    if (ref) return ref[1];
    const uuids = text.match(UUID_RE);
    if (uuids?.length) return uuids[uuids.length - 1];
    return text.replace(/[?#].*$/, '').replace(/^.*\//, '');
}

export function matchesAssignment(a: IDataObject, id: string): boolean {
    if (String(a.id ?? '') === id) return true;
    return typeof a.reference === 'string' && a.reference.endsWith(`/${id}`);
}

export function normalizeSakaiAnnouncement(a: IDataObject, base: string): IDataObject {
    const body = firstString(a, ['body']);
    const site = firstString(a, ['siteId']);
    return {
        evento: 'announcementAv',
        fuente: 'aulavirtual',
        id: a.id ?? a.announcementId ?? null,
        sitio: site || null,
        sitioTitulo: a.siteTitle ?? null,
        titulo: firstString(a, ['title']),
        cuerpo: body,
        cuerpoTexto: stripHtml(body),
        autor: a.createdByDisplayName ?? null,
        creadoEn: sakaiTimeToIso(a.createdOn) ?? (a.createdOn ?? null),
        canal: a.channel ?? null,
        adjuntos: a.attachments ?? [],
        urlSitio: site ? `${base}/portal/site/${site}` : null,
        zonaHoraria: TIME_ZONE,
        raw: a,
    };
}

export interface AnnouncementRef {
    site: string;
    channel: string;
    id: string;
}

/**
 * Referencia de un anuncio de Sakai a partir de lo que pegue el usuario:
 * `/announcement/msg/{sitio}/{canal}/{id}` (como en el `referencia_web` de las alertas),
 * `/announcement/message/{sitio}/{id}` o `{sitio}/{id}`.
 */
export function parseAnnouncementRef(input: string): AnnouncementRef | undefined {
    let text = input.trim();
    try {
        text = decodeURIComponent(text);
    } catch {
        // texto con % suelto: se usa tal cual
    }
    const msg = /\/announcement\/msg\/([^/\s]+)\/([^/\s]+)\/([^/?&#\s]+)/.exec(text);
    if (msg) return { site: msg[1], channel: msg[2], id: msg[3] };
    const message = /\/announcement\/message\/([^/\s]+)\/([^/?&#\s]+)/.exec(text);
    if (message) return { site: message[1], channel: 'main', id: message[2] };
    const plain = /^([^/\s]+)\/([^/?&#\s]+)$/.exec(text);
    if (plain) return { site: plain[1], channel: 'main', id: plain[2] };
    return undefined;
}

export function matchesAnnouncement(a: IDataObject, ref: AnnouncementRef): boolean {
    return String(a.announcementId ?? '') === ref.id || String(a.id ?? '').endsWith(`/${ref.id}`) || String(a.id ?? '') === ref.id;
}

/** Evento del calendario de Sakai (`/direct/calendar/…`): CalendarEventSummary. */
export function normalizeSakaiCalendarEvent(e: IDataObject, base: string): IDataObject {
    const title = firstString(e, ['title']);
    const description = firstString(e, ['description']);
    const start = sakaiTimeToIso(e.firstTime);
    const duration = typeof e.duration === 'number' ? e.duration : Number(e.duration);
    const end = start && Number.isFinite(duration) && duration > 0 ? toIsoMadrid(Date.parse(start) + duration) : start;
    const site = firstString(e, ['siteId']);
    return {
        evento: 'calendarEventAv',
        fuente: 'aulavirtual',
        id: e.eventId ?? null,
        sitio: site || null,
        sitioNombre: e.siteName ?? null,
        titulo: title,
        descripcion: description,
        descripcionTexto: stripHtml(description),
        tipo: e.type ?? null,
        inicio: start,
        fin: end,
        duracionMs: Number.isFinite(duration) ? duration : null,
        idTarea: e.assignmentId ?? null,
        creador: e.creator ?? null,
        recurrencia: e.recurrenceRule ?? null,
        urlSitio: site ? `${base}/portal/site/${site}` : null,
        zonaHoraria: TIME_ZONE,
        googleCalendar: start
            ? { summary: title, description: stripHtml(description), start, end: end ?? start, allDay: false, timeZone: TIME_ZONE }
            : null,
        raw: e,
    };
}

/** Mensaje del archivo de correo de un sitio (`/direct/mailarchive/…`). */
export function normalizeSakaiMail(m: IDataObject, siteId: string): IDataObject {
    const body = firstString(m, ['body']);
    const headers = Array.isArray(m.headers) ? (m.headers as unknown[]).map(String) : [];
    const header = (name: string) =>
        headers.find((h) => h.toLowerCase().startsWith(`${name.toLowerCase()}:`))?.slice(name.length + 1).trim() ?? null;
    return {
        evento: 'mail',
        fuente: 'aulavirtual',
        id: m.id ?? m.messageId ?? null,
        sitio: siteId || null,
        asunto: header('subject') ?? firstString(m, ['subject', 'title']),
        de: header('from') ?? m.createdByDisplayName ?? null,
        cuerpo: body,
        cuerpoTexto: stripHtml(body),
        creadoEn: sakaiTimeToIso(m.createdOn) ?? (m.createdOn ?? null),
        adjuntos: m.attachments ?? [],
        raw: m,
    };
}

/** Contadores del centro de mensajes (`/direct/synopticmsgcntritem`): no trae el texto de los mensajes. */
export function normalizeSakaiMessageCounts(c: IDataObject): IDataObject {
    const num = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null);
    return {
        evento: 'privateMessageCounts',
        fuente: 'aulavirtual',
        sitio: c.siteId ?? null,
        sitioTitulo: c.siteTitle ?? null,
        mensajesPrivadosNuevos: num(c.newMessagesCount),
        mensajesForoNuevos: num(c.newForumCount),
        raw: c,
    };
}
