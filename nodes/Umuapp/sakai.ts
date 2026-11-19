import type { IDataObject } from 'n8n-workflow';
import { stripHtml, TIME_ZONE, toIsoMadrid } from './functions';

/** Sakai serializa fechas de varias formas según la versión: {time}, {epochSecond}, epoch o ISO. */
export function sakaiTimeToIso(v: unknown): string | null {
    if (v === null || v === undefined || v === '') return null;
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
    const due = sakaiTimeToIso(a.dueTime ?? a.dueDate);
    return {
        evento: 'task',
        fuente: 'aulavirtual',
        id: a.id ?? null,
        sitio: site || null,
        titulo: title,
        instrucciones: instructions,
        instruccionesTexto: stripHtml(instructions),
        apertura: sakaiTimeToIso(a.openTime ?? a.openDate),
        fechaLimite: due,
        cierre: sakaiTimeToIso(a.closeTime ?? a.closeDate),
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
