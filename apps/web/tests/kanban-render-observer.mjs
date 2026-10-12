// Наблюдение внутри authored bodies; React/hooks/DnD остаются настоящими.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
export const KANBAN_RENDER_BINDINGS = Object.freeze([
 {relative:'src/app/(app)/projects/kanban-board.tsx',names:['DraggableCard','StageColumn','KanbanBoard'],callback:'KanbanBoard'},
 {relative:'src/app/(app)/products/products-kanban.tsx',names:['DraggableProduct','StatusColumn','ProductsKanban'],callback:'ProductsKanban'},
 {relative:'src/components/project-kanban-card.tsx',names:['ProjectKanbanCard']},
 {relative:'src/components/product-kanban-card.tsx',names:['ProductKanbanCard']},
 {relative:'src/app/(app)/projects/[id]/products-tab.tsx',names:['DraggableProduct','StatusColumn','ProductsTab']},
 {relative:'src/components/product-inline-fields.tsx',names:['ProductInlineDetails']},
 {relative:'src/components/project-inline-fields.tsx',names:['ProjectConfirmedTotal']},
 {relative:'src/components/inline-fields.tsx',names:['InlineTextField']},
]);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function nameOf(ts,node){if(node.name&&ts.isIdentifier(node.name))return node.name.text;let parent=node.parent;if(ts.isCallExpression(parent)&&parent.arguments.includes(node))parent=parent.parent;return ts.isVariableDeclaration(parent)&&ts.isIdentifier(parent.name)?parent.name.text:null;}
export function observeKanbanRenders(ts,raw,binding){
 assert.ok(KANBAN_RENDER_BINDINGS.includes(binding),'DECLARED_KANBAN_RENDER_BINDING_REQUIRED');
 const source=ts.createSourceFile(binding.relative,raw,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),seen=new Set(),edits=[],bodies=[];
 function visit(node){if((ts.isFunctionDeclaration(node)||ts.isFunctionExpression(node)||ts.isArrowFunction(node))&&node.body&&ts.isBlock(node.body)){
  const name=nameOf(ts,node);if(binding.names.includes(name)){assert.ok(!seen.has(name),'DUPLICATE_KANBAN_AUTHORED_BODY');seen.add(name);const key=binding.relative+'#'+name;let at=node.body.getStart(source)+1;
   for(const statement of node.body.statements){if(ts.isExpressionStatement(statement)&&ts.isStringLiteral(statement.expression))at=statement.end;else break;}
   edits.push({at,text:'\nif (!globalThis.__KANBAN_BODY_COUNTS__) throw Error("KANBAN_COUNTER_NOT_INITIALIZED"); globalThis.__KANBAN_BODY_COUNTS__['+JSON.stringify(key)+'] = (globalThis.__KANBAN_BODY_COUNTS__['+JSON.stringify(key)+'] ?? 0) + 1;\n'});
   if(name===binding.callback){const returned=node.body.statements.find(ts.isReturnStatement);assert.ok(returned,'KANBAN_CALLBACK_OBSERVER_RETURN_REQUIRED');edits.push({at:returned.getStart(source),text:'globalThis.__KANBAN_CALLBACKS__['+JSON.stringify(name)+'] = onOpen;\n'});}
   bodies.push({name,key,bodyStart:node.body.getStart(source),insertAt:at});
  }}ts.forEachChild(node,visit);
 }
 visit(source);assert.deepEqual([...seen].sort(),[...binding.names].sort(),'KANBAN_AUTHORED_BODY_MISSING');
 let contents=raw;for(const edit of edits.sort((a,b)=>b.at-a.at))contents=contents.slice(0,edit.at)+edit.text+contents.slice(edit.at);
 return {contents,relative:binding.relative,originalSha256:hash(raw),transformedSha256:hash(contents),bodies,scope:'readonly counters/callback identity; no body substitution'};
}