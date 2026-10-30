import test from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';import vm from 'node:vm';
test('sync adapter bundles and loads as ES2020 without Node or structuredClone',async()=>{
 const result=await build({entryPoints:['finance-sync/candidate.mjs','finance-sync/readback.mjs'],bundle:true,platform:'neutral',target:'es2020',format:'iife',globalName:'FinanceSync',write:false,outdir:'unused-test-output'});
 for(const file of result.outputFiles){assert.doesNotMatch(file.text,/node:|require\(|process\.|structuredClone\(/);const context=vm.createContext({});vm.runInContext(file.text,context);assert.ok(context.FinanceSync);}
});
