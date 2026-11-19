import type {
    IDataObject,
    IExecuteFunctions,
    IHttpRequestOptions,
    ILoadOptionsFunctions,
    IPollFunctions,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

export type Ctx = IExecuteFunctions | IPollFunctions | ILoadOptionsFunctions;

export const DEFAULT_CAS_URL = 'https://entrada.um.es/cas';
export const DEFAULT_AULA_URL = 'https://aulavirtual.um.es';
/** Servicio que valida el ticket en Sakai (Aula Virtual). Es una suposición: ver README. */
export const DEFAULT_SERVICE_PATH = '/sakai-login-tool/container';

const MAX_REDIRECTS = 8;
const SESSION_TTL_MS = 20 * 60_000; // Sakai cierra la sesión a los ~30 min de inactividad

export interface WebCreds {
    username: string;
    password: string;
    appAuthToken?: string;
    casUrl?: string;
    aulaVirtualUrl?: string;
    aulaServiceUrl?: string;
    userAgent?: string;
}

interface FullResponse {
    statusCode: number;
    headers: Record<string, string | string[] | undefined>;
    body: unknown;
}

/** cookies por host: host -> nombre -> valor */
type Jar = Record<string, Record<string, string>>;

interface WebSession {
    jar: Jar;
    base: string;
    userEid: string | null;
    expiresAt: number;
    /** cabeceras opcionales (User-Agent) para las peticiones posteriores */
    headers: Record<string, string>;
}

const sessions = new Map<string, WebSession>();

export function clearSessions(): void {
    sessions.clear();
}

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

export function formEncode(data: Record<string, string | number | boolean>): string {
    return Object.entries(data)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        .join('&');
}

const trimSlash = (u: string) => u.replace(/\/+$/, '');

// Sin el global URL: el tsconfig de la plantilla no incluye tipos de Node ni DOM.
const hostOf = (u: string): string => /^https?:\/\/([^/?#]+)/i.exec(u)?.[1].toLowerCase() ?? '';
const originOf = (u: string): string => /^(https?:\/\/[^/?#]+)/i.exec(u)?.[1] ?? '';
const pathOf = (u: string): string => /^https?:\/\/[^/?#]+([^?#]*)/i.exec(u)?.[1] ?? '';
function resolveLocation(loc: string, from: string): string {
    if (/^https?:\/\//i.test(loc)) return loc;
    if (loc.startsWith('//')) return `https:${loc}`;
    if (loc.startsWith('/')) return `${originOf(from)}${loc}`;
    return `${from.replace(/[?#].*$/, '').replace(/[^/]*$/, '')}${loc}`;
}

function asArray(v: string | string[] | undefined): string[] {
    if (v === undefined) return [];
    return Array.isArray(v) ? v : [v];
}

function header(res: FullResponse, name: string): string | undefined {
    const v = res.headers[name.toLowerCase()];
    return Array.isArray(v) ? v[0] : v;
}

function storeCookies(jar: Jar, host: string, res: FullResponse): void {
    for (const line of asArray(res.headers['set-cookie'])) {
        const [pair, ...attrs] = line.split(';');
        const eq = pair.indexOf('=');
        if (eq <= 0) continue;
        const name = pair.slice(0, eq).trim();
        const value = pair.slice(eq + 1).trim();
        const expired = attrs.some((a) => {
            const at = a.trim().toLowerCase();
            return at === 'max-age=0' || (at.startsWith('expires=') && Date.parse(at.slice(8)) < Date.now());
        });
        jar[host] ??= {};
        if (expired || value === '') delete jar[host][name];
        else jar[host][name] = value;
    }
}

function cookieHeader(jar: Jar, host: string): string | undefined {
    const c = jar[host];
    if (!c || !Object.keys(c).length) return undefined;
    return Object.entries(c).map(([k, v]) => `${k}=${v}`).join('; ');
}

const CONN_RE = /closed unexpectedly|ECONNRESET|socket hang up|ETIMEDOUT|ECONNREFUSED|ENOTFOUND|EAI_AGAIN/i;
const CLOSED_RE = /closed unexpectedly|ECONNRESET|socket hang up/i;

/** Destino sin secretos: sin query (lleva `ticket=ST-…`) y con el id del TGT tapado. */
function safeTarget(url: string): string {
    return `${hostOf(url)}${pathOf(url).replace(/\/TGT-[^/]+/i, '/TGT-…')}`;
}

async function raw(ctx: Ctx, opts: IHttpRequestOptions, step: string): Promise<FullResponse> {
    for (let attempt = 0; ; attempt++) {
        try {
            return (await ctx.helpers.httpRequest({
                ...opts,
                ignoreHttpStatusErrors: true,
                returnFullResponse: true,
                disableFollowRedirect: true,
            })) as unknown as FullResponse;
        } catch (error) {
            const msg = (error as Error).message ?? String(error);
            if (attempt === 0 && CONN_RE.test(msg)) continue; // un único reintento si la conexión cae
            const hint = CLOSED_RE.test(msg)
                ? ' El servidor cerró la conexión sin responder (suele ser un filtro o balanceador que rechaza la petición). Comprueba que «Token de aplicación» está rellenado en la credencial; si sigue igual, prueba a rellenar «User-Agent».'
                : '';
            throw new NodeOperationError(
                ctx.getNode(),
                `Aula Virtual, paso «${step}» (${opts.method ?? 'GET'} ${safeTarget(opts.url)}): ${msg}.${hint}`,
            );
        }
    }
}

/** GET siguiendo redirecciones a mano para conservar las cookies de cada host. */
async function getWithJar(ctx: Ctx, startUrl: string, jar: Jar, extraHeaders: IDataObject, step: string) {
    let url = startUrl;
    for (let i = 0; i <= MAX_REDIRECTS; i++) {
        const host = hostOf(url);
        const cookie = cookieHeader(jar, host);
        const res = await raw(ctx, {
            url,
            method: 'GET',
            headers: { ...(extraHeaders as Record<string, string>), ...(cookie ? { Cookie: cookie } : {}) },
        }, step);
        storeCookies(jar, host, res);
        const loc = header(res, 'location');
        if (res.statusCode >= 300 && res.statusCode < 400 && loc) {
            url = resolveLocation(loc, url);
            continue;
        }
        return { res, finalUrl: url };
    }
    return undefined;
}

function parseJson(body: unknown): unknown {
    if (typeof body !== 'string') return body;
    try {
        return JSON.parse(body);
    } catch {
        return undefined;
    }
}

// ---------------------------------------------------------------------------
// Login por tickets CAS (el mismo mecanismo que usa la app para sus WebViews)
// ---------------------------------------------------------------------------

async function loginWeb(ctx: Ctx, c: WebCreds): Promise<WebSession> {
    const cas = trimSlash(c.casUrl || DEFAULT_CAS_URL);
    const base = trimSlash(c.aulaVirtualUrl || DEFAULT_AULA_URL);
    const service = c.aulaServiceUrl || `${base}${DEFAULT_SERVICE_PATH}`;
    const appHeaders: Record<string, string> = {
        ...(c.appAuthToken ? { 'UMUapp-Authentication-Token': c.appAuthToken } : {}),
        ...(c.userAgent ? { 'User-Agent': c.userAgent } : {}),
    };
    const node = ctx.getNode();
    const uaHeaders: Record<string, string> = c.userAgent ? { 'User-Agent': c.userAgent } : {};

    // 1) TGT
    const tgtRes = await raw(ctx, {
        url: `${cas}/v1/tickets`,
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...appHeaders },
        body: formEncode({ username: c.username, password: c.password }),
    }, 'TGT del CAS');
    const tgtUrl = header(tgtRes, 'location');
    // El CAS está detrás de un balanceador con cookie de afinidad (AlteonP) y el TGT lleva el nodo
    // que lo emitió: se reenvían las cookies del primer paso en los siguientes.
    const casJar: Jar = {};
    const casHost = hostOf(cas);
    storeCookies(casJar, casHost, tgtRes);
    const casCookie = (): Record<string, string> => {
        const c = cookieHeader(casJar, casHost);
        return c ? { Cookie: c } : {};
    };
    if (tgtRes.statusCode !== 201 || !tgtUrl) {
        const hint =
            tgtRes.statusCode === 401
                ? 'Usuario o contraseña rechazados (o falta la cabecera UMUapp-Authentication-Token en la credencial).'
                : tgtRes.statusCode === 423
                  ? 'Cuenta bloqueada temporalmente por intentos fallidos. Espera unos minutos y no reintentes.'
                  : tgtRes.statusCode === 403
                    ? 'El CAS rechaza la petición (¿falta la cabecera UMUapp-Authentication-Token?).'
                    : 'Respuesta inesperada del CAS al pedir el ticket.';
        throw new NodeOperationError(node, `Login CAS (TGT) fallido: HTTP ${tgtRes.statusCode}. ${hint}`);
    }

    try {
        // 2) ST para el servicio de Aula Virtual
        const stRes = await raw(ctx, {
            url: `${tgtUrl}?service=${encodeURIComponent(service)}`,
            method: 'POST',
            headers: { ...appHeaders, ...casCookie() },
        }, 'ticket de servicio (ST)');
        const st = typeof stRes.body === 'string' ? stRes.body.trim() : '';
        if (stRes.statusCode !== 200 || !/^ST-/.test(st)) {
            throw new NodeOperationError(
                node,
                `Login CAS (ST) fallido: HTTP ${stRes.statusCode}. El CAS no emitió un ticket para el servicio ${service}.`,
            );
        }

        // 3) Canjear el ticket en Aula Virtual -> cookie de sesión de Sakai
        const jar: Jar = {};
        const sep = service.includes('?') ? '&' : '?';
        const landed = await getWithJar(ctx, `${service}${sep}ticket=${encodeURIComponent(st)}`, jar, { ...uaHeaders }, 'canje del ticket en Aula Virtual');
        if (!landed) throw new NodeOperationError(node, 'Demasiadas redirecciones al entrar en Aula Virtual.');

        // 4) Comprobar que hay sesión
        const who = await getWithJar(ctx, `${base}/direct/session/current.json`, jar, { Accept: 'application/json', ...uaHeaders }, 'comprobar la sesión');
        const info = who ? (parseJson(who.res.body) as IDataObject | undefined) : undefined;
        const userEid = info && typeof info.userEid === 'string' ? info.userEid : null;
        if (!userEid) {
            const names = Object.keys(jar[hostOf(base)] ?? {}).join(', ') || 'ninguna';
            throw new NodeOperationError(
                node,
                `El ticket se canjeó (HTTP ${landed.res.statusCode}, final ${pathOf(landed.finalUrl)}) pero Aula Virtual no abrió sesión. Cookies recibidas: ${names}. Revisa «URL del servicio» en la credencial.`,
            );
        }
        return { jar, base, userEid, expiresAt: Date.now() + SESSION_TTL_MS, headers: uaHeaders };
    } finally {
        // Cierra el TGT en el CAS (no deja sesiones abiertas); un fallo aquí no importa.
        try {
            await raw(ctx, { url: tgtUrl, method: 'DELETE', headers: { ...appHeaders, ...casCookie() } }, 'cerrar el TGT');
        } catch {
            // ignorado a propósito
        }
    }
}

export async function getWebSession(ctx: Ctx, force = false): Promise<WebSession> {
    const c = (await ctx.getCredentials('umuappApi')) as unknown as WebCreds;
    const key = `${trimSlash(c.aulaVirtualUrl || DEFAULT_AULA_URL)}|${c.username}`;
    const cached = sessions.get(key);
    if (!force && cached && cached.expiresAt > Date.now()) return cached;
    const session = await loginWeb(ctx, c);
    sessions.set(key, session);
    return session;
}

// ---------------------------------------------------------------------------
// Peticiones a Aula Virtual
// ---------------------------------------------------------------------------

export interface AulaResponse {
    statusCode: number;
    url: string;
    /** JSON ya parseado si lo era; si no, texto */
    data: unknown;
    isJson: boolean;
}

function needsLogin(res: FullResponse, finalUrl: string, data: unknown, isJson: boolean, expectJson: boolean): boolean {
    if (res.statusCode === 401 || res.statusCode === 403) return true;
    if (/\/cas\/login|xlogin|\/relogin/i.test(finalUrl)) return true;
    // Un .json que devuelve HTML suele ser la página de login de Sakai.
    return expectJson && !isJson && typeof data === 'string' && /<html|<!doctype/i.test(data.slice(0, 200));
}

export async function aulaGet(ctx: Ctx, path: string, query: Record<string, string | number | boolean> = {}): Promise<AulaResponse> {
    for (let attempt = 0; attempt < 2; attempt++) {
        const session = await getWebSession(ctx, attempt > 0);
        const qs = Object.keys(query).length ? `${path.includes('?') ? '&' : '?'}${formEncode(query)}` : '';
        const url = /^https?:\/\//i.test(path) ? path : `${session.base}${path.startsWith('/') ? '' : '/'}${path}`;
        const out = await getWithJar(ctx, `${url}${qs}`, session.jar, { Accept: 'application/json, text/plain, */*', ...session.headers }, 'consulta a Aula Virtual');
        if (!out) throw new NodeOperationError(ctx.getNode(), 'Demasiadas redirecciones al consultar Aula Virtual.');
        const parsed = parseJson(out.res.body);
        const isJson = parsed !== undefined && typeof parsed === 'object';
        const data = isJson ? parsed : out.res.body;
        const expectJson = /\.json(\?|$)/.test(path);
        if (attempt === 0 && needsLogin(out.res, out.finalUrl, data, isJson, expectJson)) continue; // reintenta con login nuevo
        return { statusCode: out.res.statusCode, url: out.finalUrl, data, isJson };
    }
    throw new NodeOperationError(ctx.getNode(), 'Aula Virtual rechaza la sesión incluso tras iniciar sesión de nuevo.');
}

export async function describeSession(ctx: Ctx): Promise<IDataObject> {
    const s = await getWebSession(ctx, true);
    const host = hostOf(s.base);
    return {
        ok: true,
        usuario: s.userEid,
        aulaVirtual: s.base,
        cookies: Object.keys(s.jar[host] ?? {}),
        caducaEn: new Date(s.expiresAt).toISOString(),
    };
}
