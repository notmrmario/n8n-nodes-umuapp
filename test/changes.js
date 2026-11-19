// Prueba con API simulada del trigger: tareas nuevas y modificadas (p. ej. calificadas).
const assert = require('assert');
const { UmuappTrigger } = require('../dist/nodes/Umuapp/UmuappTrigger.node.js');
const { compareTasks, flatten } = require('../dist/nodes/Umuapp/tasks.js');

let tasksBySite;
let failSites = new Set();

function makeCtx(params, staticData, mode = 'trigger') {
    return {
        getMode: () => mode,
        getNodeParameter: (name, def) => (name in params ? params[name] : def),
        getWorkflowStaticData: () => staticData,
        getNode: () => ({ name: 'UMUApp Trigger' }),
        getCredentials: async () => ({ username: 'a@um.es', password: 'x' }),
        helpers: {
            httpRequest: async (o) => {
                const u = o.url;
                if (u.includes('/cas/oidc/accessToken'))
                    return { statusCode: 200, statusMessage: 'OK', body: { access_token: 'T', expires_in: 14400, token_type: 'Bearer' } };
                if (u.endsWith('/public/login')) return {};
                if (u.endsWith('/private/asignaturas'))
                    return { body: { est_oficiales: [{ curso_academico: 2025, titulaciones: [{ tipo: 'G', asignaturas: [{ identificador: 100 }, { identificador: 200 }] }] }] } };
                const m = /sitios\/([^/]+)\/tareas/.exec(u);
                if (m) {
                    const site = decodeURIComponent(m[1]);
                    if (failSites.has(site)) throw new Error('boom');
                    return { body: tasksBySite[site] ?? [] };
                }
                throw new Error('URL inesperada ' + u);
            },
        },
    };
}

const poll = (params, sd, mode) => new UmuappTrigger().poll.call(makeCtx(params, sd, mode));
const base = { events: ['task', 'taskChanged'], options: {} };
const S1 = '100_G_2025_N_N', S2 = '200_G_2025_N_N';
const task = (id, extra = {}) => ({ id_tarea: id, titulo: 'T' + id, instrucciones: '<p>Hacer</p>', fecha_limite: '31/12/2026 23:59', fecha_inicio: '01/10/2026 09:00', estado: 'OPEN', esta_activa: true, adjuntos: [], entrega: null, ...extra });

(async () => {
    // flatten estable
    assert.deepStrictEqual(flatten({ b: 1, a: { c: [1, 2] } }), { 'a.c[0]': '1', 'a.c[1]': '2', b: '1' });

    // 1ª ejecución: memoriza sin emitir
    const sd = {};
    tasksBySite = { [S1]: [task(1), task(2)], [S2]: [task(3)] };
    assert.strictEqual(await poll(base, sd), null);
    assert.strictEqual(Object.keys(sd.tasks).length, 3);

    // sin cambios: nada
    assert.strictEqual(await poll(base, sd), null);

    // se califica la tarea 2 (no hay alerta, solo cambia `entrega`) + tarea nueva 4 + estado cambia solo (ignorado)
    tasksBySite[S1][1] = task(2, { entrega: { fecha: '05/11/2026 10:00', nota: '8,5', comentario: 'Bien' }, estado: 'CLOSED' });
    tasksBySite[S1].push(task(4));
    let r = await poll(base, sd);
    assert.ok(r, 'debe emitir');
    const items = r[0].map((x) => x.json);
    assert.strictEqual(items.length, 2);
    const changed = items.find((i) => i.evento === 'taskChanged');
    const added = items.find((i) => i.evento === 'task');
    assert.strictEqual(changed.id, 2);
    assert.strictEqual(changed.sitio, S1);
    assert.strictEqual(changed.cambioCalificacion, true);
    assert.ok(changed.camposModificados.includes('entrega.nota'));
    assert.ok(!changed.camposModificados.includes('estado'), 'estado ignorado por defecto');
    const nota = changed.cambios.find((c) => c.campo === 'entrega.nota');
    assert.deepStrictEqual([nota.antes, nota.despues], [null, '8,5']);
    assert.strictEqual(changed.fechaLimite, '2026-12-31T23:59:00+01:00');
    assert.strictEqual(added.id, 4);

    // la misma tarea no se vuelve a emitir
    assert.strictEqual(await poll(base, sd), null);

    // cambia la nota otra vez -> nuevo aviso con antes/después
    tasksBySite[S1][1] = task(2, { entrega: { fecha: '05/11/2026 10:00', nota: '9', comentario: 'Bien' }, estado: 'CLOSED' });
    r = await poll(base, sd);
    const c2 = r[0][0].json;
    assert.deepStrictEqual(c2.cambios.map((c) => [c.campo, c.antes, c.despues]), [['entrega.nota', '8,5', '9']]);

    // un sitio que falla no borra su estado ni genera "nuevas" al volver
    failSites.add(S2);
    assert.strictEqual(await poll(base, sd), null);
    failSites.clear();
    assert.strictEqual(await poll(base, sd), null);

    // si el usuario quita `estado` de ignorados, el cierre de una tarea se avisa
    tasksBySite[S2][0] = task(3, { estado: 'CLOSED' });
    const opts2 = { ...base, options: { ignoredTaskFields: '' } };
    // (primero se refresca la foto con la configuración nueva: cambia lo vigilado, así que avisa una vez)
    r = await poll(opts2, sd);
    assert.ok(r && r[0].some((i) => i.json.id === 3 && i.json.camposModificados.includes('estado')));

    // solo "modificada": no emite nuevas
    const sd2 = {};
    tasksBySite = { [S1]: [task(1)] };
    await poll({ events: ['taskChanged'], options: {} }, sd2);
    tasksBySite[S1].push(task(9));
    assert.strictEqual(await poll({ events: ['taskChanged'], options: {} }, sd2), null);

    // emitExisting emite las existentes como nuevas la primera vez
    const sd3 = {};
    r = await poll({ events: ['task'], options: { emitExisting: true } }, sd3);
    assert.strictEqual(r[0].length, 2);

    // modo manual: devuelve ejemplos y no toca el estado
    const sd4 = {};
    r = await poll(base, sd4, 'manual');
    assert.ok(r[0].length >= 1);
    assert.strictEqual(sd4.tasks, undefined);

    // límite de la caché
    const big = {};
    const many = Array.from({ length: 30 }, (_, i) => ({ key: 'k' + i, task: task(i) }));
    const cmp = compareTasks(big, many, { ignore: [], now: 1, maxEntries: 10 });
    assert.strictEqual(Object.keys(cmp.next).length, 10);

    console.log('changes.js OK');
})().catch((e) => { console.error(e); process.exit(1); });
