import type {
    IDataObject,
    IExecuteFunctions,
    ILoadOptionsFunctions,
    IPollFunctions,
} from 'n8n-workflow';

export type Ctx = IExecuteFunctions | IPollFunctions | ILoadOptionsFunctions;

export const TIME_ZONE = 'Europe/Madrid';

// ---------------------------------------------------------------------------
// Fechas
// ---------------------------------------------------------------------------

function madridParts(date: Date): Record<string, string> {
    const dtf = new Intl.DateTimeFormat('en-US', {
        timeZone: TIME_ZONE,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    });
    const out: Record<string, string> = {};
    for (const p of dtf.formatToParts(date)) out[p.type] = p.value;
    if (out.hour === '24') out.hour = '00';
    return out;
}

function offsetMinutes(utcMs: number): number {
    const p = madridParts(new Date(utcMs));
    const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
    return Math.round((asUtc - utcMs) / 60000);
}

const pad = (n: number) => String(n).padStart(2, '0');

function isoWithOffset(utcMs: number): string {
    const off = offsetMinutes(utcMs);
    const p = madridParts(new Date(utcMs));
    const sign = off >= 0 ? '+' : '-';
    const abs = Math.abs(off);
    return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/**
 * Convierte "dd/MM/yyyy[ HH:mm[:ss]]" (hora de Madrid) a ISO 8601 con offset.
 * Acepta también ISO 8601 y epoch en milisegundos. Devuelve null si no entiende el valor.
 */
export function toIsoMadrid(value: unknown): string | null {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'number' && Number.isFinite(value)) return isoWithOffset(value);
    if (typeof value !== 'string') return null;
    const s = value.trim();

    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(s);
    if (m) {
        const wall = Date.UTC(+m[3], +m[2] - 1, +m[1], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0));
        let utc = wall - offsetMinutes(wall) * 60000;
        utc = wall - offsetMinutes(utc) * 60000;
        return isoWithOffset(utc);
    }

    if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
        const t = Date.parse(s);
        if (!Number.isNaN(t)) return /[zZ]|[+-]\d{2}:?\d{2}$/.test(s) ? isoWithOffset(t) : toIsoMadrid(
            `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)} ${s.slice(11, 16) || '00:00'}`,
        );
    }
    return null;
}

/** Formato dd/MM/yyyy HH:mm en hora de Madrid, el que esperan los parámetros `desde` y `hasta`. */
export function formatUmQuery(date: Date): string {
    const p = madridParts(date);
    return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}:${p.second}`;
}

/** Busca fechas dd/mm/aaaa [hh:mm] dentro de un texto libre (heurístico). */
export function extractDates(text: string): string[] {
    const out: string[] = [];
    const re = /(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:[^\d]{1,15}?(\d{1,2}):(\d{2}))?/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
        const iso = toIsoMadrid(`${m[1]}/${m[2]}/${m[3]} ${m[4] ?? '0'}:${m[5] ?? '00'}`);
        if (iso && !out.includes(iso)) out.push(iso);
    }
    return out;
}

export function stripHtml(html: unknown): string {
    if (typeof html !== 'string') return '';
    return html
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

// ---------------------------------------------------------------------------
// Respuestas -> listas
// ---------------------------------------------------------------------------

const LIST_KEYS = ['datos', 'eventos', 'alertas', 'tareas', 'data', 'items', 'content', 'resultado'];

export function extractList(body: unknown, idKeys: string[] = ['id', 'codigo_alerta']): IDataObject[] {
    if (Array.isArray(body)) return body as IDataObject[];
    if (body && typeof body === 'object') {
        const obj = body as IDataObject;
        for (const k of LIST_KEYS) if (Array.isArray(obj[k])) return obj[k] as IDataObject[];
        if (idKeys.some((k) => obj[k] !== undefined)) return [obj];
    }
    return [];
}

/** Recorre el JSON y devuelve todos los valores no vacíos de las claves `id`. */
export function collectSiteIds(node: unknown, out = new Set<string>()): string[] {
    if (Array.isArray(node)) node.forEach((n) => collectSiteIds(n, out));
    else if (node && typeof node === 'object') {
        for (const [k, v] of Object.entries(node as IDataObject)) {
            if (k === 'id' && typeof v === 'string' && v.trim()) out.add(v.trim());
            else collectSiteIds(v, out);
        }
    }
    return [...out];
}

// ---------------------------------------------------------------------------
// Clasificación de eventos
// ---------------------------------------------------------------------------

export type EventType = 'alert' | 'announcement' | 'exam' | 'task' | 'taskChanged' | 'grade' | 'calendarEvent';

export interface Rules {
    exam: RegExp;
    announcement: RegExp;
    task: RegExp;
    grade: RegExp;
}

export const DEFAULT_RULES = {
    exam: 'examen|ex[aá]menes|llamamiento|convocatoria de examen|prueba final',
    announcement: 'anuncio|aviso|comunicado|novedad',
    task: 'tarea|entrega|pr[aá]ctica',
    grade: 'calificad|calificaci[oó]n|nota',
};

export function buildRules(custom: Partial<Record<keyof typeof DEFAULT_RULES, string>> = {}): Rules {
    const mk = (v: string | undefined, d: string) => new RegExp(v && v.trim() ? v : d, 'i');
    return {
        exam: mk(custom.exam, DEFAULT_RULES.exam),
        announcement: mk(custom.announcement, DEFAULT_RULES.announcement),
        task: mk(custom.task, DEFAULT_RULES.task),
        grade: mk(custom.grade, DEFAULT_RULES.grade),
    };
}

/** Un único tipo semántico por elemento. Precedencia: calificación > examen > tarea > anuncio. */
export function classify(text: string, rules: Rules): EventType | null {
    if (rules.grade.test(text)) return 'grade';
    if (rules.exam.test(text)) return 'exam';
    if (rules.task.test(text)) return 'task';
    if (rules.announcement.test(text)) return 'announcement';
    return null;
}

// ---------------------------------------------------------------------------
// Normalización de salida
// ---------------------------------------------------------------------------

function pick(obj: IDataObject, keys: string[]): unknown {
    for (const k of keys) if (obj[k] !== undefined && obj[k] !== null && obj[k] !== '') return obj[k];
    return undefined;
}

export function normalizeAlert(a: IDataObject, evento: EventType, searchDescriptionDates = true): IDataObject {
    const descripcion = String(a.descripcion ?? '');
    return {
        evento,
        fuente: 'alerta',
        id: a.codigo_alerta,
        titulo: a.titulo ?? '',
        descripcion,
        descripcionTexto: stripHtml(descripcion),
        aplicacion: a.aplicacion ?? null,
        codigoAplicacion: a.codigo_aplicacion ?? null,
        categoria: a.categoria ?? null,
        codigoCategoria: a.codigo_categoria ?? null,
        servicioHijo: a.servicio_hijo ?? null,
        codigoServicioHijo: a.codigo_servicio_hijo ?? null,
        personal: a.personal ?? null,
        estado: a.estado ?? null,
        correoEmisor: a.correo_emisor ?? null,
        referenciaWeb: a.referencia_web ?? null,
        creadaEn: toIsoMadrid(a.fecha_creacion),
        enviadaEn: toIsoMadrid(a.fecha_envio),
        fechasDetectadas: searchDescriptionDates ? extractDates(`${a.titulo ?? ''} ${stripHtml(descripcion)}`) : [],
        raw: a,
    };
}

export function normalizeCalendarEvent(e: IDataObject, evento: EventType): IDataObject {
    const inicio = toIsoMadrid(e.inicio);
    const fin = toIsoMadrid(e.fin);
    const descripcion = typeof e.descripcion === 'string' ? e.descripcion : '';
    const descripcionTexto = stripHtml(descripcion);
    const observaciones = Array.isArray(e.observaciones) ? (e.observaciones as string[]) : [];
    const el = (e.elemento ?? {}) as IDataObject;
    const allDay = e.dia === true;
    const ubicacion = (e.ubicacion as string) ?? '';
    const localizacion = (e.localizacion as string) ?? '';
    const descParts = [descripcionTexto, ...observaciones.map((o) => `• ${o}`)];
    if (localizacion) descParts.push(`Mapa: ${localizacion}`);

    return {
        evento,
        fuente: 'calendario',
        id: e.id,
        titulo: e.titulo ?? '',
        descripcion,
        descripcionTexto,
        inicio,
        fin,
        diaCompleto: allDay,
        zonaHoraria: TIME_ZONE,
        inicioOriginal: e.inicio ?? null,
        finOriginal: e.fin ?? null,
        registradoEn: toIsoMadrid(e.registro),
        ubicacion,
        mapsUrl: localizacion,
        tipo: e.tipo ?? null,
        subtipo: e.subtipo ?? null,
        codigoTipo: e.codigotipo ?? null,
        codigoSubtipo: e.codigoSubtipo ?? null,
        observaciones,
        asignatura: {
            item: el.item ?? null,
            curso_academico: el.curso_academico ?? null,
            curso: el.curso ?? null,
            cuatrimestre: el.cuatrimestre ?? null,
            titulacion: el.titulacion ?? null,
            grupo: el.grupo ?? null,
            descripcionGrupo: el.descripcionGrupo ?? null,
            subgrupo: el.subgrupo ?? null,
            codigoSubgrupo: el.codigoSubgrupo ?? null,
        },
        // Listo para mapear en el nodo de Google Calendar (Create Event)
        googleCalendar: {
            summary: e.titulo ?? '',
            description: descParts.filter(Boolean).join('\n'),
            location: ubicacion,
            start: inicio,
            end: fin,
            allDay,
            timeZone: TIME_ZONE,
        },
        raw: e,
    };
}

export function normalizeTask(t: IDataObject, siteId: string, evento: EventType = 'task'): IDataObject {
    const due = pick(t, ['fecha_limite', 'fechaLimite', 'fecha_entrega', 'dueDate', 'due', 'fin', 'fecha_fin']);
    const open = pick(t, ['fecha_inicio', 'fecha_apertura', 'apertura', 'openDate', 'open', 'inicio']);
    const title = String(pick(t, ['titulo', 'title', 'nombre', 'name']) ?? '');
    const description = String(pick(t, ['instrucciones', 'descripcion', 'instructions', 'description']) ?? '');
    const dueIso = toIsoMadrid(due);
    return {
        evento,
        fuente: 'tareas',
        id: pick(t, ['id_tarea', 'id', 'identificador', 'codigo', 'codigo_tarea']) ?? null,
        sitio: siteId,
        titulo: title,
        descripcion: description,
        descripcionTexto: stripHtml(description),
        apertura: toIsoMadrid(open) ?? (open ?? null),
        fechaLimite: dueIso ?? (due ?? null),
        estado: t.estado ?? null,
        activa: t.esta_activa ?? null,
        estimacion: t.estimacion ?? null,
        adjuntos: t.adjuntos ?? [],
        entrega: t.entrega ?? null,
        sitioInfo: t.sitio_info ?? null,
        zonaHoraria: TIME_ZONE,
        googleCalendar: dueIso
            ? { summary: title, description: stripHtml(description), start: dueIso, end: dueIso, allDay: false, timeZone: TIME_ZONE }
            : null,
        raw: t,
    };
}
