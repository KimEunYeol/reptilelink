import fs from 'node:fs';
import {spawn} from 'node:child_process';
import {randomUUID,X509Certificate} from 'node:crypto';
import {run,postgresImage} from './backup-db.mjs';
import {insist,sha} from './backup-safety.mjs';

export const productionRef='suuemuqwjwbddbjevvmg';
export const recoveryRef='berprfddzalsotnrxpdb';
export const refPattern=/^[a-z]{20}$/;
const keys=['PGHOST','PGPORT','PGUSER','PGPASSWORD','PGDATABASE'];
export const shellQuote=v=>"'"+String(v).replaceAll("'","'\\''")+"'";
export function parseConnection(script,ref){
 insist(refPattern.test(ref),'REMOTE_REF_INVALID');
 const values={};
 for(const name of keys){
  const matches=[...script.matchAll(new RegExp('^export '+name+'=(.+)$','gm'))];
  insist(matches.length===1,'REMOTE_CONNECTION_FORMAT');
  try{values[name]=JSON.parse(matches[0][1]);}catch{throw Error('REMOTE_CONNECTION_FORMAT');}
  insist(typeof values[name]==='string'&&values[name].length>0&&values[name].length<4096&&!/[\0\r\n]/.test(values[name]),'REMOTE_CONNECTION_FORMAT');
 }
 const direct=values.PGHOST==='db.'+ref+'.supabase.co'&&['postgres','cli_login_postgres'].includes(values.PGUSER);
 const pooler=/^aws-[0-9]+-ap-northeast-2\.pooler\.supabase\.com$/.test(values.PGHOST)&&['postgres.'+ref,'cli_login_postgres.'+ref].includes(values.PGUSER);
 insist((direct||pooler)&&values.PGPORT==='5432'&&values.PGDATABASE==='postgres','REMOTE_CONNECTION_TARGET_REFUSED');
 return values;
}
export async function cliConnection(ref){
 const bytes=await run('npx',['supabase','db','dump','--project-ref',ref,'--linked','--dry-run'],{stage:'REMOTE_CLI_CONNECTION',limit:128*1024});
 // Official dry-run provides an ephemeral database connection; never read/extract the CLI access token.
 return parseConnection(bytes.toString(),ref);
}
export async function attestRecoveryProject(ref){
 insist(ref===recoveryRef&&ref!==productionRef,'REMOTE_RESTORE_TARGET_REFUSED');
 const raw=JSON.parse((await run('npx',['supabase','projects','list','--output','json'],{stage:'REMOTE_PROJECT_ATTESTATION',limit:256*1024})).toString());
 const project=(Array.isArray(raw)?raw:raw.projects)?.find(p=>(p.id??p.ref)===ref);
 insist(project?.name==='reptilelink-recovery-verification'&&project.organization_id==='gogttwftrpejsekuxjbq'&&project.region==='ap-northeast-2'&&project.status==='ACTIVE_HEALTHY','REMOTE_RESTORE_PROJECT_NOT_OWNED');
 return project;
}
const readConnection=keys.map(k=>'IFS= read -r '+k+'; export '+k+';').join(' ')+
 "export PGSSLMODE=verify-full PGSSLROOTCERT=/tmp/production-ca.crt PGCONNECT_TIMEOUT=10; ";
export class RemotePostgres{
 constructor(ref,{writable=false}={}){
  insist(refPattern.test(ref),'REMOTE_REF_INVALID');insist(!writable||ref===recoveryRef,'REMOTE_SOURCE_RESTORE_REFUSED');
  this.ref=ref;this.writable=writable;this.connection=undefined;this.id=randomUUID();this.name='reptilelink-remote-'+this.id;this.created=false;
 }
 async start(){
  if(this.writable)await attestRecoveryProject(this.ref);
  this.connection??=await cliConnection(this.ref);
  this.prefix=Buffer.from(keys.map(k=>this.connection[k]).join('\n')+'\n');
  // Explicitly cached image only. This container is a client, with no server, ports, volume or persistent credential environment.
  this.image=(await run('docker',['image','inspect',postgresImage,'--format','{{.Id}}'],{stage:'REMOTE_IMAGE',limit:4096})).toString().trim();
  insist(/^sha256:[a-f0-9]{64}$/.test(this.image),'REMOTE_IMAGE_INVALID');
  await run('docker',['run','--detach','--rm','--pull=never','--name',this.name,'--label','reptilelink.remote.uuid='+this.id,'--label','reptilelink.remote.ref='+this.ref,'--network','bridge','--read-only','--user','100:101','--memory','256m','--cpus','1','--pids-limit','64','--cap-drop','ALL','--security-opt','no-new-privileges','--tmpfs','/tmp:rw,nosuid,nodev,noexec,size=16m,uid=100,gid=101,mode=0700','--entrypoint','sleep',this.image,'900'],{stage:'REMOTE_CLIENT_START',limit:4096});this.created=true;await this.attest();
  const ca=fs.readFileSync(new URL('../supabase/certs/prod-ca-2021.crt',import.meta.url)),certificate=new X509Certificate(ca);
  insist(sha(ca)==='700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7'&&certificate.ca&&Date.parse(certificate.validTo)>Date.now(),'REMOTE_CA_INVALID');
  await run('docker',['exec','-i',this.name,'/bin/sh','-c','umask 077; cat > /tmp/production-ca.crt'],{input:ca,stage:'REMOTE_CA_INSTALL',limit:4096});
 }
 async attest(){
  const v=JSON.parse((await run('docker',['inspect',this.name],{stage:'REMOTE_CLIENT_INSPECT',limit:128*1024})).toString())[0];
  insist(v.Config.Labels?.['reptilelink.remote.uuid']===this.id&&v.Config.Labels?.['reptilelink.remote.ref']===this.ref&&v.Image===this.image&&v.HostConfig.ReadonlyRootfs===true&&v.HostConfig.NetworkMode==='bridge'&&!Object.keys(v.HostConfig.PortBindings??{}).length&&v.Mounts.every(m=>m.Type==='tmpfs')&&!(v.Config.Env??[]).some(e=>/^PG(PASSWORD|USER|HOST)=/.test(e)),'REMOTE_CLIENT_UNSAFE');
 }
 command(program,args){
  const options=this.writable?"export PGOPTIONS='-c statement_timeout=120000'; ":"export PGOPTIONS='-c default_transaction_read_only=on -c statement_timeout=120000'; ";
  return ['exec','-i',this.name,'/bin/sh','-c',readConnection+options+'exec '+[program,...args].map(shellQuote).join(' ')];
 }
 async execute(sql){
  insist(!this.session,'REMOTE_SNAPSHOT_ALREADY_OPEN');await this.attest();
  return run('docker',this.command('psql',['-X','-qAt','-U',this.connection.PGUSER,'-d','postgres','-v','ON_ERROR_STOP=1','-v','VERBOSITY=sqlstate']),{input:Buffer.concat([this.prefix,Buffer.from(sql)]),stage:'REMOTE_QUERY',timeout:120000});
 }
 async query(sql){try{return JSON.parse((await this.execute(sql)).toString());}catch(e){if(e.message.startsWith('REMOTE_'))throw e;throw Error('REMOTE_QUERY_RESULT_INVALID');}}
 async openSnapshot(){
  insist(!this.writable&&!this.session,'REMOTE_SNAPSHOT_UNSAFE');await this.attest();
  this.lines='';this.pending=[];this.closed=false;
  this.session=spawn('docker',this.command('psql',['-X','-qAt','-U',this.connection.PGUSER,'-d','postgres','-v','ON_ERROR_STOP=1','-v','VERBOSITY=sqlstate']),{stdio:['pipe','pipe','pipe']});
  this.session.stdout.on('data',b=>{this.lines+=b.toString();if(this.lines.length>32*1024*1024){this.fail();return;}let i;while((i=this.lines.indexOf('\n'))>=0){const line=this.lines.slice(0,i);this.lines=this.lines.slice(i+1);if(line)this.pending.shift()?.resolve(line);}});
  this.session.stderr.on('data',b=>{const s=b.toString();const code=s.match(/ERROR:\s+([0-9A-Z]{5})\b/)?.[1];if(code)this.failureCode=code;else if(/certificate|root certificate|SSL error/i.test(s))this.failureCode=/does not exist/.test(s)?'TLS_CA_FILE_MISSING':/self-signed certificate/.test(s)?'TLS_SELF_SIGNED':/certificate verify failed/.test(s)?'TLS_VERIFY_FAILED':/does not match host name/.test(s)?'TLS_HOSTNAME_MISMATCH':'TLS_CERTIFICATE';else if(/password authentication|authentication failed/i.test(s))this.failureCode='AUTHENTICATION';else if(/could not translate|could not connect|connection refused|Connection timed out/i.test(s))this.failureCode='CONNECTION';});this.session.on('error',()=>this.fail());this.session.on('close',()=>{this.closed=true;this.fail();});this.session.stdin.on('error',()=>this.fail());this.session.stdin.write(this.prefix);
  const first=await this.snapshotQuery("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET LOCAL idle_in_transaction_session_timeout='240s'; SET LOCAL ROLE postgres; SELECT json_build_object('snapshot',pg_export_snapshot());");
  insist(/^[0-9a-f-]+$/i.test(first.snapshot),'REMOTE_SNAPSHOT_INVALID');this.snapshot=first.snapshot;
 }
 fail(){for(const p of this.pending?.splice(0)??[])p.reject(Error('REMOTE_SNAPSHOT_FAILED'+(this.failureCode?'_'+this.failureCode:'')));}
 async snapshotQuery(sql){
  insist(this.session&&!this.closed,'REMOTE_SNAPSHOT_CLOSED');
  const line=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('REMOTE_SNAPSHOT_TIMEOUT')),120000);this.pending.push({resolve:v=>{clearTimeout(timer);resolve(v);},reject:e=>{clearTimeout(timer);reject(e);}});this.session.stdin.write(sql+'\n');});
  try{return JSON.parse(line);}catch{throw Error('REMOTE_SNAPSHOT_RESULT_INVALID');}
 }
 async dump(args){
  insist(this.snapshot&&!this.closed,'REMOTE_SNAPSHOT_REQUIRED');await this.attest();
  return run('docker',this.command('pg_dump',['--role=postgres','--snapshot='+this.snapshot,'--no-comments','--no-security-labels','--no-large-objects',...args]),{input:this.prefix,stage:'REMOTE_SNAPSHOT_DUMP',timeout:120000});
 }
 async close(){
  if(this.session&&!this.closed){this.session.stdin.end('ROLLBACK;\n\\q\n');await new Promise(resolve=>{const timer=setTimeout(()=>{this.session.kill('SIGTERM');resolve();},3000);this.session.once('close',()=>{clearTimeout(timer);resolve();});});}
  if(this.created){await this.attest();await run('docker',['rm','--force',this.name],{stage:'REMOTE_CLIENT_REMOVE',limit:4096});this.created=false;}
  this.connection=undefined;this.prefix=undefined;
 }
}
