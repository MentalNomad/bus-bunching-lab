// Whole-stop groups prevent a sliding window from slicing through a boarding /
// debarking batch. Raw individual observations always keep their real times.
export function chartData(data,now,windowSize=20,mode='batch'){
  const from=Math.max(0,now-3600),raw=data.filter(p=>p.t>=from&&p.t<=now),recent=data.filter(p=>p.t>=Math.max(0,now-60)&&p.t<=now);
  const groups=[];
  if(mode==='batch'){
    const byKey=new Map();for(const p of data){if(p.commitT===undefined||p.commitT>now)continue;const key=`${p.commitT}:${p.bus??0}`;if(!byKey.has(key))byKey.set(key,{t:p.commitT,values:[]});byKey.get(key).values.push(p.v);}groups.push(...byKey.values());groups.sort((a,b)=>a.t-b.t);
  }else for(const p of data)if(p.t<=now)groups.push({t:p.t,values:[p.v]});
  const queue=[],averages=[];let sum=0,count=0;for(const g of groups){queue.push(g);for(const v of g.values){sum+=v;count++;}while(queue.length>1&&count-queue[0].values.length>=windowSize){const old=queue.shift();for(const v of old.values){sum-=v;count--;}}averages.push({t:g.t,v:sum/count,count});}
  const last=averages.at(-1),visible=averages.filter(p=>p.t>=from),carry=averages.findLast(p=>p.t<from);if(carry)visible.unshift({...carry,t:from});return {raw,averages:visible,low:recent.length?recent.reduce((m,p)=>Math.min(m,p.v),Infinity):null,high:recent.length?recent.reduce((m,p)=>Math.max(m,p.v),0):null,recentCount:recent.length,average:last?.v??null,averageTime:last?.t??null,averageCount:last?.count??0};
}
export function sharedScale(datasets,now,windowSize=20,mode='batch',fixed=0){
  if(Number.isFinite(fixed)&&fixed>0)return fixed;let max=10;for(const data of datasets){const view=chartData(data,now,windowSize,mode);for(const p of data)max=Math.max(max,p.v);for(const p of view.averages)max=Math.max(max,p.v);}return Math.ceil((max*1.1-1e-9)/10)*10;
}
