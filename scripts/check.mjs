import {readFile,readdir,stat} from 'node:fs/promises'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {resolve} from 'node:path'
const root=fileURLToPath(new URL('../',import.meta.url))
const pkg=JSON.parse(await readFile(resolve(root,'package.json'),'utf8'))
for(const file of ['index.js','client.js','src/client/update-ui.js',...(await readdir(resolve(root,'src/host'))).filter(f=>f.endsWith('.js')).map(f=>'src/host/'+f)]){
 const result=spawnSync(process.execPath,['--check',resolve(root,file)],{encoding:'utf8'})
 if(result.status!==0)throw new Error(file+'\n'+result.stderr)
}
for(const locale of ['en','zh']){
 const doc=JSON.parse(await readFile(resolve(root,'locale',locale+'.json'),'utf8'))
 if(!doc.meta?.title||!doc.meta?.description)throw new Error('Missing locale metadata')
}
if(pkg.exports['./icon']!=='./icon.svg'||(await stat(resolve(root,'icon.svg'))).size>256*1024)throw new Error('Invalid icon export')
for(const file of ['src/host/execution.js','src/host/execution-engine.js','src/host/execution-tools.js'])await stat(resolve(root,file))
console.log(`PASS ${pkg.name}@${pkg.version}: JavaScript syntax, locales, icon exports and execution modules`)
