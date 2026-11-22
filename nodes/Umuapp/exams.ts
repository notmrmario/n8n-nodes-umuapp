import type { IDataObject } from 'n8n-workflow';
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
