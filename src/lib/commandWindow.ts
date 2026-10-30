import{likeRequestExpired}from'./likes';
type Clock={started:number;wallStarted:number};
// A captured command owns its clock; abandoning it releases both via weak reachability.
const clocks=new WeakMap<object,Clock>();
export function commandExpired(command:object,now=performance.now(),wallNow=Date.now()){
 const clock=clocks.get(command);return Boolean(clock&&likeRequestExpired(clock.started,now,clock.wallStarted,wallNow));
}
export function assertCommandFresh(command:object,now=performance.now(),wallNow=Date.now()){
 if(!clocks.has(command))clocks.set(command,{started:now,wallStarted:wallNow});
 if(commandExpired(command,now,wallNow))throw Error('COMMAND_TOO_OLD');
}
