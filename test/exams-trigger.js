// El trigger emite exámenes nuevos de Aula Virtual (tareas + calendario) y no repite los ya vistos.
const assert = require('assert');
const { UmuappTrigger } = require('../dist/nodes/Umuapp/UmuappTrigger.node.js');
const { clearSessions } = require('../dist/nodes/Umuapp/webview.js');

let tests;
let cur = '';
function http(o) {
    const u = new URL(o.url);
    const res = (statusCode, body = '', headers = {}) => ({ statusCode, body, headers });
    if (u.host === 'entrada.um.es') {
        if (o.method === 'POST' && u.pathname === '/cas/v1/tickets') return res(201, '', { location: 'https://entrada.um.es/cas/v1/tickets/TGT-1' });
        return o.method === 'POST' ? res(200, 'ST-1') : res(200);
    }
    if (u.pathname === '/sakai-login-tool/container') return res(302, '', { location: '/portal', 'set-cookie': ['JSESSIONID=S1.n1; Path=/'] });
    if (u.pathname === '/portal') return res(200, '<html/>');
    if (u.pathname === '/direct/session/current.json') return res(200, JSON.stringify({ userEid: 'n' }));
    if (u.pathname === '/direct/synopticmsgcntritem.json') return res(200, JSON.stringify({ synopticmsgcntritem_collection: [{ siteId: 'S' }] }));
    if (u.pathname === '/portal/site/S') { cur = 'S'; return res(200, '<html/>'); }
    if (u.pathname === '/direct/assignment/my.json') return res(200, JSON.stringify({ assignment_collection: assignments }));
    if (u.pathname === '/direct/calendar/my.json') return res(200, JSON.stringify({ calendar_collection: [] }));
    if (u.pathname === '/direct/sam_pub.json' || u.pathname.startsWith('/direct/sam_pub/context/')) return res(200, JSON.stringify({ sam_pub_collection: cur === 'S' ? tests : [] }));
    throw new Error('inesperada ' + o.url);
}
const state = {};
const ctx = (mode) => ({
    getMode: () => mode,
    getWorkflowStaticData: () => state,
    getNodeParameter: (n, d) => ({ events: ['examAv'], options: {} }[n] ?? d),
    getNode: () => ({ name: 'T' }),
    getCredentials: async () => ({ username: 'a@um.es', password: 'x' }),
    helpers: { httpRequest: async (o) => http(o) },
});
const poll = async (mode = 'trigger') => { clearSessions(); cur = ''; const r = await new UmuappTrigger().poll.call(ctx(mode)); return r ? r[0].map((x) => x.json) : null; };

(async () => {
    const t1 = { publishedAssessmentId: 1, ownerSiteId: 'S', title: 'Test 1', startDate: Date.UTC(2026, 10, 20, 8, 0) };
    tests = [t1];
    assert.strictEqual(await poll(), null, 'la primera ejecución solo memoriza');
    assert.strictEqual(await poll(), null, 'sin novedades');
    tests = [t1, { publishedAssessmentId: 2, ownerSiteId: 'S', title: 'Test 2', startDate: Date.UTC(2026, 10, 25, 8, 0) }];
    const r = await poll();
    assert.deepStrictEqual(r.map((x) => x.titulo), ['Test 2']);
    assert.strictEqual(r[0].evento, 'examAv');
    assert.strictEqual((await poll('manual')).length, 2);
    console.log('exams-trigger.js OK');
})().catch((e) => { console.error(e); process.exit(1); });
