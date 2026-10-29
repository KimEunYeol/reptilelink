export function supportAddress(value:unknown):string|null{
 if(typeof value!=='string'||value.length>254||!/^[-a-zA-Z0-9._+]+@[-a-zA-Z0-9.]+\.[a-zA-Z]{2,63}$/.test(value))return null;
 const [local,domain]=value.split('@');if(local.length>64||local.startsWith('.')||local.endsWith('.')||local.includes('..')||!domain.split('.').every(label=>/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(label)))return null;return value;
}
export function supportDraft(address:unknown,name:string,email:string,body:string):string|null{
 const to=supportAddress(address),reply=supportAddress(email.trim()),who=name.trim(),text=body.trim();
 if(!to||!reply||!who||[...who].length>40||/[\u0000-\u001f\u007f]/.test(who)||!text||[...text].length>2000||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text))return null;
 const href=`mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(`[렙타일링크 문의] ${who}`)}&body=${encodeURIComponent(`렙타일링크 아이디: ${who}\n회신 이메일: ${reply}\n\n${text}`)}`;
 return href.length<=8000?href:null;
}
