import {registerHooks} from 'node:module'
import {pathToFileURL} from 'node:url'
const runtime='/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/'
const packages=new Set(['@deepseek-ai/dsh-tools','@deepseek-ai/dsh-llm'])
// Only bridge peer resolution for this unpacked test checkout; shipping imports remain portable.
registerHooks({resolve(specifier,context,next){if(specifier==='zod'&&context.parentURL?.includes('/dsh-workbench/'))return next(pathToFileURL(runtime+'zod/index.js').href,context);if(packages.has(specifier)&&context.parentURL?.includes('/dsh-workbench/'))return next(pathToFileURL(runtime+specifier+'/lib/index.js').href,context);return next(specifier,context)}})
