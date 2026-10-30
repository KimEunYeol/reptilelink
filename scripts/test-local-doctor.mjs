import assert from'node:assert/strict';import fs from'node:fs';import path from'node:path';import{randomUUID}from'node:crypto';
import{doctor,inspectBackups}from'./local-doctor.mjs';import{createBackup,createJournal}from'./backup-restore.mjs';import{backupStore,readEnvelope,encrypt,publishPrivate,pruneOwned,retentionMs}from'./backup-safety.mjs';import{sourceQuery,run,literal as q}from'./backup-db.mjs';import{localStatus}from'./local-utils.mjs';import{createAccount,finishAccount,call}from'./account-qa.mjs';
const root='/tmp/reptilelink-doctor-qa-'+randomUUID(),options={root:root+'/backups',keyRoot:root+'/keys'};let account,checks=0;
function assertBaseline(report){
 for(const c of report.checks.filter(c=>c.name!=='database'))assert.equal(c.ok,true,c.name+':'+(c.code??'CHECK_FAILED'));
 const db=report.checks.find(c=>c.name==='database');assert.ok(db.ok||db.code==='DOCTOR_CLEANUP_PENDING',JSON.stringify(db));
 for(const flag of['writesEnabled','admissionOpen','analyticsEnabled','policyReady'])assert.equal(db.details[flag],true);
 if(!db.ok){assert.equal(report.status,'attention');assert.ok(['mediaPending','mediaDue','accountJobs','animalJobs','receiptDue','withdrawalDue','activityDue','analyticsDue'].some(k=>db.details[k]>0));}
 else assert.equal(report.status,'passed');
 return db.details;
}
try{
 const created=await createBackup(options),{store,key}=backupStore(options.root,options.keyRoot),backup=readEnvelope(created.file,key,'backup'),journal=readEnvelope(created.journal,key,'journal');const epoch=backup.meta.epoch;
 const good=await doctor(options),baseline=assertBaseline(good);assert.ok(good.checks.find(c=>c.name==='storage').verifiedActualBytes);checks++;
 // Seven retained daily-size archives must not all remain on a diagnostic subprocess heap.
 const largeFiles=[],padding='x'.repeat(24*1024*1024);
 try{for(let i=1;i<=7;i++){const v={...backup,id:randomUUID(),createdAt:new Date(Date.parse(backup.createdAt)-i*60000).toISOString(),qaPadding:padding},file=path.join(store.path,v.id+'.rlbk');publishPrivate(file,encrypt(v,key,'backup'));largeFiles.push(file);}
  const program=`import{inspectBackups}from ${JSON.stringify(new URL('./local-doctor.mjs',import.meta.url).href)};let input='';for await(const chunk of process.stdin)input+=chunk;const{options,epoch}=JSON.parse(input);const value=await inspectBackups(options,epoch);console.log(JSON.stringify({backups:value.backups,authenticated:value.authenticated}));`;
  const result=JSON.parse((await run('bash',['-c','ulimit -c 0\nexec "$@"','doctor-memory',process.execPath,'--max-old-space-size=192','--input-type=module','-e',program],{input:JSON.stringify({options,epoch}),limit:4096,timeout:90000,stage:'DOCTOR_RETENTION_MEMORY'})).toString());assert.deepEqual(result,{backups:8,authenticated:true});checks++;
 }finally{for(const file of largeFiles)fs.unlinkSync(file);}
 const sensitive=localStatus(),output=JSON.stringify(good);for(const value of[sensitive.secret,sensitive.publishable,...backup.meta.accounts.map(a=>a.id),...backup.meta.objects.map(o=>o.name)])assert.ok(!output.includes(value));assert.ok(!output.includes(backup.sql.data.slice(0,150)));checks++;
 const remote=await doctor({...options,frontendUrl:'http://never-contact-this.invalid:5173/'});assert.equal(remote.checks.find(c=>c.name==='frontend').code,'DOCTOR_NON_LOOPBACK_REFUSED');assert.equal(remote.status,'attention');checks++;
 const outage=await doctor({...options,storageUrl:'http://127.0.0.1:1'});assert.equal(outage.checks.find(c=>c.name==='storage').ok,false);assert.equal(outage.status,'attention');checks++;
 async function candidate(kind,value,fn){const file=path.join(store.path,value.id+(kind==='backup'?'.rlbk':'.rljr')),original=kind==='backup'?created.file:created.journal,hidden=original+'.hold';fs.renameSync(original,hidden);try{publishPrivate(file,encrypt(value,key,kind));await fn(file);}finally{if(fs.existsSync(file))fs.unlinkSync(file);fs.renameSync(hidden,original);}}
 await candidate('journal',{...journal,id:randomUUID(),createdAt:new Date(Date.now()-16*60000).toISOString()},async()=>assert.rejects(()=>inspectBackups(options,epoch),/STALE/));checks++;
 await candidate('journal',{...journal,id:randomUUID(),epoch:randomUUID()},async()=>assert.rejects(()=>inspectBackups(options,epoch),/EPOCH/));checks++;
 await candidate('backup',{...backup,id:randomUUID(),createdAt:new Date(Date.now()-2*86400000).toISOString()},async()=>assert.rejects(()=>inspectBackups(options,epoch),/STALE/));checks++;
 await candidate('backup',{...backup,id:randomUUID(),createdAt:new Date(Date.now()-retentionMs-60000).toISOString()},async()=>assert.rejects(()=>inspectBackups(options,epoch),/RETENTION/));checks++;
 const old={...backup,id:randomUUID(),createdAt:new Date(Date.now()-retentionMs-60000).toISOString()},oldFile=path.join(store.path,old.id+'.rlbk');publishPrivate(oldFile,encrypt(old,key,'backup'));assert.equal(pruneOwned(store,key).removed,1);assert.ok(!fs.existsSync(oldFile));assert.equal((await inspectBackups(options,epoch)).authenticated,true);checks++;
 const tamper=store.path+'/'+randomUUID()+'.rlbk';const bytes=Buffer.from(fs.readFileSync(created.file));bytes[bytes.length-1]^=1;publishPrivate(tamper,bytes);await assert.rejects(()=>inspectBackups(options,epoch),/UNVERIFIED/);assert.ok(fs.existsSync(tamper));fs.unlinkSync(tamper);checks++;
 const partial=store.path+'/.partial-'+randomUUID();publishPrivate(partial,Buffer.from('incomplete'));await assert.rejects(()=>inspectBackups(options,epoch),/INCOMPLETE/);fs.unlinkSync(partial);checks++;
 fs.chmodSync(options.keyRoot,0o755);await assert.rejects(()=>inspectBackups(options,epoch),/NOT_PRIVATE/);fs.chmodSync(options.keyRoot,0o700);checks++;
 account=await createAccount();const outdated=await doctor(options);assert.equal(outdated.checks.find(c=>c.name==='backups').code,'DOCTOR_JOURNAL_CURRENT_STATE_CHANGED');checks++;await call(account.c,'request_account_deletion',{p_expected:(await call(account.c,'my_dashboard')).profile.revision,p_request_id:randomUUID(),p_confirm:'탈퇴'});await createJournal(options);const pending=await doctor(options);assert.equal(pending.status,'attention');assert.equal(pending.checks.find(c=>c.name==='database').details.accountJobs,baseline.accountJobs+1);assert.ok(!JSON.stringify(pending).includes(account.id));checks++;
 await finishAccount(account);await createJournal(options);const recovered=await doctor(options),after=assertBaseline(recovered);assert.equal(after.accountJobs,baseline.accountJobs);assert.equal(after.profiles,baseline.profiles);checks++;
 console.log(`Passed ${checks} actual local doctor checks: live configuration/ports/DB/Storage/hash and no identifiers/secrets, remote refusal/local outage, authenticated stale/mismatched/expired/tampered/incomplete archives, owned prune/private key, actual pending withdrawal and recovery.`);
}finally{if(account){await finishAccount(account);await sourceQuery(`with d as(delete from private.account_withdrawals where user_id=${q(account.id)}::uuid returning 1)select to_json(count(*))from d;`);}fs.rmSync(root,{recursive:true,force:true});}
