// Tareas de Aula Virtual en el nodo UMUApp: Get Many y Obtener por ID, con CAS y Sakai simulados.
const assert = require('assert');
const { Umuapp } = require('../dist/nodes/Umuapp/Umuapp.node.js');
const { clearSessions } = require('../dist/nodes/Umuapp/webview.js');
const { parseAssignmentId } = require('../dist/nodes/Umuapp/sakai.js');

const ID1 = 'e3c73c3e-eda7-4e2c-8051-4a7415a847e4';
const ID2 = '09101f65-c0dd-4802-b87b-a83250ed2193';
const T1 = { id: ID1, context: '1898_G_2026_N_N', title: 'Práctica 1', instructions: '<p>Entregar</p>', dueTime: { time: Date.UTC(2026, 10, 30, 22, 59) }, openTime: { time: Date.UTC(2026, 10, 1, 8, 0) }, status: 'OPEN', gradeScaleMaxPoints: '10' };
const T2 = { id: ID2, context: '1899_G_2026_N_N', title: 'Informe', dueTime: { time: Date.UTC(2026, 11, 5, 22, 59) } };

let itemWorks, log, tgtFails = 0;
function http(o) {
    const u = new URL(o.url);
    log.push(`${o.method} ${u.host}${u.pathname}`);
    const res = (statusCode, body = '', headers = {}) => ({ statusCode, body, headers });
    if (u.host === 'entrada.um.es') {
        if (o.method === 'POST' && u.pathname === '/cas/v1/tickets') {
            if (tgtFails > 0) { tgtFails--; throw new Error('The connection to the server was closed unexpectedly, perhaps it is offline'); }
            return res(201, '', { location: 'https://entrada.um.es/cas/v1/tickets/TGT-1', 'set-cookie': ['AlteonP=AAA$$; Path=/'] });
        }
        if (o.method === 'POST') {
            assert.strictEqual((o.headers || {}).Cookie, 'AlteonP=AAA$$', 'reenvía la cookie del balanceador en el paso del ST');
            return res(200, 'ST-1');
        }
        return res(200);
    }
    if (u.pathname === '/sakai-login-tool/container') return res(302, '', { location: '/portal', 'set-cookie': ['JSESSIONID=S1.n1; Path=/'] });
    if (u.pathname === '/portal') return res(200, '<html/>');
    if (u.pathname === '/direct/session/current.json') return res(200, JSON.stringify({ userEid: 'nacho' }));
    if (u.pathname === '/direct/assignment/my.json') return res(200, JSON.stringify({ assignment_collection: [T1, T2] }));
    if (u.pathname === `/direct/assignment/item/${ID1}.json`) return itemWorks ? res(200, JSON.stringify(T1)) : res(404, 'not found');
    if (u.pathname.startsWith('/direct/assignment/item/')) return res(404, 'not found');
    throw new Error('petición inesperada ' + o.method + ' ' + o.url);
}

const ctx = (params) => ({
    getInputData: () => [{ json: {} }],
    getNodeParameter: (n, _i, d) => (n in params ? params[n] : d),
    getNode: () => ({ name: 'UMUApp' }),
    continueOnFail: () => false,
    getCredentials: async () => ({ username: 'a@um.es', password: 'x', appAuthToken: 'T' }),
    helpers: { httpRequest: async (o) => http(o) },
});
const run = async (params) => (await new Umuapp().execute.call(ctx({ resource: 'task', simplify: true, ...params })))[0].map((x) => x.json);
const reset = (works) => { clearSessions(); log = []; itemWorks = works; tgtFails = 0; };

(async () => {
    // extracción del ID
    assert.strictEqual(parseAssignmentId(ID1), ID1);
    assert.strictEqual(parseAssignmentId(`  ${ID1} `), ID1);
    assert.strictEqual(parseAssignmentId(`/assignment/a/1898_G_2026_N_N/${ID1}`), ID1);
    const url = `https://aulavirtual.um.es/portal/directtool/0c1f2a3b-1111-2222-3333-444455556666?assignmentId=/assignment/a/1898_G_2026_N_N/${ID1}&panel=Main&sakai_action=doGrade_assignment`;
    assert.strictEqual(parseAssignmentId(url), ID1, 'referencia_web de una alerta');
    assert.strictEqual(parseAssignmentId(encodeURIComponent(url)), ID1, 'URL codificada');

    // Get Many
    reset(true);
    let r = await run({ operation: 'getAll' });
    assert.deepStrictEqual(r.map((t) => t.id), [ID1, ID2]);
    assert.strictEqual(r[0].fechaLimite, '2026-11-30T23:59:00+01:00');
    assert.strictEqual(r[0].googleCalendar.summary, 'Práctica 1');

    // Obtener por ID (endpoint por ID funciona): no hace falta listar todo
    reset(true);
    r = await run({ operation: 'get', taskId: ID1 });
    assert.strictEqual(r.length, 1);
    assert.strictEqual(r[0].titulo, 'Práctica 1');
    assert.ok(log.some((l) => l.includes(`/item/${ID1}.json`)));
    assert.ok(!log.some((l) => l.includes('my.json')));

    // Obtener pegando el enlace de la alerta
    reset(true);
    r = await run({ operation: 'get', taskId: url });
    assert.strictEqual(r[0].id, ID1);

    // Sin salida simplificada: el objeto de Sakai tal cual
    reset(true);
    r = await run({ operation: 'get', taskId: ID1, simplify: false });
    assert.strictEqual(r[0].title, 'Práctica 1');

    // El endpoint por ID no existe en este Sakai: cae a «mis tareas»
    reset(false);
    r = await run({ operation: 'get', taskId: ID2 });
    assert.strictEqual(r[0].id, ID2);
    assert.strictEqual(r[0].sitio, '1899_G_2026_N_N');
    assert.ok(log.some((l) => l.includes('my.json')));

    // No existe
    reset(false);
    await assert.rejects(run({ operation: 'get', taskId: '00000000-0000-0000-0000-000000000000' }), /No se encontró la tarea/);
    await assert.rejects(run({ operation: 'get', taskId: '   ' }), /Indica el ID/);

    // La conexión cae una vez: se reintenta y funciona
    reset(true); tgtFails = 1;
    r = await run({ operation: 'get', taskId: ID1 });
    assert.strictEqual(r[0].id, ID1);

    // La conexión cae siempre: el error dice el paso y el destino, sin secretos
    reset(true); tgtFails = 5;
    await assert.rejects(run({ operation: 'get', taskId: ID1 }), (e) => {
        assert.match(e.message, /paso «TGT del CAS» \(POST entrada\.um\.es\/cas\/v1\/tickets\)/);
        assert.match(e.message, /Token de aplicación/);
        assert.ok(!/x@|password|ST-1/.test(e.message));
        return true;
    });

    console.log('task.js OK');
})().catch((e) => { console.error(e); process.exit(1); });
