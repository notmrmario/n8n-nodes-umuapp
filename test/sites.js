// Título real del sitio en anuncios y eventos, y recurso «Sitio (Aula Virtual)».
const assert = require('assert');
const { Umuapp } = require('../dist/nodes/Umuapp/Umuapp.node.js');
const { UmuappTrigger } = require('../dist/nodes/Umuapp/UmuappTrigger.node.js');
const { clearSessions } = require('../dist/nodes/Umuapp/webview.js');
const { announcementReference, clearSiteTitleCache, parseSiteRef } = require('../dist/nodes/Umuapp/sites.js');

const SITE = '1898_G_2026_N_N';
let log;
let siteFails = false;
function http(o) {
    const u = new URL(o.url);
    log.push(`${o.method} ${u.pathname}${u.search}`);
    const res = (statusCode, body = '', headers = {}) => ({ statusCode, body, headers });
    const json = (x) => res(200, JSON.stringify(x));
    if (u.host === 'entrada.um.es') {
        if (o.method === 'POST' && u.pathname === '/cas/v1/tickets') return res(201, '', { location: 'https://entrada.um.es/cas/v1/tickets/TGT-1' });
        return o.method === 'POST' ? res(200, 'ST-1') : res(200);
    }
    if (u.pathname === '/sakai-login-tool/container') return res(302, '', { location: '/portal', 'set-cookie': ['JSESSIONID=S1.n1; Path=/'] });
    if (u.pathname === '/portal') return res(200, '<html/>');
    if (u.pathname === '/direct/session/current.json') return json({ userEid: 'n' });
    if (u.pathname === '/direct/announcement/user.json')
        return json({ announcement_collection: [
            { id: 'm1', announcementId: 'm1', siteId: SITE, siteTitle: 'Mi Sitio', title: 'Aviso 1', body: '<p>a</p>', createdOn: Date.UTC(2026, 10, 20, 9, 0) },
            { id: 'm2', announcementId: 'm2', siteId: SITE, siteTitle: 'Mi Sitio', title: 'Aviso 2', body: '<p>b</p>', createdOn: Date.UTC(2026, 10, 21, 9, 0) },
            { id: 'm3', announcementId: 'm3', siteId: '1897_G_2026_N_N', siteTitle: 'Mi Sitio', title: 'Aviso 3', body: '<p>c</p>', createdOn: Date.UTC(2026, 10, 22, 9, 0) },
        ] });
    if (u.pathname === `/direct/site/${SITE}.json`) {
        if (siteFails) return res(404, 'no');
        return json({
            id: SITE, title: '(1898) INTRODUCCIÓN A LOS SISTEMAS OPERATIVOS  [26/27]', type: 'course', description: '<p>Sistemas &amp; más</p>', published: true,
            createdDate: Date.UTC(2026, 6, 1, 8, 0), owner: 'u1', contactName: 'Profe', props: { x: 1 }, siteGroupsList: o.url.includes('includeGroups') ? [{ title: 'G1' }] : undefined,
        });
    }
    if (u.pathname === '/direct/site/1897_G_2026_N_N.json') return json({ id: '1897_G_2026_N_N', title: '(1897) POO  [26/27]' });
    if (u.pathname === `/direct/site/${SITE}/pages.json`)
        return json([
            { id: 'p0', title: 'Anuncios', url: 'https://x/p0', tools: [{ toolId: 'sakai.announcements', title: 'Anuncios', placementId: 'ann-1' }] },
            { id: 'p1', title: 'Exámenes', url: 'https://x/p1', tools: [{ toolId: 'sakai.samigo', title: 'Exámenes', placementId: 'pl1' }] },
        ]);
    if (u.pathname === '/direct/site/1897_G_2026_N_N/pages.json') return res(403, 'no');
    throw new Error('petición inesperada ' + o.method + ' ' + o.url);
}
const ctx = (params) => ({
    getInputData: () => [{ json: {} }],
    getNodeParameter: (n, _i, d) => (n in params ? params[n] : d),
    getNode: () => ({ name: 'UMUApp' }), continueOnFail: () => false,
    getCredentials: async () => ({ username: 'a@um.es', password: 'x' }),
    helpers: { httpRequest: async (o) => http(o) },
});
const run = async (params) => { clearSessions(); log = []; return (await new Umuapp().execute.call(ctx({ simplify: true, ...params })))[0].map((x) => x.json); };

(async () => {
    assert.strictEqual(parseSiteRef('1898_G_2026_N_N'), SITE);
    assert.strictEqual(parseSiteRef(`https://aulavirtual.um.es/portal/site/${SITE}/page/534262d7-4d95`), SITE);
    assert.strictEqual(parseSiteRef(`https://aulavirtual.um.es/direct/site/${SITE}.json`), SITE);
    assert.strictEqual(parseSiteRef(`${SITE}.json`), SITE);
    assert.strictEqual(parseSiteRef('https://aulavirtual.um.es/portal/site/~abc-123'), '~abc-123');
    assert.strictEqual(parseSiteRef('https://aulavirtual.um.es/portal'), '');

    // Anuncios: sitioTitulo real, una consulta por sitio.
    clearSiteTitleCache();
    let r = await run({ resource: 'avAnnouncement', operation: 'getAll', avLimit: 10, avDays: 30 });
    const byId = Object.fromEntries(r.map((x) => [x.id, x.sitioTitulo]));
    assert.deepStrictEqual(byId, {
        m1: '(1898) INTRODUCCIÓN A LOS SISTEMAS OPERATIVOS  [26/27]',
        m2: '(1898) INTRODUCCIÓN A LOS SISTEMAS OPERATIVOS  [26/27]',
        m3: '(1897) POO  [26/27]',
    });
    assert.ok(r.every((x) => x.sitioTitulo !== 'Mi Sitio'), 'ya no sale «Mi Sitio»');
    assert.strictEqual(log.filter((l) => /\/direct\/site\/[^/]+\.json$/.test(l)).length, 2, 'una consulta de título por sitio distinto');
    assert.strictEqual(new Set(log.filter((l) => l.includes('/pages.json'))).size, 2, 'una consulta de páginas por sitio distinto');
    assert.ok(r.every((x) => x.raw.siteTitle === 'Mi Sitio'), 'el raw queda como llegó');
    // Con caché no vuelve a preguntar (aunque la sesión sea nueva).
    r = await run({ resource: 'avAnnouncement', operation: 'getAll', avLimit: 10, avDays: 30 });
    assert.strictEqual(log.filter((l) => l.includes('/direct/site/')).length, 0);

    // URL del anuncio: placement de «Anuncios» por sitio (una consulta por sitio), null si no se puede obtener.
    const B = 'https://aulavirtual.um.es';
    assert.strictEqual(r.find((x) => x.id === 'm1').urlAnuncio, `${B}/portal/directtool/ann-1?itemReference=/announcement/msg/${SITE}/main/m1&sakai_action=doShowmetadata`);
    assert.strictEqual(r.find((x) => x.id === 'm3').urlAnuncio, null, 'sitio sin acceso a pages.json');
    assert.strictEqual(announcementReference({ sitio: 'S', id: '/announcement/msg/S/main/abc' }), '/announcement/msg/S/main/abc');
    assert.strictEqual(announcementReference({ sitio: 'S', canal: 'otro', id: 'S/x/abc' }), '/announcement/msg/S/otro/abc');

    // Si falla la consulta del sitio, la salida no se rompe.
    clearSiteTitleCache(); siteFails = true;
    r = await run({ resource: 'avAnnouncement', operation: 'getAll', avLimit: 10, avDays: 30 });
    assert.ok(r.length >= 1 && r.every((x) => x.sitioTitulo === 'Mi Sitio' || x.sitioTitulo === '(1897) POO  [26/27]'));
    siteFails = false; clearSiteTitleCache();

    // Recurso Sitio: por ID y por URL.
    r = await run({ resource: 'avSite', operation: 'get', siteRef: `https://aulavirtual.um.es/portal/site/${SITE}/page/x` });
    assert.strictEqual(r.length, 1);
    assert.strictEqual(r[0].id, SITE);
    assert.strictEqual(r[0].titulo, '(1898) INTRODUCCIÓN A LOS SISTEMAS OPERATIVOS  [26/27]');
    assert.strictEqual(r[0].descripcionTexto, 'Sistemas & más');
    assert.strictEqual(r[0].publicado, true);
    assert.strictEqual(r[0].creadoEn, '2026-07-01T10:00:00+02:00');
    assert.strictEqual(r[0].urlSitio, `https://aulavirtual.um.es/portal/site/${SITE}`);
    assert.ok(!('paginas' in r[0]), 'sin páginas si no se piden');
    assert.ok(!log.some((l) => l.includes('pages.json')));
    r = await run({ resource: 'avSite', operation: 'get', siteRef: SITE, siteIncludePages: true, siteIncludeGroups: true });
    assert.deepStrictEqual(r[0].paginas.slice(1), [{ id: 'p1', titulo: 'Exámenes', url: 'https://x/p1', herramientas: [{ herramienta: 'sakai.samigo', titulo: 'Exámenes', descripcion: null, idColocacion: 'pl1' }] }]);
    assert.deepStrictEqual(r[0].grupos, [{ title: 'G1' }]);
    assert.ok(log.some((l) => l.includes('includeGroups=true')));
    r = await run({ resource: 'avSite', operation: 'get', siteRef: SITE, simplify: false });
    assert.strictEqual(r[0].title.startsWith('(1898)'), true, 'sin simplificar devuelve el objeto de Sakai');
    // Sitio inexistente: error claro.
    siteFails = true;
    await assert.rejects(run({ resource: 'avSite', operation: 'get', siteRef: SITE }), /No se pudo obtener el sitio 1898_G_2026_N_N \(HTTP 404\)/);
    siteFails = false;
    await assert.rejects(run({ resource: 'avSite', operation: 'get', siteRef: 'https://aulavirtual.um.es/portal' }), /No reconozco el sitio/);

    // Trigger: anuncios nuevos con el título del sitio (modo manual).
    clearSiteTitleCache(); clearSessions(); log = [];
    const tctx = {
        getMode: () => 'manual', getWorkflowStaticData: () => ({}), getNode: () => ({ name: 'T' }),
        getNodeParameter: (n, d) => ({ events: ['announcementAv'], options: {} }[n] ?? d),
        getCredentials: async () => ({ username: 'a@um.es', password: 'x' }),
        helpers: { httpRequest: async (o) => http(o) },
    };
    const t = (await new UmuappTrigger().poll.call(tctx))[0].map((x) => x.json);
    assert.ok(t.length >= 1 && t.every((x) => x.sitioTitulo.startsWith('(18')), 'el trigger también');
    console.log('sites.js OK');
})().catch((e) => { console.error(e); process.exit(1); });
