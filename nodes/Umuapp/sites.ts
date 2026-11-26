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
        // `sitePages` del propio sitio no trae herramientas; `pages.json` sí.
        ...(Array.isArray(p.tools)
            ? {
                  herramientas: (p.tools as IDataObject[]).map((t) => ({
                      herramienta: t.toolId ?? null,
                      titulo: t.title ?? null,
                      descripcion: t.description ?? null,
                      idColocacion: t.placementId ?? null,
                  })),
              }
            : {}),
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
        // `htmlDescription` viene escapado (&lt;p&gt;…): se parte de `description`, que es el HTML real.
        descripcionTexto: stripHtml(s.description ?? s.htmlDescription ?? ''),
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
    placementCache.clear();
}

// ---------------------------------------------------------------------------
// URL de un anuncio
// ---------------------------------------------------------------------------

const placementCache = new Map<string, { placement: string; at: number }>();

/** Id de la herramienta «Anuncios» (`sakai.announcements`) de un sitio: es distinto en cada sitio. */
async function announcementPlacement(ctx: Ctx, base: string, site: string): Promise<string> {
    const key = `${base}|${site}`;
    const hit = placementCache.get(key);
    if (hit && Date.now() - hit.at < TITLE_TTL_MS) return hit.placement;
    let placement = '';
    try {
        const r = await aulaGet(ctx, `/direct/site/${encodeURIComponent(site)}/pages.json`);
        if (r.isJson && r.statusCode < 400 && Array.isArray(r.data)) {
            for (const page of r.data as IDataObject[]) {
                const tool = (Array.isArray(page.tools) ? (page.tools as IDataObject[]) : []).find((t) => t.toolId === 'sakai.announcements');
                if (tool && typeof tool.placementId === 'string') {
                    placement = tool.placementId;
                    break;
                }
            }
        }
    } catch {
        // sin URL de anuncio, pero la salida sigue igual
    }
    placementCache.set(key, { placement, at: Date.now() });
    return placement;
}

/** Referencia `/announcement/msg/{sitio}/{canal}/{id}` a partir de los campos de un anuncio. */
export function announcementReference(item: IDataObject): string {
    const site = String(item.sitio ?? '');
    const id = String(item.id ?? '');
    const full = /\/announcement\/msg\/[^/\s]+\/[^/\s]+\/[^/?&#\s]+/.exec(id);
    if (full) return full[0];
    const msg = id.replace(/^.*\//, '');
    return `/announcement/msg/${site}/${String(item.canal || 'main')}/${msg}`;
}

/**
 * Añade `urlAnuncio` (enlace directo al anuncio en el Aula Virtual) a los anuncios. Hace falta el id de la herramienta
 * «Anuncios» del sitio, que se consulta una vez por sitio (`pages.json`) y se recuerda una hora. Sin él, `urlAnuncio` es null.
 */
export async function enrichAnnouncementUrls(ctx: Ctx, items: IDataObject[]): Promise<void> {
    const wanted = items.filter((i) => i.evento === 'announcementAv' && typeof i.sitio === 'string' && i.sitio && i.id);
    if (!wanted.length) return;
    let base: string;
    try {
        base = (await getWebSession(ctx)).base;
    } catch {
        return;
    }
    for (const site of new Set(wanted.map((i) => i.sitio as string))) {
        const placement = await announcementPlacement(ctx, base, site);
        for (const i of wanted.filter((w) => w.sitio === site)) {
            i.urlAnuncio = placement
                ? `${base}/portal/directtool/${placement}?itemReference=${announcementReference(i)}&sakai_action=doShowmetadata`
                : null;
        }
    }
}
