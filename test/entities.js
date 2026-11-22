// Entidades HTML en los textos de salida.
const assert = require('assert');
const { decodeEntities, decodeDeep, stripHtml } = require('../dist/nodes/Umuapp/functions.js');
const { normalizeSakaiExam } = require('../dist/nodes/Umuapp/sakai.js');

assert.strictEqual(decodeEntities('ISO-2026-Cuestionario-Pr&aacute;ctica6'), 'ISO-2026-Cuestionario-Práctica6');
assert.strictEqual(decodeEntities('A&ntilde;o &Uacute;ltimo &iquest;s&iacute;? &uuml; &ordm;'), 'Año Último ¿sí? ü º');
assert.strictEqual(decodeEntities('&#241; &#xF1; &#8364; &euro; &ndash;'), 'ñ ñ € € –');
assert.strictEqual(decodeEntities('R&D &foo; &amp;aacute; &#0; AT&T;'), 'R&D &foo; &aacute; &#0; AT&T;', 'lo desconocido queda igual y no hay doble decodificación');
assert.strictEqual(stripHtml('<p>Examen&nbsp;de &quot;Pr&aacute;cticas&quot;</p>'), 'Examen de "Prácticas"');

const e = normalizeSakaiExam({ publishedAssessmentId: 1, title: 'Cuestionario-Pr&aacute;ctica6' }, '');
const d = decodeDeep({ ...e, cuerpo: '<p>a &lt; b &aacute;</p>', lista: ['&eacute;'] });
assert.strictEqual(d.titulo, 'Cuestionario-Práctica6');
assert.strictEqual(d.raw.title, 'Cuestionario-Práctica6', 'también el raw');
assert.strictEqual(d.cuerpo, '<p>a &lt; b &aacute;</p>', 'los campos con HTML no se tocan');
assert.deepStrictEqual(d.lista, ['é']);
assert.strictEqual(decodeDeep(5), 5);
assert.strictEqual(decodeDeep(null), null);
console.log('entities.js OK');
