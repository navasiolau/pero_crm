// Структурированный итог Node test-runner без private error bodies.
export default async function* reporter(events) {
  let summary=null;
  const files=new Map();
  for await (const event of events) {
    if (event.type==='test:summary') summary=event.data;
    if (!['test:pass','test:fail'].includes(event.type)||!event.data.file) continue;
    const file=event.data.file, previous=files.get(file)??{file,passed:0,failed:0};
    previous[event.type==='test:pass'?'passed':'failed']++;
    files.set(file,previous);
  }
  yield JSON.stringify({summary,files:[...files.values()].sort((a,b)=>a.file.localeCompare(b.file))})+'\n';
}
