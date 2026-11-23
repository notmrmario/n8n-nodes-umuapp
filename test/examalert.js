const assert = require('assert');
const { parseExamAlertDescription } = require('../dist/nodes/Umuapp/exams.js');
assert.deepStrictEqual(parseExamAlertDescription('ISO-2026-Cuestionario-Pr&aacute;ctica6 - Autor: JUAN PIERNAS CANOVAS'), { titulo: 'ISO-2026-Cuestionario-Práctica6', autor: 'JUAN PIERNAS CANOVAS' });
assert.deepStrictEqual(parseExamAlertDescription('Tema4 - Autor: BEGOÑA MOROS VALLE'), { titulo: 'Tema4', autor: 'BEGOÑA MOROS VALLE' });
assert.deepStrictEqual(parseExamAlertDescription('Tema 3 - Parcial - Autor: A B'), { titulo: 'Tema 3 - Parcial', autor: 'A B' });
assert.deepStrictEqual(parseExamAlertDescription('Sin autor'), { titulo: 'Sin autor', autor: '' });
console.log('examalert.js OK');
