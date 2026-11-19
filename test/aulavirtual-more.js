// Calendario, exámenes, foros, archivo de correo, contadores de mensajes y fechas de Sakai (Instant / TimeString).
const assert = require('assert');
const { Umuapp } = require('../dist/nodes/Umuapp/Umuapp.node.js');
const { clearSessions } = require('../dist/nodes/Umuapp/webview.js');
const { sakaiTimeToIso, normalizeSakaiAssignment } = require('../dist/nodes/Umuapp/sakai.js');

const SITE = '1898_G_2026_N_N';
let log;
function http(o) {
    const u = new URL(o.url);
    log.push(`${o.method} ${u.host}${u.pathname}${u.search}`);
    const res = (statusCode, body = '', headers = {}) => ({ statusCode, body, headers });
    if (u.host === 'entrada.um.es') {
        if (o.method === 'POST' && u.pathname === '/cas/v1/tickets') return res(201, '', { location: 'https://entrada.um.es/cas/v1/tickets/TGT-1' });
        return o.method === 'POST' ? res(200, 'ST-1') : res(200);
    }
    if (u.pathname === '/sakai-login-tool/container') return res(302, '', { location: '/portal', 'set-cookie': ['JSESSIONID=S1.n1; Path=/'] });
    if (u.pathname === '/portal') return res(200, '<html/>');
    if (u.pathname === '/direct/session/current.json') return res(200, JSON.stringify({ userEid: 'nacho' }));
    const json = (o2) => res(200, JSON.stringify(o2));
    if (u.pathname === '/direct/calendar/my.json')
        return json({ calendar_collection: [{ eventId: 'e1', siteId: SITE, siteName: 'ISO', title: 'Parcial', description: '<p>Aula 2</p>', type: 'Exam', firstTime: { time: Date.UTC(2026, 11, 10, 8, 0) }, duration: 5400000, assignmentId: null }] });
    if (u.pathname === `/direct/calendar/site/${SITE}.json`) return json({ calendar_collection: [] });
    if (u.pathname === '/direct/sam_pub.json') return json({ sam_pub_collection: [{ publishedAssessmentId: 7, title: 'Test tema 4', startDate: Date.UTC(2026, 10, 6, 8, 0), dueDate: Date.UTC(2026, 10, 9, 22, 55) }] });
    if (u.pathname === `/direct/forums/site/${SITE}.json`) return json({ forums_collection: [{ id: 'f1', title: 'Dudas' }] });
    if (u.pathname === `/direct/forums/site/${SITE}/forum/f1.json`) return json({ forums_collection: [{ id: 't1', title: 'Práctica 2' }] });
    if (u.pathname === `/direct/forums/site/${SITE}/forum/f1/topic/t1.json`) return json({ forums_collection: [{ id: 'm1', title: 'Pregunta' }] });
    if (u.pathname === `/direct/mailarchive/siteMessages/${SITE}.json`)
        return json({ mailarchive_collection: [{ id: 'mm1', body: '<p>Hola</p>', createdOn: Date.UTC(2026, 10, 19, 9, 0), headers: ['From: Profe <p@um.es>', 'Subject: Aviso'] }] });
    if (u.pathname === '/direct/synopticmsgcntritem.json')
        return json({ synopticmsgcntritem_collection: [{ siteId: SITE, siteTitle: 'ISO', newMessagesCount: 2, newForumCount: 0 }] });
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
    // fechas de Sakai
    assert.strictEqual(sakaiTimeToIso(Date.UTC(2026, 10, 30, 22, 59) / 1000 + 0.123), '2026-11-30T23:59:00+01:00', 'Instant como segundos con decimales');
    assert.strictEqual(sakaiTimeToIso({ epochSecond: Date.UTC(2026, 10, 30, 22, 59) / 1000, nano: 0 }), '2026-11-30T23:59:00+01:00');
    assert.strictEqual(sakaiTimeToIso('20261130225900000'), '2026-11-30T23:59:00+01:00', 'TimeString de Sakai (UTC)');
    const a = normalizeSakaiAssignment({ id: 'x', context: SITE, title: 'T', dueTime: null, dueTimeString: '20261130225900000', openTimeString: '20261101080000000' }, 'https://aulavirtual.um.es');
    assert.strictEqual(a.fechaLimite, '2026-11-30T23:59:00+01:00', 'cae a dueTimeString si no hay Instant');
    assert.strictEqual(a.apertura, '2026-11-01T09:00:00+01:00');

    // calendario
    let r = await run({ resource: 'avCalendar', operation: 'getAll', avFirstDate: '2026-11-01', avLastDate: '2026-12-31' });
    assert.strictEqual(r[0].titulo, 'Parcial');
    assert.strictEqual(r[0].inicio, '2026-12-10T09:00:00+01:00');
    assert.strictEqual(r[0].fin, '2026-12-10T10:30:00+01:00');
    assert.strictEqual(r[0].googleCalendar.end, '2026-12-10T10:30:00+01:00');
    assert.ok(log.some((l) => l.includes('/calendar/my.json?firstDate=2026-11-01&lastDate=2026-12-31')));
    r = await run({ resource: 'avCalendar', operation: 'getSite', avSiteId: SITE, avFirstDate: '', avLastDate: '' });
    assert.deepStrictEqual(r, []);

    // exámenes
    r = await run({ resource: 'avExam', operation: 'getAll' });
    assert.strictEqual(r[0].titulo, 'Test tema 4');
    assert.strictEqual(r[0].inicio, '2026-11-06T09:00:00+01:00');

    // foros: baja un nivel cada vez
    r = await run({ resource: 'avForum', operation: 'getSite', avSiteId: SITE, avForumId: '', avTopicId: '' });
    assert.strictEqual(r[0].title, 'Dudas');
    r = await run({ resource: 'avForum', operation: 'getSite', avSiteId: SITE, avForumId: 'f1', avTopicId: '' });
    assert.strictEqual(r[0].title, 'Práctica 2');
    r = await run({ resource: 'avForum', operation: 'getSite', avSiteId: SITE, avForumId: 'f1', avTopicId: 't1' });
    assert.strictEqual(r[0].title, 'Pregunta');

    // archivo de correo
    r = await run({ resource: 'avMail', operation: 'getSite', avSiteId: SITE });
    assert.strictEqual(r[0].asunto, 'Aviso');
    assert.strictEqual(r[0].de, 'Profe <p@um.es>');
    assert.strictEqual(r[0].cuerpoTexto, 'Hola');

    // contadores de mensajes privados
    r = await run({ resource: 'avMessages', operation: 'getCounts' });
    assert.deepStrictEqual([r[0].sitio, r[0].mensajesPrivadosNuevos, r[0].mensajesForoNuevos], [SITE, 2, 0]);

    await assert.rejects(run({ resource: 'avForum', operation: 'getSite', avSiteId: '  ' }), /Indica el sitio/);
    console.log('aulavirtual-more.js OK');
})().catch((e) => { console.error(e); process.exit(1); });
