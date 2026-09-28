import fs from 'node:fs';
import path from 'node:path';
import { loadData } from '../../tools/lib/data.mjs';
import { simulate } from './battle.mjs';
const argv=process.argv.slice(2);const arg=(key,fallback)=>{const i=argv.indexOf('--'+key);return i<0?fallback:argv[i+1]};
if(!arg('a')||!arg('b')||!arg('out')){console.error('sim:dump --seed N --round N --a build.json --b build.json --out eval.json');process.exit(2)}
const opts={seed:Number(arg('seed',1)),round:Number(arg('round',1)),a:JSON.parse(fs.readFileSync(path.resolve(arg('a')),'utf8')),b:JSON.parse(fs.readFileSync(path.resolve(arg('b')),'utf8'))};
const log=simulate({...opts,data:loadData()});const out=path.resolve(arg('out'));fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify({...opts,log},null,2));console.log(out);
