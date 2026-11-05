const stub = new URL('./dsh-stubs.mjs', import.meta.url).href
export async function resolve(specifier, context, nextResolve) {
  if (['@deepseek-ai/dsh-llm', '@deepseek-ai/dsh-tools'].includes(specifier)) return { url: stub, shortCircuit: true }
  return nextResolve(specifier, context)
}
