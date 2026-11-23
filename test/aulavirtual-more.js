// Calendario, exámenes, foros, archivo de correo, contadores de mensajes y fechas de Sakai (Instant / TimeString).
const assert = require('assert');
const { Umuapp } = require('../dist/nodes/Umuapp/Umuapp.node.js');
const { clearSessions } = require('../dist/nodes/Umuapp/webview.js');
const { sakaiTimeToIso, normalizeSakaiAssignment } = require('../dist/nodes/Umuapp/sakai.js');

const SITE = '1898_G_2026_N_N';
let log;
let currentSite = '';
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
        return json({ calendar_collection: [{ eventId: 'e1', siteId: SITE, siteName: 'ISO', title: 'Parcial', description: '<p>Aula 2</p>', type: 'Exam', firstTime: { time: Date.UTC(2026, 11, 10, 8, 0) }, duration: 5400000, assignmentId: null },
            { eventId: 'e2', siteId: SITE, title: 'Fecha límite Examen práctico 1', type: 'Deadline', firstTime: { time: Date.UTC(2026, 10, 20, 10, 0) }, duration: 0, assignmentId: 'a1' },
            { eventId: 'e3', siteId: SITE, title: 'Clase de teoría', type: 'Class session', firstTime: { time: Date.UTC(2026, 10, 21, 10, 0) }, duration: 3600000 }] });
    if (u.pathname === '/direct/assignment/my.json')
        return json({ assignment_collection: [
            { id: 'a1', context: SITE, title: 'Examen práctico 1', instructions: '<p>Sala 3</p>', openTimeString: '20261120080000000', dueTimeString: '20261120100000000' },
            { id: 'a2', context: SITE, title: 'Práctica 4', dueTimeString: '20261201225900000' },
        ] });
    if (u.pathname === `/direct/calendar/site/${SITE}.json`) return json({ calendar_collection: [] });
    if (u.pathname.startsWith('/portal/site/')) { currentSite = u.pathname.split('/').pop(); return res(200, '<html/>'); }
    if (u.pathname === '/direct/sam_pub.json' || u.pathname.startsWith('/direct/sam_pub/context/'))
        return json({ sam_pub_collection: currentSite === SITE ? [{ publishedAssessmentId: 7, ownerSiteId: SITE, title: 'Test tema 4', startDate: Date.UTC(2026, 10, 6, 8, 0), dueDate: Date.UTC(2026, 10, 9, 22, 55) }] : [] });
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
const run = async (params) => { clearSessions(); log = []; currentSite = ''; return (await new Umuapp().execute.call(ctx({ simplify: true, ...params })))[0].map((x) => x.json); };

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
    // Sesión nueva sin sitio actual: sam_pub.json a secas devuelve vacío, el nodo recorre los sitios.
    r = await run({ resource: 'avExam', operation: 'getAll' });
    assert.deepStrictEqual(r.map((x) => x.titulo), ['Test tema 4']);
    assert.strictEqual(r[0].evento, 'examAv');
    assert.strictEqual(r[0].consulta, 'portal');
    assert.strictEqual(r[0].inicio, '2026-11-06T09:00:00+01:00');
    assert.ok(log.some((l) => l.includes(`/portal/site/${SITE}`)));
    assert.ok(log.every((l) => !l.includes('assignment') && !l.includes('calendar')), 'no consulta otras fuentes');
    r = await run({ resource: 'avExam', operation: 'getAll', examSite: SITE, simplify: false });
    assert.strictEqual(r[0].publishedAssessmentId, 7);
    r = await run({ resource: 'avExam', operation: 'getAll', examSite: 'OTRO' });
    assert.strictEqual(r[0].sinResultados, true);

    // Examen a partir de la referencia_web de su alerta (solo trae sitio) o de su id.
    const REF = `https://aulavirtual.um.es/portal/site/${SITE}/tool/40a59028-0ead-4950-8395-b256aa8d6e23`;
    r = await run({ resource: 'avExam', operation: 'get', examRef: REF });
    assert.deepStrictEqual(r.map((x) => x.titulo), ['Test tema 4']);
    r = await run({ resource: 'avExam', operation: 'get', examRef: REF, examTitle: 'TEMA 4' });
    assert.strictEqual(r.length, 1);
    r = await run({ resource: 'avExam', operation: 'get', examRef: REF, examTitle: 'otro' });
    assert.strictEqual(r[0].sinResultados, true);
    assert.deepStrictEqual(r[0].candidatos, ['Test tema 4']);
    r = await run({ resource: 'avExam', operation: 'get', examRef: REF, examAlertDescription: 'Test tema 4 - Autor: ALGUIEN' });
    assert.deepStrictEqual(r.map((x) => [x.titulo, x.coincidencia]), [['Test tema 4', 'título igual']]);
    r = await run({ resource: 'avExam', operation: 'get', examRef: REF, examAlertDescription: 'Otro cuestionario - Autor: ALGUIEN' });
    assert.strictEqual(r[0].sinResultados, true);
    r = await run({ resource: 'avExam', operation: 'get', examRef: `/samigo/s/${SITE}/p/7` });
    assert.strictEqual(r[0].titulo, 'Test tema 4');
    r = await run({ resource: 'avExam', operation: 'get', examRef: `/samigo/s/${SITE}/p/999` });
    assert.strictEqual(r[0].sinResultados, true);

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
