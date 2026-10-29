import {parseArgs} from 'node:util';
import {localAdmin} from './local-utils.mjs';
const {values,positionals}=parseArgs({allowPositionals:true,options:{id:{type:'string'},decision:{type:'string'},request:{type:'string'},status:{type:'string'},after:{type:'string'},cursor:{type:'string'},actor:{type:'string'}}});
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
if(positionals.length!==1)throw new Error('Usage: npm run local:moderate -- list|resolve|prune [options]. See docs/22-comments-reports.md.');
const action=positionals[0],admin=localAdmin();let name,args;
if(action==='list'){
 if(Object.keys(values).some(k=>!['status','after','cursor'].includes(k))||!['open','resolved'].includes(values.status??'open')||Boolean(values.after)!==Boolean(values.cursor)||(values.cursor&&!uuid.test(values.cursor))||(values.after&&Number.isNaN(Date.parse(values.after))))throw new Error('list: --status open|resolved [--after ISO --cursor UUID]');
 name='admin_content_reports';args={p_status:values.status??'open',p_after:values.after??null,p_after_id:values.cursor??null};
}else if(action==='resolve'){
 if(Object.keys(values).some(k=>!['id','decision','request'].includes(k))||!uuid.test(values.id??'')||!uuid.test(values.request??'')||!['hide','dismiss'].includes(values.decision))throw new Error('resolve: --id REPORT_UUID --decision hide|dismiss --request UUID');
 name='admin_resolve_report';args={p_report_id:values.id,p_hide:values.decision==='hide',p_request_id:values.request};
}else if(action==='prune'){
 if(Object.keys(values).some(k=>k!=='actor')||(values.actor&&!uuid.test(values.actor)))throw new Error('prune: [--actor UUID]');
 name='prune_activity';args={p_actor:values.actor??null};
}else throw new Error('Unknown command. Use list, resolve or prune.');
const result=await admin.schema('api').rpc(name,args);if(result.error)throw new Error(result.error.message);console.log(JSON.stringify(result.data,null,2));
