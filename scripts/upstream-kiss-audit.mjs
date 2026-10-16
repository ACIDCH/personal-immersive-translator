/**
 * License and integration-gate inspection for a separately checked-out,
 * pinned KISS Translator upstream. The GPL source stays OUTSIDE this MIT repo.
 * No network access, shell execution, API keys, or runtime source injection.
 */
import {existsSync,readFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';

export const KISS_TAG='v2.1.1';
export const KISS_COMMIT='a1279f2517bd478ef1dd93b941f9177094486cd4';

function must(ok,message){if(!ok)throw new Error(message);}
function readJson(path){return JSON.parse(readFileSync(path,'utf8'));}
export function inspectKissUpstream(upstreamRoot,ourRoot=process.cwd()){
  const root=resolve(upstreamRoot);
  const packageJson=readJson(join(root,'package.json'));
  const manifest=readJson(join(root,'public/manifest.json'));
  const license=readFileSync(join(root,'LICENSE'),'utf8');
  const ours=readJson(join(ourRoot,'manifest.json'));
  must(packageJson.name==='kiss-translator'&&packageJson.version==='2.1.1',
       'Unexpected KISS tag identity; do not build or transplant unreviewed code');
  must(/GNU GENERAL PUBLIC LICENSE/.test(license)&&/Version 3, 29 June 2007/.test(license),
       'GPL-3.0 provenance could not be verified');
  must(manifest.manifest_version===3,'Upstream Chrome extension is not Manifest V3');
  must(ours.manifest_version===3,'Current PIT extension must remain MV3');
  for(const file of ['src/content.js','src/background.js',
     'src/apis/trans.js','src/config/api.js','src/libs/batchQueue.js','pnpm-lock.yaml']){
    must(existsSync(join(root,file)),'Missing KISS source component: '+file);
  }
  const broadHosts=(manifest.host_permissions||[]).includes('<all_urls>');
  const broadScripts=(manifest.content_scripts||[]).some(rule=>
    (rule.matches||[]).includes('<all_urls>'));
  const ourBroadHosts=(ours.host_permissions||[]).includes('<all_urls>');
  must(!ourBroadHosts,'PIT production extension unexpectedly gained global permissions');
  const built=existsSync(join(root,'build/chrome/manifest.json'));
  let chromeBuild=null;
  if(built){
    const final=readJson(join(root,'build/chrome/manifest.json'));
    must(final.manifest_version===3,'KISS build output is not MV3');
    const expectedFiles=[final.background?.service_worker,final.action?.default_popup,
      final.options_ui?.page,...(final.content_scripts||[]).flatMap(x=>x.js||[])].filter(Boolean);
    must(expectedFiles.length>=3,'KISS build output is missing extension entrypoints');
    for(const file of expectedFiles) {
      must(!file.includes('..')&&existsSync(join(root,'build/chrome',file)),
        'KISS Chrome bundle is missing declared entrypoint: '+file);
    }
    chromeBuild={
      manifestV3:true,
      serviceWorker:final.background?.service_worker||null,
      contentScriptCount:final.content_scripts?.length||0,
      checkedEntrypoints:expectedFiles.length
    };
  }
  return {
    upstream:'fishjar/kiss-translator',tag:KISS_TAG,
    requiredCommit:KISS_COMMIT,
    sourceLicense:'GPL-3.0',applicationVersion:packageJson.version,
    chromeManifestV3:true,
    originalHostPermissionAllUrls:broadHosts,
    originalContentScriptAllUrls:broadScripts,
    pitProductionBroadHostPermission:ourBroadHosts,
    upstreamChromeBuildObserved:built,
    chromeBuild,
    independentSourceCheckout:true,
    productionCodeCopied:false,
    approval:'POC_ONLY_NOT_PRODUCTION_MIGRATION',
    migrationBlockers:[
      'GPL-3.0 obligations / license decision for a distributed derivative',
      'replace broad host grants with per-origin opt-in where technically feasible',
      'keep ordinary translation default and paid AI separately user-confirmed',
      'preserve current ASR/PDF/OCR/recording-bound subtitle security gates',
      'real player, multi-site regression and resource benchmark before cutover'
    ]
  };
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const root=process.argv[2];
  if(!root){console.error('Usage: node scripts/upstream-kiss-audit.mjs UPSTREAM_CHECKOUT');process.exitCode=2;}
  else{
    try{console.log(JSON.stringify(inspectKissUpstream(root),null,2));}
    catch(error){console.error('Upstream gate failed:',error.message);process.exitCode=1;}
  }
}
