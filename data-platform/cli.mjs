#!/usr/bin/env node
import { convertSnapshot, validateGeneration } from './index.mjs';
const [command,...args]=process.argv.slice(2),options={};
for(let i=0;i<args.length;i+=2){if(!args[i]?.startsWith('--')||!args[i+1])throw new Error('Flags require values');options[args[i].slice(2)]=args[i+1];}
try{
 let result;
 if(command==='convert'&&options.manifest&&options.output&&options.tenant)result=await convertSnapshot({manifestPath:options.manifest,outputRoot:options.output,tenantKey:options.tenant});
 else if(command==='validate'&&options.generation)result=await validateGeneration(options.generation);
 else throw new Error('Usage: convert --manifest PATH --output PRIVATE_PATH --tenant STABLE_KEY | validate --generation PATH');
 process.stdout.write(`${JSON.stringify(result,null,2)}\n`);
}catch(error){process.stderr.write(`${error.message}\n`);process.exitCode=1;}
