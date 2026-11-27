// Referencia web de anuncios, tareas, exámenes y eventos del calendario.
const assert = require('assert');
const { enrichWebReferences, buildWebReference, clearSiteTitleCache } = require('../dist/nodes/Umuapp/sites.js');
const { clearSessions } = require('../dist/nodes/Umuapp/webview.js');

const B = 'https://aulavirtual.um.es';
const S = '1898_G_2026_N_N';
const TOOLS = { 'sakai.announcements': 'ann-1', 'sakai.assignment.grades': 'asg-1', 'sakai.samigo': 'sam-1', 'sakai.schedule': 'cal-1' };

// Formas reales (alertas de la UM): tarea y examen.
assert.strictEqual(
    buildWebReference({ sitio: S, id: 'e3c73c3e-0001' }, 'task', B, TOOLS),
    `${B}/portal/directtool/asg-1?assignmentId=/assignment/a/${S}/e3c73c3e-0001&panel=Main&sakai_action=doGrade_assignment`,
);
assert.strictEqual(buildWebReference({ sitio: S }, 'exam', B, TOOLS), `${B}/portal/site/${S}/tool/sam-1`);
assert.strictEqual(
    buildWebReference({ sitio: S, id: 'm1' }, 'announcement', B, TOOLS),
    `${B}/portal/directtool/ann-1?itemReference=/announcement/msg/${S}/main/m1&sakai_action=doShowmetadata`,
);
assert.strictEqual(
    buildWebReference({ sitio: S, id: 'ev1' }, 'calendar', B, TOOLS),
    `${B}/portal/directtool/cal-1?eventReference=/calendar/event/${S}/main/ev1&panel=Main&sakai_action=doDescription`,
);
assert.strictEqual(buildWebReference({ sitio: S, id: 'x' }, 'task', B, {}), undefined, 'sin herramienta no se inventa nada');
assert.strictEqual(buildWebReference({ sitio: S, id: 'x' }, 'task', B, { 'sakai.assignment': 'a2' }).includes('/directtool/a2?'), true, 'acepta sakai.assignment');

const log = [];
function http(o) {
    const u = new URL(o.url);
    log.push(u.pathname);
    const res = (statusCode, body = '', headers = {}) => ({ statusCode, body, headers });
    if (u.host === 'entrada.um.es') {
        if (o.method === 'POST' && u.pathname === '/cas/v1/tickets') return res(201, '', { location: 'https://entrada.um.es/cas/v1/tickets/TGT-1' });
        return o.method === 'POST' ? res(200, 'ST-1') : res(200);
    }
    if (u.pathname === '/sakai-login-tool/container') return res(302, '', { location: '/portal', 'set-cookie': ['JSESSIONID=S1.n1; Path=/'] });
    if (u.pathname === '/portal') return res(200, '<html/>');
    if (u.pathname === '/direct/session/current.json') return res(200, JSON.stringify({ userEid: 'n' }));
    if (u.pathname === `/direct/site/${S}/pages.json`)
        return res(200, JSON.stringify(Object.entries(TOOLS).map(([toolId, placementId], i) => ({ id: 'p' + i, tools: [{ toolId, placementId }] }))));
    throw new Error('inesperada ' + o.url);
}
const ctx = { getCredentials: async () => ({ username: 'a@um.es', password: 'x' }), getNode: () => ({ name: 'U' }), helpers: { httpRequest: async (o) => http(o) } };

(async () => {
    clearSiteTitleCache(); clearSessions();
    const items = [
        { evento: 'announcementAv', sitio: S, id: 'm1' },
        { evento: 'task', fuente: 'aulavirtual', sitio: S, id: 't1' },
        { evento: 'taskChanged', fuente: 'tareas', sitio: S, id: 't2' }, // tarea del trigger (API de UMUApp)
        { evento: 'task', fuente: 'umuapp', sitio: S, id: 'u1' }, // tarea de UMUApp: no es de Aula Virtual
        { evento: 'examAv', sitio: S, id: 7 },
        { evento: 'calendarEventAv', sitio: S, id: 'ev1' },
        { evento: 'calendarEventAv', sitio: null, id: 'ev2' }, // sin sitio
        { evento: 'alert', sitio: S },
    ];
    await enrichWebReferences(ctx, items);
    assert.ok(items[0].referenciaWeb.includes('itemReference=/announcement/msg/') && items[0].urlAnuncio === items[0].referenciaWeb);
    assert.ok(items[1].referenciaWeb.includes('assignmentId=/assignment/a/' + S + '/t1'));
    assert.ok(items[2].referenciaWeb.includes('/t2&'));
    assert.ok(!('referenciaWeb' in items[3]), 'no toca tareas de UMUApp');
    assert.strictEqual(items[4].referenciaWeb, `${B}/portal/site/${S}/tool/sam-1`);
    assert.ok(items[5].referenciaWeb.includes('eventReference=/calendar/event/'));
    assert.ok(!('referenciaWeb' in items[6]) && !('referenciaWeb' in items[7]));
    assert.strictEqual(log.filter((l) => l.endsWith('pages.json')).length, 1, 'una sola consulta de pages.json por sitio para todos los tipos');
    console.log('web-refs.js OK');
})().catch((e) => { console.error(e); process.exit(1); });
