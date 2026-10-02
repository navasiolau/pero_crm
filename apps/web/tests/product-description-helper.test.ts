import assert from 'node:assert/strict';
import {test} from 'node:test';
import {normalizeProductDescription,isProductDescriptionUnchanged} from '../src/lib/product-description';
test('description normalizes only blank new values and preserves exact Unicode/text/newline representation',()=>{
 for(const value of [null,undefined,'',' \t\r\n ','\u00a0'])assert.equal(normalizeProductDescription(value),null);
 for(const value of ['  A\n\tB\n\nC  \n\n','  A\r\n\tБ\r\n',' <script>literal</script>\n**text**  \n','  мебель 🪑  '])assert.equal(normalizeProductDescription(value),value);
});
test('raw equality never normalizes or trims expected values',()=>{
 assert.equal(isProductDescriptionUnchanged(' \t\r\n ',' \t\r\n '),true);assert.equal(isProductDescriptionUnchanged('A',' A '),false);assert.equal(isProductDescriptionUnchanged('A\n','A\r\n'),false);assert.equal(isProductDescriptionUnchanged('',null),false);
});
