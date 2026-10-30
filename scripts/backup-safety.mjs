import fs from'node:fs';
import{spawnSync}from'node:child_process';
import path from'node:path';
import{fileURLToPath}from'node:url';
import{createCipheriv,createDecipheriv,createHash,randomBytes,randomUUID}from'node:crypto';
import{gzipSync,gunzipSync}from'node:zlib';
export const repoRoot=fs.realpathSync(fileURLToPath(new URL('../',import.meta.url)));
export const defaultBackupRoot=path.resolve(repoRoot,'../.reptilelink-backups');
export const defaultKeyRoot=path.resolve(repoRoot,'../.reptilelink-backup-keys');
export const maxPayload=512*1024*1024,maxArchive=maxPayload+1024*1024,retentionMs=7*86400000,journalMaxAge=15*60000;
export const uuidPattern=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export const sha=value=>createHash('sha256').update(value).digest('hex');
export function insist(value,code){if(!value)throw Error(code);}
const magic={backup:Buffer.from('RLNKb001'),journal:Buffer.from('RLNKj001')};
export function encrypt(value,key,kind){
 insist(Buffer.isBuffer(key)&&key.length===32&&magic[kind],'BACKUP_KEY_OR_KIND_INVALID');
 let plain,compressed;
 try{plain=Buffer.from(JSON.stringify(value));insist(plain.length<=maxPayload,'BACKUP_PAYLOAD_TOO_LARGE');compressed=gzipSync(plain);}
 catch(e){if(e.message==='BACKUP_PAYLOAD_TOO_LARGE')throw e;throw Error('BACKUP_SERIALIZATION_FAILED');}
 const nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,nonce,{authTagLength:16});cipher.setAAD(magic[kind]);
 const encrypted=Buffer.concat([cipher.update(compressed),cipher.final()]);
 const result=Buffer.concat([magic[kind],nonce,cipher.getAuthTag(),encrypted]);insist(result.length<=maxArchive,'BACKUP_ARCHIVE_TOO_LARGE');return result;
}
export function decrypt(bytes,key,kind){
 insist(Buffer.isBuffer(key)&&key.length===32&&magic[kind],'BACKUP_KEY_OR_KIND_INVALID');
 insist(Buffer.isBuffer(bytes)&&bytes.length>36&&bytes.length<=maxArchive&&bytes.subarray(0,8).equals(magic[kind]),'BACKUP_FORMAT_INVALID');
 let authenticated;
 try{const decipher=createDecipheriv('aes-256-gcm',key,bytes.subarray(8,20),{authTagLength:16});decipher.setAAD(magic[kind]);decipher.setAuthTag(bytes.subarray(20,36));authenticated=Buffer.concat([decipher.update(bytes.subarray(36)),decipher.final()]);}
 catch{throw Error('BACKUP_AUTHENTICATION_FAILED');}
 // No decompression, JSON interpretation or restore SQL before the authentication tag succeeds.
 try{return JSON.parse(gunzipSync(authenticated,{maxOutputLength:maxPayload}).toString('utf8'));}
 catch{throw Error('BACKUP_PAYLOAD_INVALID');}
}
function outsideRepo(p){const relative=path.relative(repoRoot,p);return relative.startsWith('..'+path.sep)||path.isAbsolute(relative);}
function noSymlinks(p){let current=path.parse(p).root;for(const part of p.slice(current.length).split(path.sep).filter(Boolean)){current=path.join(current,part);if(fs.existsSync(current)||fs.lstatSync(path.dirname(current)).isDirectory()){let st;try{st=fs.lstatSync(current);}catch(e){if(e.code==='ENOENT')return;throw Error('BACKUP_PATH_INVALID');}insist(!st.isSymbolicLink(),'BACKUP_SYMLINK_REFUSED');}}}
export function privateDirectory(p,{create=false,kind='archives'}={}){
 p=path.resolve(p);insist(outsideRepo(p)&&p!==path.parse(p).root,'BACKUP_PATH_INSIDE_PROJECT');noSymlinks(p);
 if(!fs.existsSync(p)){insist(create,'BACKUP_DIRECTORY_MISSING');fs.mkdirSync(p,{recursive:true,mode:0o700});}
 noSymlinks(p);insist(spawnSync('git',['-C',p,'rev-parse','--is-inside-work-tree'],{stdio:'ignore'}).status!==0,'BACKUP_PATH_INSIDE_GIT');const st=fs.lstatSync(p);insist(st.isDirectory()&&st.uid===process.getuid()&&(st.mode&0o777)===0o700,'BACKUP_DIRECTORY_NOT_PRIVATE');
 const markerPath=path.join(p,'.reptilelink-owner.json');let marker;
 if(!fs.existsSync(markerPath)){
  insist(create&&fs.readdirSync(p).length===0,'BACKUP_DIRECTORY_NOT_OWNED');marker={format:'reptilelink-private-v1',kind,id:randomUUID()};writePrivate(markerPath,Buffer.from(JSON.stringify(marker)+'\n'));writePrivate(path.join(p,'.gitignore'),Buffer.from('*\n'));
 }else{try{marker=JSON.parse(readPrivate(markerPath,4096).toString());}catch{throw Error('BACKUP_OWNER_INVALID');}}
 insist(marker.format==='reptilelink-private-v1'&&marker.kind===kind&&uuidPattern.test(marker.id),'BACKUP_OWNER_INVALID');return{path:p,id:marker.id};
}
export function writePrivate(p,bytes){
 insist(Buffer.isBuffer(bytes)&&bytes.length<=maxArchive,'BACKUP_FILE_TOO_LARGE');let fd;
 try{fd=fs.openSync(p,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}
 catch{throw Error('BACKUP_PRIVATE_WRITE_FAILED');}finally{if(fd!==undefined)fs.closeSync(fd);}
}
export function readPrivate(p,limit=maxArchive){
 p=path.resolve(p);insist(outsideRepo(p),'BACKUP_PATH_INSIDE_PROJECT');noSymlinks(p);let fd;
 try{fd=fs.openSync(p,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);const st=fs.fstatSync(fd);insist(st.isFile()&&st.uid===process.getuid()&&(st.mode&0o777)===0o600&&st.nlink===1&&st.size<=limit,'BACKUP_FILE_NOT_PRIVATE');return fs.readFileSync(fd);}
 catch(e){if(e.message==='BACKUP_FILE_NOT_PRIVATE')throw e;throw Error('BACKUP_PRIVATE_READ_FAILED');}finally{if(fd!==undefined)fs.closeSync(fd);}
}
export function loadKey(keyRoot=defaultKeyRoot,{create=false}={}){
 const directory=privateDirectory(keyRoot,{create,kind:'keys'}),p=path.join(directory.path,'backup-v1.key');
 if(!fs.existsSync(p)){insist(create,'BACKUP_KEY_MISSING');writePrivate(p,randomBytes(32));}
 const key=readPrivate(p,32);insist(key.length===32,'BACKUP_KEY_INVALID');return{key,directory};
}
export function backupStore(backupRoot=defaultBackupRoot,keyRoot=defaultKeyRoot,{create=false}={}){
 const a=path.relative(path.resolve(backupRoot),path.resolve(keyRoot)),b=path.relative(path.resolve(keyRoot),path.resolve(backupRoot));
 insist(a.startsWith('..'+path.sep)&&b.startsWith('..'+path.sep),'BACKUP_KEY_MUST_BE_SEPARATE');
 const store=privateDirectory(backupRoot,{create,kind:'archives'});insist(!fs.readdirSync(store.path).some(n=>/\.(rlbk|rljr)$/.test(n))||fs.existsSync(path.join(path.resolve(keyRoot),'backup-v1.key')),'BACKUP_EXISTING_ARCHIVES_KEY_MISSING');const loaded=loadKey(keyRoot,{create});return{store,...loaded};
}
export function readEnvelope(p,key,kind){const value=decrypt(readPrivate(p),key,kind);insist(value?.format==='reptilelink-backup-v1'&&value.kind===kind&&uuidPattern.test(value.id)&&uuidPattern.test(value.ownerId)&&Number.isFinite(Date.parse(value.createdAt)),'BACKUP_METADATA_INVALID');return value;}
export function pruneOwned(store,key,now=Date.now()){
 let removed=0,retained=0;
 for(const name of fs.readdirSync(store.path)){
  const match=name.match(/^([a-f0-9-]{36})\.(rlbk|rljr)$/);if(!match)continue;
  const p=path.join(store.path,name);let value;
  try{value=readEnvelope(p,key,match[2]==='rlbk'?'backup':'journal');}catch{retained++;continue;}
  if(value.id!==match[1]||value.ownerId!==store.id||Date.parse(value.createdAt)>now+60000){retained++;continue;}
  if(Date.parse(value.createdAt)<now-retentionMs){fs.unlinkSync(p);removed++;}
 }
 return{removed,unverifiedRetained:retained};
}

export function publishPrivate(p,bytes){
 const temporary=path.join(path.dirname(p),'.partial-'+randomUUID());
 try{writePrivate(temporary,bytes);fs.linkSync(temporary,p);fs.unlinkSync(temporary);const fd=fs.openSync(path.dirname(p),fs.constants.O_RDONLY|fs.constants.O_DIRECTORY);try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
 catch{if(fs.existsSync(temporary))fs.unlinkSync(temporary);throw Error('BACKUP_ATOMIC_PUBLISH_FAILED');}
}
