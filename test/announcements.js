// Anuncios y petición libre de Aula Virtual: nodo UMUApp y evento del trigger, con CAS y Sakai simulados.
const assert = require('assert');
const { Umuapp } = require('../dist/nodes/Umuapp/Umuapp.node.js');
const { UmuappTrigger } = require('../dist/nodes/Umuapp/UmuappTrigger.node.js');
const { clearSessions } = require('../dist/nodes/Umuapp/webview.js');
const { parseAnnouncementRef } = require('../dist/nodes/Umuapp/sakai.js');

const SITE = '1898_G_2026_N_N';
const A1 = { id: `/announcement/msg/${SITE}/main/m-1`, announcementId: 'm-1', siteId: SITE, siteTitle: 'ISO', title: 'Cambio de aula', body: '<p>Hoy <b>aula 3</b></p>', createdByDisplayName: 'Profe Uno', createdOn: Date.UTC(2026, 10, 19, 8, 30), channel: 'main', attachments: [{ name: 'a.pdf' }] };
const A2 = { id: `/announcement/msg/${SITE}/main/m-2`, announcementId: 'm-2', siteId: SITE, siteTitle: 'ISO', title: 'Práctica 3', body: 'Texto', createdByDisplayName: 'Profe Uno', createdOn: Date.UTC(2026, 10, 18, 8, 30), channel: 'main', attachments: [] };

let collection, msgWorks, log;
function http(o) {
    const u = new URL(o.url);
    log.push(`${o.method} ${u.host}${u.pathname}${u.search}`);
    const res = (statusCode, body = '', headers = {}) => ({ statusCode, body, headers });
    if (u.host === 'entrada.um.es') {
        if (u.pathname === '/cas/oidc/accessToken') {
            assert.match(o.body, /(^|&)password=p%26ss%2Bw%25rd(&|$)/, 'contraseña con caracteres especiales bien codificada');
            assert.ok(!/appAuthToken|aulaVirtualUrl|userAgent/.test(o.body), 'el formulario del CAS solo lleva usuario y contraseña');
            return res(200, { access_token: 'T', expires_in: 14400, token_type: 'Bearer' });
        }
        if (o.method === 'POST' && u.pathname === '/cas/v1/tickets') return res(201, '', { location: 'https://entrada.um.es/cas/v1/tickets/TGT-1' });
        if (o.method === 'POST') return res(200, 'ST-1');
        return res(200);
    }
    if (u.pathname.endsWith('/public/login')) return res(200, {});
    if (u.pathname === '/sakai-login-tool/container') return res(302, '', { location: '/portal', 'set-cookie': ['JSESSIONID=S1.n1; Path=/'] });
    if (u.pathname === '/portal') return res(200, '<html/>');
    if (u.pathname === '/direct/session/current.json') return res(200, JSON.stringify({ userEid: 'nacho' }));
    if (u.pathname === '/direct/announcement/user.json') return res(200, JSON.stringify({ announcement_collection: collection }));
    if (u.pathname === `/direct/announcement/site/${SITE}.json`) return res(200, JSON.stringify({ announcement_collection: collection }));
    if (u.pathname === `/direct/announcement/msg/${SITE}/main/m-1.json`) return msgWorks ? res(200, JSON.stringify(A1)) : res(404, 'nf');
    if (u.pathname.startsWith('/direct/announcement/')) return res(404, 'nf');
    if (u.pathname === '/direct/describe') return res(200, '<html><body>describe</body></html>');
    throw new Error('petición inesperada ' + o.method + ' ' + o.url);
}
const httpRequest = async (o) => { const r = http(o); return o.returnFullResponse ? r : r.body; };
const creds = async () => ({ username: 'a@um.es', password: 'p&ss+w%rd', appAuthToken: 'T', aulaVirtualUrl: 'https://aulavirtual.um.es' });

const nodeCtx = (params) => ({
    getInputData: () => [{ json: {} }],
    getNodeParameter: (n, _i, d) => (n in params ? params[n] : d),
    getNode: () => ({ name: 'UMUApp' }), continueOnFail: () => false, getCredentials: creds, helpers: { httpRequest },
});
const run = async (params) => (await new Umuapp().execute.call(nodeCtx({ simplify: true, ...params })))[0].map((x) => x.json);
const poll = async (params, sd, mode = 'trigger') => new UmuappTrigger().poll.call({
    getMode: () => mode, getNode: () => ({}), getWorkflowStaticData: () => sd,
    getNodeParameter: (n, d) => (n in params ? params[n] : d), getCredentials: creds, helpers: { httpRequest },
});
const reset = (works = true) => { clearSessions(); log = []; collection = [A1, A2]; msgWorks = works; };

(async () => {
    // referencias
    const ref = { site: SITE, channel: 'main', id: 'm-1' };
    assert.deepStrictEqual(parseAnnouncementRef(`/announcement/msg/${SITE}/main/m-1`), ref);
    assert.deepStrictEqual(parseAnnouncementRef(`https://aulavirtual.um.es/portal/site/x?ref=${encodeURIComponent(`/announcement/msg/${SITE}/main/m-1`)}&panel=Main`), ref);
    assert.deepStrictEqual(parseAnnouncementRef(`/announcement/message/${SITE}/m-1`), ref);
    assert.deepStrictEqual(parseAnnouncementRef(`${SITE}/m-1`), ref);
    assert.strictEqual(parseAnnouncementRef('nada'), undefined);

    // Get Many: usa n y d
    reset();
    let r = await run({ resource: 'avAnnouncement', operation: 'getAll', avLimit: 20, avDays: 30 });
    assert.deepStrictEqual(r.map((a) => a.id), [A1.id, A2.id]);
    assert.strictEqual(r[0].titulo, 'Cambio de aula');
    assert.strictEqual(r[0].cuerpoTexto, 'Hoy aula 3');
    assert.strictEqual(r[0].creadoEn, '2026-11-19T09:30:00+01:00');
    assert.strictEqual(r[0].autor, 'Profe Uno');
    assert.strictEqual(r[0].adjuntos.length, 1);
    assert.ok(log.some((l) => l.includes('/direct/announcement/user.json?n=20&d=30')), 'n y d en la consulta');

    // De un sitio
    reset();
    r = await run({ resource: 'avAnnouncement', operation: 'getSite', avSiteId: SITE, avLimit: 5, avDays: 10 });
    assert.strictEqual(r.length, 2);
    assert.ok(log.some((l) => l.includes(`/site/${SITE}.json?n=5&d=10`)));

    // Obtener por la referencia del enlace de la alerta
    reset();
    r = await run({ resource: 'avAnnouncement', operation: 'get', announcementRef: `https://aulavirtual.um.es/x?r=/announcement/msg/${SITE}/main/m-1` });
    assert.strictEqual(r[0].titulo, 'Cambio de aula');
    // si el endpoint directo no existe, lo busca entre los del sitio
    reset(false);
    r = await run({ resource: 'avAnnouncement', operation: 'get', announcementRef: `${SITE}/m-2` });
    assert.strictEqual(r[0].titulo, 'Práctica 3');
    await assert.rejects(run({ resource: 'avAnnouncement', operation: 'get', announcementRef: `${SITE}/nope` }), /No se encontró el anuncio/);
    await assert.rejects(run({ resource: 'avAnnouncement', operation: 'get', announcementRef: 'basura' }), /No reconozco la referencia/);

    // petición libre
    reset();
    r = await run({ resource: 'avRequest', operation: 'get', avPath: '/direct/describe' });
    assert.strictEqual(r[0].statusCode, 200);
    assert.match(r[0].data, /describe/);

    // trigger: la primera ejecución memoriza, luego solo avisa de los nuevos
    reset();
    const sd = {};
    const P = { events: ['announcementAv'], options: {} };
    assert.strictEqual(await poll(P, sd), null);
    assert.strictEqual(await poll(P, sd), null);
    const A3 = { ...A2, id: `/announcement/msg/${SITE}/main/m-3`, announcementId: 'm-3', title: 'Examen parcial', createdOn: Date.UTC(2026, 10, 19, 10, 0) };
    collection = [A3, A1, A2];
    const out = await poll(P, sd);
    assert.deepStrictEqual(out[0].map((x) => x.json.titulo), ['Examen parcial']);
    assert.strictEqual(out[0][0].json.evento, 'announcementAv');
    assert.strictEqual(await poll(P, sd), null);
    // prueba manual con n elementos, la más reciente primero
    const man = await poll({ events: ['announcementAv'], options: { testItems: 2 } }, {}, 'manual');
    assert.deepStrictEqual(man[0].map((x) => x.json.titulo), ['Examen parcial', 'Cambio de aula']);

    console.log('announcements.js OK');
})().catch((e) => { console.error(e); process.exit(1); });
