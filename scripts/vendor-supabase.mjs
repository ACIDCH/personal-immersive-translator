import {readFileSync,writeFileSync,mkdirSync,copyFileSync} from 'node:fs';
import {join} from 'node:path';
// Use the official ready-built browser bundle. No alternative auth client.
export function vendorSupabase(upstream,output){
 const pkg=JSON.parse(readFileSync(join(upstream,'package.json'),'utf8'));
 if(pkg.version!=='2.118.0'||pkg.license!=='MIT')throw Error('Unexpected Supabase SDK version/license');
 mkdirSync(output,{recursive:true});
 const code=readFileSync(join(upstream,'dist/umd/supabase.js'),'utf8');
 writeFileSync(join(output,'supabase.js'),code+'\nexport const createClient = supabase.createClient;\n');
 copyFileSync(join(upstream,'LICENSE'),join(output,'SUPABASE-LICENSE.txt'));
}
