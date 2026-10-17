import {copyFileSync,existsSync,mkdirSync,readFileSync} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';

// Publish only the web translation runtime and trusted settings UI.
// Keep a single implementation in the repository's src/; no forked copies.
const here=dirname(fileURLToPath(import.meta.url));
const source=resolve(here,'../../../src');
const output=resolve(here,'../public');
const copies=[
 ['content.js','pit-native.js'],
 ['content.css','pit-native.css'],
 ['options.html','pit-options.html'],
 ['options.js','options.js'],
 ['ui.css','ui.css'],
 ['lib/settings.js','lib/settings.js'],
 ['lib/ai-profiles.js','lib/ai-profiles.js']
];
for(const [src,dst] of copies){
 const path=join(source,src);
 if(!existsSync(path))throw Error('Native PIT source missing: '+src);
 const target=join(output,dst);
 mkdirSync(dirname(target),{recursive:true});
 copyFileSync(path,target);
}
const html=readFileSync(join(output,'pit-options.html'),'utf8');
if(!html.includes('options.js')||!html.includes('ui.css'))throw Error('Native settings reference check failed');
console.log('Copied PIT web runtime and trusted settings page into isolated WXT build.');
