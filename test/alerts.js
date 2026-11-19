// Filtro de tipos de alerta y orden por fecha con el formato real (dd/MM/yyyy HH:mm:ss).
const assert = require('assert');
const { UmuappTrigger } = require('../dist/nodes/Umuapp/UmuappTrigger.node.js');

const alerts = [
    { codigo_alerta: 1, titulo: 'Anuncio en 1896-AUTÓMATAS  [26/27]', fecha_envio: '21/10/2026 12:25:00' },
    { codigo_alerta: 2, titulo: 'Anuncio modificado en 1898-ISO  [26/27]', fecha_envio: '20/10/2026 22:35:00' },
    { codigo_alerta: 3, titulo: 'Tarea modificada en 1899-AEC  [26/27]', fecha_envio: '02/11/2026 10:00:00' },
    { codigo_alerta: 4, titulo: 'Llamamiento de examen en 1898-ISO  [26/27]', fecha_envio: '08/10/2026 09:55:00' },
    { codigo_alerta: 5, titulo: 'Asignatura calificada', fecha_envio: '02/07/2026 16:56:56' },
];
const ctx = (params, sd, mode) => ({
    getMode: () => mode, getNode: () => ({}), getWorkflowStaticData: () => sd,
    getNodeParameter: (n, d) => (n in params ? params[n] : d),
    getCredentials: async () => ({ username: 'a@um.es', password: 'p&ss+w%rd', appAuthToken: 'SECRET-APP-TOKEN', aulaVirtualUrl: 'https://aulavirtual.um.es' }),
    helpers: { httpRequest: async (o) => {
        if (o.url.includes('/cas/oidc/accessToken')) {
            assert.match(o.body, /(^|&)password=p%26ss%2Bw%25rd(&|$)/, 'contraseña con caracteres especiales bien codificada');
            assert.ok(!/SECRET-APP-TOKEN|appAuthToken|aulaVirtualUrl/.test(o.body), 'el formulario del CAS solo lleva usuario y contraseña');
        }
        if (o.url.includes('/cas/oidc/accessToken')) return { statusCode: 200, body: { access_token: 'T', expires_in: 14400, token_type: 'Bearer' } };
        if (o.url.endsWith('/public/login')) return {};
        return { body: { datos: alerts } };
    } },
});
const manual = async (alertTypes) =>
    ((await new UmuappTrigger().poll.call(ctx({ events: ['alert'], alertTypes, options: {} }, {}, 'manual')))?.[0] ?? []).map((x) => x.json.codigo_alerta);

(async () => {
    assert.deepStrictEqual(await manual(['anuncio']), [1], '«Anuncio» no incluye «Anuncio modificado»');
    assert.deepStrictEqual(await manual(['anuncio modificado']), [2]);
    assert.deepStrictEqual(await manual(['llamamiento']), [4]);
    assert.deepStrictEqual(await manual(['tarea modificada', 'asignatura calificada']).then((a) => a.sort()), [3, 5]);
    // sin filtro: lo más reciente primero, ordenando por fecha real (02/11 es posterior a 21/10)
    assert.deepStrictEqual(await manual([]), [3, 1, 2, 4, 5]);
    console.log('alerts.js OK');
})().catch((e) => { console.error(e); process.exit(1); });
