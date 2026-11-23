// Los valores por defecto del trigger deben existir entre sus opciones.
const assert = require('assert');
const { UmuappTrigger } = require('../dist/nodes/Umuapp/UmuappTrigger.node.js');
let checked = 0;
const walk = (q, path) => {
    if (q.type === 'multiOptions' || q.type === 'options') {
        const values = q.options.map((o) => o.value);
        for (const d of [].concat(q.default)) if (d !== '') assert.ok(values.includes(d), `${path}${q.name}: el valor por defecto «${d}» no es una opción`);
        checked++;
    }
    if (q.type === 'collection' && q.options) q.options.forEach((o) => walk(o, `${path}${q.name}.`));
};
new UmuappTrigger().description.properties.forEach((p) => walk(p, ''));
assert.ok(checked >= 3);
console.log('trigger-defaults.js OK');
