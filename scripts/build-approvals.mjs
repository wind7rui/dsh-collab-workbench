import {readFile,writeFile} from 'node:fs/promises'
const target=new URL('../client.js',import.meta.url)
let client=await readFile(target,'utf8')
const source=(await readFile(new URL('../src/client/approval-ui.js',import.meta.url),'utf8')).replace(/^export /gm,'')
const start='// BEGIN WORKBENCH APPROVAL UI',end='// END WORKBENCH APPROVAL UI'
const block=`${start}\n${source}\n${end}\n`
if(client.includes(start))client=client.slice(0,client.indexOf(start))+block+client.slice(client.indexOf(end)+end.length+1)
else client=client.replace('// src/client/main.jsx',block+'\n// src/client/main.jsx')
const updateSource=(await readFile(new URL('../src/client/update-ui.js',import.meta.url),'utf8')).replace(/^export /gm,'')
const updateStart='// BEGIN WORKBENCH UPDATE UI',updateEnd='// END WORKBENCH UPDATE UI'
const updateBlock=`${updateStart}\n${updateSource}\n${updateEnd}\n`
if(client.includes(updateStart))client=client.slice(0,client.indexOf(updateStart))+updateBlock+client.slice(client.indexOf(updateEnd)+updateEnd.length+1)
else client=client.replace('// src/client/main.jsx',updateBlock+'\n// src/client/main.jsx')
await writeFile(target,client)
console.log('Updated embedded approval and update UI (preserved existing workbench Client)')
