// Tareas activas de umuKernel/allActiveTasks (forma real, sin datos personales): entrega, nota y título real del sitio.
const assert = require('assert');
const { Umuapp } = require('../dist/nodes/Umuapp/Umuapp.node.js');
const { clearSessions } = require('../dist/nodes/Umuapp/webview.js');
const { normalizeSakaiSite } = require('../dist/nodes/Umuapp/sites.js');

const WRAP = {
    data: {
        totalAssignment: 3,
        assignment: [
            {
                assignment: {
                    attachments: [{ name: 'Boletin.pdf', url: 'https://aulavirtual.um.es/access/content/attachment/1901_G_2026_N_N/Tareas/x/Boletin.pdf' }],
                    closeTimeString: '2026-12-11T22:59:00Z', dueTimeString: '2026-12-11T22:59:00Z', openTimeString: '2026-11-09T09:13:00Z',
                    gradeScale: 'SCORE_GRADE_TYPE', gradeScaleMaxPoints: '10,00', id: 'e5078c6f', instructions: '<p>Hola &amp; adi&oacute;s</p>', status: 'OPEN',
                    submissionType: 'TEXT_AND_ATTACHMENT_ASSIGNMENT_SUBMISSION', title: 'Entrega Prácticas - Convocatoria I', allowResubmission: true,
                    submissions: [{ id: 's1', grade: '8,5', graded: true, returned: true, late: false, userSubmission: true, status: 'Calificado', dateSubmitted: '2026-12-01T10:00:00Z', feedbackComment: '<p>Bien</p>', submittedAttachments: [], canSubmit: false, draft: false }],
                },
                codAsi: '1901#1901', codTitu: '221P01#284P01', cursoAca: '2026', roleMember: 'Estudiante', siteId: '1901_G_2026_N_N',
                siteName: '(1901) PROGRAMACIÓN CONCURRENTE Y DISTRIBUIDA  [26/27]', tituDes: 'GRADO EN INGENIERÍA INFORMÁTICA', type: 'asignaturaGrado',
            },
            {
                assignment: { closeTimeString: '2026-12-14T09:00:00Z', dueTimeString: '2026-12-14T09:00:00Z', openTimeString: '2026-11-18T16:00:00Z', id: 'bfa81126', title: 'Reserva de puesto', status: 'OPEN', submissions: null },
                siteId: '1899_G_2026_N_N', siteName: '(1899) AMPLIACIÓN DE ESTRUCTURA DE COMPUTADORES  [26/27]', roleMember: 'Estudiante', type: 'asignaturaGrado',
            },
        ],
    },
    displayTitle: 'x', entityReference: '/umuKernel',
};
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
    if (u.pathname === '/direct/umuKernel/allActiveTasks.json') return res(200, JSON.stringify(WRAP));
    throw new Error('inesperada ' + o.url);
}
const ctx = (params) => ({
    getInputData: () => [{ json: {} }], getNodeParameter: (n, _i, d) => (n in params ? params[n] : d), getNode: () => ({ name: 'U' }),
    continueOnFail: () => false, getCredentials: async () => ({ username: 'a@um.es', password: 'x' }), helpers: { httpRequest: async (o) => http(o) },
});
const run = async (params) => { clearSessions(); return (await new Umuapp().execute.call(ctx({ simplify: true, resource: 'task', operation: 'getActive', ...params })))[0].map((x) => x.json); };

(async () => {
    let r = await run({});
    assert.strictEqual(r.length, 2);
    const t = r[0];
    assert.strictEqual(t.evento, 'task');
    assert.strictEqual(t.id, 'e5078c6f');
    assert.strictEqual(t.sitio, '1901_G_2026_N_N');
    assert.strictEqual(t.sitioTitulo, '(1901) PROGRAMACIÓN CONCURRENTE Y DISTRIBUIDA  [26/27]');
    assert.strictEqual(t.apertura, '2026-11-09T10:13:00+01:00');
    assert.strictEqual(t.fechaLimite, '2026-12-11T23:59:00+01:00');
    assert.strictEqual(t.instruccionesTexto, 'Hola & adiós');
    assert.deepStrictEqual([t.entrega.calificada, t.entrega.nota, t.entrega.entregada, t.entrega.estado], [true, '8,5', true, 'Calificado']);
    assert.strictEqual(t.entrega.comentarioProfesor, '<p>Bien</p>');
    assert.strictEqual(t.codigoAsignatura, '1901#1901');
    assert.strictEqual(t.googleCalendar.start, '2026-12-11T23:59:00+01:00');
    assert.strictEqual(r[1].entrega, null, 'submissions null');
    assert.strictEqual(r[1].sitioTitulo, '(1899) AMPLIACIÓN DE ESTRUCTURA DE COMPUTADORES  [26/27]');
    r = await run({ simplify: false });
    assert.strictEqual(r[0].siteId, '1901_G_2026_N_N', 'sin simplificar: el objeto de la UM');

    // Sitio: descripción real (htmlDescription viene escapado) y páginas sin herramientas.
    const s = normalizeSakaiSite({ id: 'X', title: 'T', description: '<p>Sitio: Delegaci&oacute;n</p>', htmlDescription: '&lt;p&gt;Sitio: Delegaci&oacute;n&lt;/p&gt;', sitePages: [{ id: 'p', title: 'Inicio', url: 'u' }] }, 'https://b');
    assert.strictEqual(s.descripcionTexto, 'Sitio: Delegación');
    assert.deepStrictEqual(s.paginas, [{ id: 'p', titulo: 'Inicio', url: 'u' }]);
    console.log('active-tasks.js OK');
})().catch((e) => { console.error(e); process.exit(1); });
