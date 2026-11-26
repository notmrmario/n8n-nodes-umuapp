import type { IDataObject } from 'n8n-workflow';
import { stripHtml, TIME_ZONE } from './functions';
import { sakaiTimeToIso } from './sakai';
import { aulaGet, Ctx, getWebSession } from './webview';

/** Id de sitio a partir de su URL (`/portal/site/{id}/…`, `/direct/site/{id}.json`, `?siteId=`) o del propio id. */
export function parseSiteRef(input: string): string {
    let text = input.trim();
    try {
        text = decodeURIComponent(text);
    } catch {
        // texto con % suelto: se usa tal cual
    }
    const m =
        /\/(?:portal\/(?:site|hierarchy)|direct\/site|site)\/([^/?&#\s]+)/.exec(text) ?? /[?&]siteId=([^&#\s]+)/.exec(text);
    if (m) return m[1].replace(/\.(json|xml|html)$/i, '');
    if (/[/?#\s]/.test(text)) return '';
    return text.replace(/\.(json|xml|html)$/i, '');
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);

function normalizeSitePages(pages: unknown): IDataObject[] {
    if (!Array.isArray(pages)) return [];
    return (pages as IDataObject[]).map((p) => ({
        id: p.id ?? null,
        titulo: p.title ?? null,
        url: p.url ?? null,
        herramientas: (Array.isArray(p.tools) ? (p.tools as IDataObject[]) : []).map((t) => ({
            herramienta: t.toolId ?? null,
            titulo: t.title ?? null,
            descripcion: t.description ?? null,
            idColocacion: t.placementId ?? null,
        })),
    }));
}

/** Sitio de Sakai (`/direct/site/{id}.json`, entidad EntitySite). `pages` es opcional (`…/pages.json`). */
export function normalizeSakaiSite(s: IDataObject, base: string, pages?: unknown): IDataObject {
    const id = str(s.id);
    const owner = (s.siteOwner as IDataObject | undefined) ?? undefined;
    const out: IDataObject = {
        evento: 'siteAv',
        fuente: 'aulavirtual',
        id,
        titulo: s.title ?? null,
        tipo: s.type ?? null,
        descripcion: s.description ?? null,
        descripcionTexto: stripHtml(s.htmlDescription ?? s.description ?? ''),
        descripcionCorta: s.shortDescription ?? null,
        publicado: s.published ?? null,
        vistaPublica: s.pubView ?? null,
        seUnePorSiSolo: s.joinable ?? null,
        rolAlUnirse: s.joinerRole ?? null,
        rolMantenimiento: s.maintainRole ?? null,
        creadoEn: sakaiTimeToIso(s.createdDate) ?? (s.createdDate ?? null),
        modificadoEn: sakaiTimeToIso(s.modifiedDate ?? s.lastModified) ?? null,
        propietario: s.owner ?? owner?.userId ?? null,
        propietarioNombre: owner?.userDisplayName ?? null,
        contactoNombre: s.contactName ?? null,
        contactoCorreo: s.contactEmail ?? null,
        idGrupoProveedor: s.providerGroupId ?? null,
        icono: s.iconUrlFull ?? s.iconUrl ?? null,
        urlInfo: s.infoUrlFull ?? s.infoUrl ?? null,
        urlSitio: id ? `${base}/portal/site/${encodeURIComponent(id)}` : null,
        referencia: s.reference ?? null,
        grupos: s.siteGroupsList ?? s.siteGroups ?? null,
        propiedades: s.props ?? null,
        zonaHoraria: TIME_ZONE,
        raw: s,
    };
    const list = pages ?? s.sitePages;
    if (list !== undefined) out.paginas = normalizeSitePages(list);
    return out;
}

export interface SiteFetch {
    site?: IDataObject;
    pages?: unknown;
    statusCode: number;
}

export async function fetchSite(ctx: Ctx, id: string, opts: { groups?: boolean; pages?: boolean } = {}): Promise<SiteFetch> {
    const enc = encodeURIComponent(id);
    const r = await aulaGet(ctx, `/direct/site/${enc}.json`, opts.groups ? { includeGroups: 'true' } : {});
    if (!r.isJson || r.statusCode >= 400 || !r.data || typeof r.data !== 'object') return { statusCode: r.statusCode };
    let pages: unknown;
    if (opts.pages) {
        const p = await aulaGet(ctx, `/direct/site/${enc}/pages.json`);
        if (p.isJson && p.statusCode < 400) pages = Array.isArray(p.data) ? p.data : [];
    }
    return { site: r.data as IDataObject, pages, statusCode: r.statusCode };
}

// ---------------------------------------------------------------------------
// Título real de los sitios
// ---------------------------------------------------------------------------

const TITLE_TTL_MS = 60 * 60 * 1000;
const titleCache = new Map<string, { title: string; at: number }>();

/**
 * Los anuncios y eventos del calendario traen el título del sitio «actual» de la sesión (siempre «Mi Sitio»), no el suyo.
 * El título bueno es el de `/direct/site/{id}.json`. Se consulta una vez por sitio y se recuerda una hora.
 * Si una consulta falla, el elemento se queda como estaba: esto nunca rompe la salida.
 */
export async function enrichSiteTitles(ctx: Ctx, items: IDataObject[]): Promise<void> {
    const wanted = items.filter((i) => (i.evento === 'announcementAv' || i.evento === 'calendarEventAv') && typeof i.sitio === 'string' && i.sitio);
    if (!wanted.length) return;
    let base: string;
    try {
        base = (await getWebSession(ctx)).base;
    } catch {
        return;
    }
    const now = Date.now();
    for (const id of new Set(wanted.map((i) => i.sitio as string))) {
        const key = `${base}|${id}`;
        const hit = titleCache.get(key);
        if (hit && now - hit.at < TITLE_TTL_MS) continue;
        let title = '';
        try {
            const r = await aulaGet(ctx, `/direct/site/${encodeURIComponent(id)}.json`);
            if (r.isJson && r.statusCode < 400) title = str((r.data as IDataObject)?.title) ?? '';
        } catch {
            // se deja el título que ya traía
        }
        titleCache.set(key, { title, at: now });
    }
    for (const i of wanted) {
        const title = titleCache.get(`${base}|${i.sitio as string}`)?.title;
        if (title) i.sitioTitulo = title;
    }
}

export function clearSiteTitleCache(): void {
    titleCache.clear();
}
