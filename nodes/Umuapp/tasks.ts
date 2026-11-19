import type { IDataObject } from 'n8n-workflow';
import { Ctx, extractList } from './functions';
import { getEndpoint } from './login';

// ---------------------------------------------------------------------------
// Obtención de tareas (todos los sitios de Aula Virtual)
// ---------------------------------------------------------------------------

export interface SiteTasks {
    siteId: string;
    tasks: IDataObject[];
    ok: boolean;
}

/**
 * Identificadores de sitio de Aula Virtual a partir de `GET /private/asignaturas`.
 * Usa `sitio_av` si la asignatura lo trae y, si no, `{identificador}_{tipo}_{curso}_N_N`.
 */
export function siteIdsFromSubjects(body: IDataObject, onlyLatestYear: boolean): string[] {
    const official = (Array.isArray(body.est_oficiales) ? body.est_oficiales : []) as IDataObject[];
    const years = onlyLatestYear ? official.slice(0, 1) : official;
    const ids = new Set<string>();
    for (const year of years) {
        const degrees = (Array.isArray(year.titulaciones) ? year.titulaciones : []) as IDataObject[];
        for (const degree of degrees) {
            const subjects = (Array.isArray(degree.asignaturas) ? degree.asignaturas : []) as IDataObject[];
            for (const s of subjects) {
                const direct = typeof s.sitio_av === 'string' ? s.sitio_av.trim() : '';
                if (direct) ids.add(direct);
                else if (s.identificador !== undefined && s.identificador !== null) {
                    ids.add(`${s.identificador}_${degree.tipo}_${year.curso_academico}_N_N`);
                }
            }
        }
    }
    return [...ids];
}

export async function fetchAllTasks(ctx: Ctx, onlyLatestYear: boolean): Promise<SiteTasks[]> {
    const subjects = await getEndpoint(ctx, {
        method: 'GET',
        host: 'umuapp',
        endpoint: '/umuapp/rest/v1.0/private/asignaturas',
    });
    const out: SiteTasks[] = [];
    for (const siteId of siteIdsFromSubjects(subjects.body as IDataObject, onlyLatestYear)) {
        try {
            const res = await getEndpoint(ctx, {
                method: 'GET',
                host: 'umuapp',
                endpoint: `/umuapp/rest/v1.0/private/asignaturas/sitios/${encodeURIComponent(siteId)}/tareas`,
            });
            out.push({ siteId, tasks: extractList(res.body, ['id_tarea', 'id']), ok: true });
        } catch {
            // Un sitio que falla (p. ej. sin Aula Virtual) no debe tumbar el resto.
            out.push({ siteId, tasks: [], ok: false });
        }
    }
    return out;
}

// ---------------------------------------------------------------------------
// Detección de cambios
// ---------------------------------------------------------------------------

/** Lo que se guarda por tarea en los datos estáticos del workflow. */
export interface StoredTask {
    /** hash de todos los campos vigilados */
    h: string;
    /** valores aplanados (recortados) para poder contar qué cambió */
    v: Record<string, string>;
    /** última vez que se vio (ms) */
    t: number;
}

export interface TaskChange {
    campo: string;
    antes: string | null;
    despues: string | null;
}

export interface TaskCandidate {
    key: string;
    task: IDataObject;
}

export interface CompareResult {
    next: Record<string, StoredTask>;
    added: TaskCandidate[];
    changed: { candidate: TaskCandidate; cambios: TaskChange[]; calificacion: boolean }[];
}

const MAX_VALUE_LEN = 300;
const GRADE_PATH = /nota|calific|grade|puntuaci|score|evaluaci/i;

/** Hash no criptográfico (cyrb53) para no depender de `crypto`. */
export function hashString(s: string): string {
    let h1 = 0xdeadbeef;
    let h2 = 0x41c6ce57;
    for (let i = 0; i < s.length; i++) {
        const ch = s.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** Aplana un JSON a `ruta -> texto` con rutas estables (claves ordenadas). */
export function flatten(value: unknown, prefix = '', out: Record<string, string> = {}): Record<string, string> {
    if (value === null || value === undefined) {
        if (prefix) out[prefix] = '';
    } else if (Array.isArray(value)) {
        if (!value.length && prefix) out[prefix] = '[]';
        value.forEach((v, i) => flatten(v, `${prefix}[${i}]`, out));
    } else if (typeof value === 'object') {
        const obj = value as Record<string, unknown>;
        const keys = Object.keys(obj).sort();
        if (!keys.length && prefix) out[prefix] = '{}';
        for (const k of keys) flatten(obj[k], prefix ? `${prefix}.${k}` : k, out);
    } else if (prefix) {
        out[prefix] = String(value);
    }
    return out;
}

function isIgnored(path: string, ignore: string[]): boolean {
    const p = path.toLowerCase();
    return ignore.some((raw) => {
        const i = raw.trim().toLowerCase();
        return i !== '' && (p === i || p.startsWith(`${i}.`) || p.startsWith(`${i}[`));
    });
}

export function snapshotTask(task: IDataObject, ignore: string[], now: number): StoredTask {
    const flat = flatten(task);
    const watched: Record<string, string> = {};
    const full: string[] = [];
    for (const path of Object.keys(flat)) {
        if (isIgnored(path, ignore)) continue;
        full.push(`${path}=${flat[path]}`);
        watched[path] = flat[path].length > MAX_VALUE_LEN ? flat[path].slice(0, MAX_VALUE_LEN) : flat[path];
    }
    return { h: hashString(full.join('\n')), v: watched, t: now };
}

export function diffSnapshots(prev: StoredTask, cur: StoredTask): TaskChange[] {
    const changes: TaskChange[] = [];
    const paths = new Set([...Object.keys(prev.v), ...Object.keys(cur.v)]);
    for (const path of [...paths].sort()) {
        const a = prev.v[path];
        const b = cur.v[path];
        if (a === b) continue;
        changes.push({ campo: path, antes: a ?? null, despues: b ?? null });
    }
    // Cambió algo más allá del recorte de valores largos.
    if (!changes.length) changes.push({ campo: '(contenido extenso)', antes: null, despues: null });
    return changes;
}

/**
 * Compara las tareas actuales con las guardadas.
 * - `added`: clave nunca vista.
 * - `changed`: clave conocida cuyo hash ha cambiado.
 * El estado nuevo conserva las tareas que no aparecen ahora (por si un sitio falló) y se
 * limita a `maxEntries` quitando las vistas hace más tiempo.
 */
export function compareTasks(
    prev: Record<string, StoredTask>,
    current: TaskCandidate[],
    opts: { ignore: string[]; now: number; maxEntries: number },
): CompareResult {
    const next: Record<string, StoredTask> = { ...prev };
    const added: TaskCandidate[] = [];
    const changed: CompareResult['changed'] = [];

    for (const c of current) {
        const snap = snapshotTask(c.task, opts.ignore, opts.now);
        const old = prev[c.key];
        if (!old) added.push(c);
        else if (old.h !== snap.h) {
            const cambios = diffSnapshots(old, snap);
            changed.push({ candidate: c, cambios, calificacion: cambios.some((x) => GRADE_PATH.test(x.campo)) });
        }
        next[c.key] = snap;
    }

    const keys = Object.keys(next);
    if (keys.length > opts.maxEntries) {
        keys.sort((a, b) => next[a].t - next[b].t);
        for (const k of keys.slice(0, keys.length - opts.maxEntries)) delete next[k];
    }
    return { next, added, changed };
}

/** Clave estable de una tarea. */
export function taskKey(siteId: string, t: IDataObject): string {
    const id = t.id_tarea ?? t.id ?? t.identificador ?? t.codigo ?? t.codigo_tarea;
    if (id !== undefined && id !== null && id !== '') return `task:${siteId}:${String(id)}`;
    return `task:${siteId}:${hashString(String(t.titulo ?? '') + String(t.fecha_inicio ?? ''))}`;
}
