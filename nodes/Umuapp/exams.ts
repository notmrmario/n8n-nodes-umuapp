import type { IDataObject } from 'n8n-workflow';
import { decodeEntities } from './functions';
import { normalizeSakaiExam, sakaiList } from './sakai';
import { aulaGet, Ctx } from './webview';

export interface ExamResult {
    key: string;
    item: IDataObject;
    sortDate: string;
}

/**
 * `sam_pub` solo lista las evaluaciones del «sitio actual» de la sesión (en el navegador, el último
 * que visitaste). Una sesión nueva no tiene sitio actual y devuelve vacío, así que se consulta sitio por sitio.
 * Se prueban varias formas de fijar el sitio y se recuerda la primera que funcione (`consulta` en la salida).
 */
const VARIANTS = ['contexto', 'siteId', 'portal'] as const;
type Variant = (typeof VARIANTS)[number];

async function getList(ctx: Ctx, path: string, query: Record<string, string> = {}): Promise<IDataObject[]> {
    const r = await aulaGet(ctx, path, query);
    if (!r.isJson || r.statusCode >= 400) return [];
    return sakaiList(r.data);
}

async function listForSite(ctx: Ctx, site: string, variant: Variant): Promise<IDataObject[]> {
    const enc = encodeURIComponent(site);
    switch (variant) {
        case 'contexto':
            return getList(ctx, `/direct/sam_pub/context/${enc}.json`);
        case 'siteId':
            return getList(ctx, '/direct/sam_pub.json', { siteId: site });
        default:
            // Entrar en el sitio como en el navegador y pedir la lista a continuación.
            await aulaGet(ctx, `/portal/site/${enc}`);
            return getList(ctx, '/direct/sam_pub.json');
    }
}

/** Ids de los sitios del usuario: los contadores de mensajes los listan todos; si no, las tareas. */
export async function listSiteIds(ctx: Ctx): Promise<string[]> {
    const ids = new Set<string>();
    for (const c of await getList(ctx, '/direct/synopticmsgcntritem.json')) if (typeof c.siteId === 'string') ids.add(c.siteId);
    if (!ids.size) for (const a of await getList(ctx, '/direct/assignment/my.json')) if (typeof a.context === 'string') ids.add(a.context);
    return [...ids];
}

export async function fetchAvExams(ctx: Ctx, onlySite = ''): Promise<{ exams: ExamResult[]; sitiosConsultados: number }> {
    const found = new Map<string, { e: IDataObject; consulta: string }>();
    const add = (list: IDataObject[], consulta: string) => {
        for (const e of list) found.set(String(e.publishedAssessmentId ?? e.id ?? e.title), { e, consulta });
    };

    // Sitio actual de la sesión (lo que ve el navegador), por si ya hay uno.
    let currentSite = '';
    if (!onlySite) {
        const current = await getList(ctx, '/direct/sam_pub.json');
        add(current, 'sitio actual');
        currentSite = String(current[0]?.ownerSiteId ?? '');
    }

    const sites = onlySite ? [onlySite] : await listSiteIds(ctx);
    let working: Variant | undefined;
    for (const site of sites) {
        const order = working ? [working] : [...VARIANTS];
        for (const v of order) {
            const list = await listForSite(ctx, site, v);
            const own = list.filter((e) => !e.ownerSiteId || e.ownerSiteId === site);
            if (own.length) {
                // En el sitio actual cualquier variante «funciona»: solo cuenta como prueba en otro sitio.
                if (site !== currentSite) working = v;
                add(own, v);
                break;
            }
            // Una variante que devuelve cosas de otros sitios no sirve para filtrar por sitio.
        }
    }

    const exams = [...found.entries()].map(([k, { e, consulta }]) => {
        const item: IDataObject = { ...normalizeSakaiExam(e, ''), evento: 'examAv', consulta };
        return { key: `avexam:test:${k}`, item, sortDate: String(item.inicio ?? '') };
    });
    return { exams, sitiosConsultados: sites.length };
}

// ---------------------------------------------------------------------------
// Examen a partir de una referencia (p. ej. la referencia_web de una alerta)
// ---------------------------------------------------------------------------

export interface ExamRef {
    site?: string;
    id?: string;
}

/**
 * Acepta: la `referencia_web` de una alerta de examen (`…/portal/site/{sitio}/tool/{uuid}`: solo da el sitio),
 * una referencia de Samigo (`/samigo/s/{sitio}/p/{id}`), `/sam_pub/{id}`, parámetros `publishedId=`/`publishedAssessmentId=`,
 * un número (id de la evaluación) o un id de sitio suelto.
 */
export function parseExamRef(input: string): ExamRef {
    let text = input.trim();
    try {
        text = decodeURIComponent(text);
    } catch {
        // texto con % suelto: se usa tal cual
    }
    const ref: ExamRef = {};
    const samigo = /\/samigo\/s\/([^/\s]+)\/p\/(\d+)/.exec(text);
    if (samigo) return { site: samigo[1], id: samigo[2] };
    const pub = /\/sam_pub\/(\d+)/.exec(text);
    if (pub) ref.id = pub[1];
    const param = /[?&;](?:publishedId|publishedAssessmentId|assessmentId)=(\d+)/i.exec(text);
    if (param) ref.id ??= param[1];
    const site = /\/(?:portal\/)?site\/([^/?&#\s]+)/.exec(text) ?? /[?&]siteId=([^&#\s]+)/.exec(text);
    if (site) ref.site = site[1];
    if (!ref.id && !ref.site) {
        if (/^\d+$/.test(text)) ref.id = text;
        else if (/^[A-Za-z0-9]+(?:_[A-Za-z0-9]+)+$/.test(text)) ref.site = text;
    }
    return ref;
}

const fold = (s: string) => decodeEntities(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

/** La descripción de una alerta de examen es «{título de la evaluación} - Autor: {autor}». */
export function parseExamAlertDescription(desc: string): { titulo: string; autor: string } {
    const text = decodeEntities(desc).trim();
    const m = /^(.*?)\s+-\s+Autor:\s*(.*)$/s.exec(text);
    return m ? { titulo: m[1].trim(), autor: m[2].trim() } : { titulo: text, autor: '' };
}

/**
 * Evaluaciones que corresponden a una referencia. Con la descripción de la alerta (o un trozo del título) se
 * elige la evaluación concreta: primero título igual; si no, que lo contenga. El autor desempata.
 */
export async function fetchAvExamByRef(
    ctx: Ctx,
    refText: string,
    titleContains = '',
    alertDescription = '',
): Promise<{ exams: ExamResult[]; ref: ExamRef; candidatos: string[]; criterio: string }> {
    const ref = parseExamRef(refText);
    if (!ref.id && !ref.site) throw new Error('No se reconoce la referencia: pasa la referencia_web de la alerta, un sitio o el id de la evaluación.');
    const { exams } = await fetchAvExams(ctx, ref.site ?? '');
    const fromAlert = alertDescription.trim() ? parseExamAlertDescription(alertDescription) : { titulo: '', autor: '' };
    const wanted = fold(titleContains.trim() || fromAlert.titulo);
    const author = fold(fromAlert.autor);

    let list = exams.filter((x) => {
        if (ref.id && String(x.item.id ?? '') !== ref.id) return false;
        return !(ref.site && x.item.sitio && x.item.sitio !== ref.site);
    });
    let criterio = ref.id ? 'id' : 'sitio';
    if (wanted) {
        const exact = list.filter((x) => fold(String(x.item.titulo ?? '')) === wanted);
        const part = list.filter((x) => fold(String(x.item.titulo ?? '')).includes(wanted));
        [list, criterio] = exact.length ? [exact, 'título igual'] : [part, 'título contiene'];
        if (list.length > 1 && author) {
            const byAuthor = list.filter((x) => fold(String((x.item.raw as IDataObject | undefined)?.lastModifiedBy ?? '')) === author);
            if (byAuthor.length) list = byAuthor;
        }
    }
    return { exams: list, ref, candidatos: exams.map((x) => String(x.item.titulo ?? '')), criterio };
}
