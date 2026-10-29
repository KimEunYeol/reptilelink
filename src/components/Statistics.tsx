import{useEffect,useRef,useState}from'react';
import{rpc}from'../lib/supabase';
import{userMessage}from'../lib/domain';
import type{AnalyticsData}from'../lib/analytics';
const number=(value:number|null|undefined)=>value===null||value===undefined?'—':new Intl.NumberFormat('ko-KR').format(value);
function ViewsChart({rows}:{rows:{day:string;views:number|null}[]}){
 const known=rows.map((r,i)=>({...r,x:28+i*324/7,y:0})),high=Math.max(50,Math.ceil(Math.max(0,...rows.map(r=>r.views??0))/50)*50);for(const p of known)p.y=178-(p.views??0)*150/high;
 return <figure className="views-chart"><svg viewBox="0 0 378 208" role="img" aria-label="최근 8일 집계된 페이지 조회수. 수집 전 날짜에는 선과 점을 표시하지 않습니다.">
 {Array.from({length:11},(_,i)=>{const y=28+i*15;return <g key={i}><line x1="28" x2="352" y1={y} y2={y} stroke="#ededed"/><text x="21" y={y+3} textAnchor="end">{number(high-i*high/10)}</text></g>;})}
 {known.map((p,i)=>p.views!==null?<g key={p.day}>{i>0&&known[i-1].views!==null&&<line x1={known[i-1].x} y1={known[i-1].y} x2={p.x} y2={p.y} className="views-line"/>}<circle cx={p.x} cy={p.y} r="3" className="views-point"><title>{p.day}: {number(p.views)}회</title></circle></g>:null)}
 {known.map(p=><text key={p.day} x={p.x} y="200" textAnchor="middle" className="views-date">{p.day.slice(5).replace('-','.')}</text>)}</svg><figcaption className="comment-hint">집계된 페이지 조회수 · 사람 수와 다릅니다. —는 수집 전 이력입니다.</figcaption><table className="sr-only"><caption>최근 8일 페이지 조회수</caption><thead><tr><th>날짜</th><th>집계된 조회수</th></tr></thead><tbody>{rows.map(row=><tr key={row.day}><td>{row.day}</td><td>{row.views===null?'수집 전':`${number(row.views)}회`}</td></tr>)}</tbody></table></figure>;
}
export function Statistics({locked}:{locked:boolean}){
 const[data,setData]=useState<AnalyticsData|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');const active=useRef(true),sending=useRef(false);
 async function load(){if(sending.current)return;sending.current=true;setBusy(true);setError('');try{const next=await rpc<AnalyticsData>('my_analytics');if(active.current)setData(next);}catch(e){if(active.current)setError(userMessage(e));}finally{sending.current=false;if(active.current)setBusy(false);}}
 useEffect(()=>{active.current=true;void load();return()=>{active.current=false;};},[]);
 return <section className="activity-statistics" aria-label="페이지 조회수">{data?.available?<><div className="views-metrics"><p>오늘 조회수 <strong>{number(data.today)}</strong></p><p>어제 조회수 <strong>{number(data.yesterday)}</strong></p><p>누적 조회수 <strong>{number(data.total)}</strong></p></div><ViewsChart rows={data.chart??[]}/><p className="comment-hint">최근 7일 {number(data.week)}회 · 최근 30일 {number(data.month)}회</p>{data.started_at&&<p className="comment-hint">수집 시작: {new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(data.started_at))}</p>}{(!data.collecting||data.limited)&&<p className="comment-hint" role="status">{!data.collecting?'현재 조회수 수집이 중지되어 있습니다.':'오늘 수집 한도에 도달했습니다.'}</p>}<p className="comment-hint">탭 세션·수집 중단·한도·봇 등에 따라 실제 조회와 다를 수 있는 참고 지표입니다.</p></>:data&&<p className="comment-hint">조회수 수집 설정을 확인한 뒤 통계를 표시합니다.</p>}{busy&&<p className="comment-hint" role="status">조회수를 확인하고 있습니다.</p>}{error&&<p className="notice" role="alert">{error}{data?' 마지막 확인된 통계를 표시합니다.':''}</p>}<button type="button" className="text-button activity-refresh" disabled={locked||busy} onClick={()=>void load()}>조회수 새로 확인</button></section>;
}
