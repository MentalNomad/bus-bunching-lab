/* Discrete-event model. Times are seconds; unlimited capacity; FIFO queues. */
export class Simulation {
  constructor(config={}) {
    this.c={stops:12,travel:40,buses:4,rate:3,arrival:'fixed',board:2,debark:1,ride:4,rideMode:'fixed',seed:42,...config};
    const c=this.c;
    for(const [key,min,max] of [['stops',3,40],['travel',1,600],['buses',1,16],['rate',0,60],['board',0,30],['debark',0,30],['ride',1,c.stops-1],['seed',1,2147483647]]) if(!Number.isFinite(c[key])||c[key]<min||c[key]>max) throw Error(`Invalid ${key}`);
    for(const k of ['stops','buses','ride','seed']) if(!Number.isInteger(c[k]))throw Error(`${k} must be an integer`);
    if(!['fixed','poisson'].includes(c.arrival)||!['fixed','random'].includes(c.rideMode))throw Error('Invalid distribution');
    this.time=0;this.randomState=c.seed;this.created=0;this.completed=0;this.transfers=0;this.waitSum=0;this.systemSum=0;this.series=[];this.completedPassengers=[];this.log=[];
    this.stops=Array.from({length:c.stops},(_,id)=>({id,queue:[],next:c.rate?this.interval():Infinity}));
    this.buses=Array.from({length:c.buses},(_,id)=>{const pos=id*c.stops/c.buses;const from=Math.floor(pos);return {id,pos,from,target:(from+1)%c.stops,phase:'travel',start:0,due:(1-(pos-from))*c.travel,origin:pos,load:[],dwell:[],wait:[],holdUntil:0,pendingHold:0,express:0,pendingExpress:0,pendingSlow:1,stopStart:0,service:null,alight:[],visits:0};});
  }
  random(){this.randomState=(Math.imul(1664525,this.randomState)+1013904223)>>>0;return (this.randomState+.5)/4294967296;}
  interval(){return this.c.arrival==='fixed'?60/this.c.rate:-Math.log(1-this.random())*60/this.c.rate;}
  note(message){this.log.unshift({t:this.time,message});this.log=this.log.slice(0,60);}
  action(id,type,value){const b=this.buses[id];if(!b)throw Error('Choose a bus');if(!Number.isFinite(value)||value<=0)throw Error('Enter a positive value');
    if(type==='hold'){if(value>3600)throw Error('Maximum hold is 3,600 seconds');if(b.phase==='travel') b.pendingHold+=value;else {b.holdUntil=Math.max(this.time,b.holdUntil)+value;if(b.phase==='hold')b.due=b.holdUntil;}this.note(`Bus ${id+1}: hold ${value}s ${b.phase==='travel'?'at next stop':'at this stop'}.`);}
    else if(type==='slow'){if(value<1||value>10)throw Error('Slowdown must be 1–10×');if(b.phase==='travel'){const pos=this.position(b);b.due=this.time+(b.due-this.time)*value;b.origin=pos;b.start=this.time;}else b.pendingSlow=value;this.note(`Bus ${id+1}: ${value}× travel time on ${b.phase==='travel'?'current':'next'} segment.`);}
    else if(type==='express'){if(!Number.isInteger(value)||value>=this.c.stops)throw Error('Skip 1 to number of stops minus 1');b.recoveryExpress=false;b.pendingExpress=value;this.note(`Bus ${id+1}: temporary express past ${value} stops after ${b.phase==='travel'?'next':'current'} stop.`);if(b.phase==='hold'){this.prepareExpress(b);b.phase='service';b.due=this.time;}}
    else if(type==='recovery'){b.recoveryExpress=true;b.pendingExpress=1;this.note(`Bus ${id+1}: alternating express until forward gap recovers to ${(this.c.stops/this.c.buses).toFixed(1)} stops.`);if(b.phase==='hold'){this.prepareExpress(b);b.phase='service';b.due=this.time;}}
    else throw Error('Unknown action');
  }
  position(b){if(b.phase!=='travel')return b.target;const distance=((b.target-b.origin+this.c.stops)%this.c.stops)||this.c.stops;return (b.origin+distance*Math.min(1,(this.time-b.start)/(b.due-b.start)))%this.c.stops;}
  prepareExpress(b){if(!b.pendingExpress)return;b.express=b.pendingExpress;b.pendingExpress=0;const skip=new Set(Array.from({length:b.express},(_,i)=>(b.target+i+1)%this.c.stops));for(const p of b.load)if(skip.has(p.dest)&&!b.alight.includes(p)&&!(b.service?.kind==='off'&&b.service.p===p))b.alight.push(p);}
  forwardGap(b){let gap=this.c.stops;const p=this.position(b);for(const other of this.buses)if(other!==b)gap=Math.min(gap,(this.position(other)-p+this.c.stops)%this.c.stops);return gap;}
  arrive(b){if(b.recoveryExpress&&this.forwardGap(b)<=this.c.stops/this.c.buses){b.recoveryExpress=false;b.express=0;b.pendingExpress=0;this.note(`Bus ${b.id+1}: forward gap recovered; normal service resumes.`);}if(b.express>0){b.express--;this.depart(b);return;}b.phase='service';b.stopStart=this.time;b.waitStart=b.wait.length;b.systemStart=this.series.length;b.holdUntil=this.time+b.pendingHold;b.pendingHold=0;b.alight=b.load.filter(p=>p.dest===b.target);if(b.recoveryExpress)b.pendingExpress=1;this.prepareExpress(b);b.due=this.time;}
  depart(b){if(b.phase!=='travel'){for(let i=b.waitStart??0;i<b.wait.length;i++)b.wait[i].commitT=this.time;for(let i=b.systemStart??0;i<this.series.length;i++)if(this.series[i].bus===b.id&&this.series[i].commitT===undefined)this.series[i].commitT=this.time;b.dwell.push({t:this.time,v:this.time-b.stopStart,stop:b.target,commitT:this.time});b.visits++;}b.from=b.target;b.origin=b.target;b.target=(b.target+1)%this.c.stops;b.start=this.time;b.due=this.time+this.c.travel*b.pendingSlow;b.pendingSlow=1;b.phase='travel';}
  finishService(b){const task=b.service;if(!task)return;b.service=null;const p=task.p;
    if(task.kind==='off'){b.load.splice(b.load.indexOf(p),1);if(p.dest===b.target){this.completed++;this.waitSum+=p.wait;this.systemSum+=this.time-p.born;const r={t:this.time,v:this.time-p.born,wait:p.wait,id:p.id,bus:b.id};this.series.push(r);this.completedPassengers.push(r);}else {p.queued=this.time;this.stops[b.target].queue.push(p);this.transfers++;}}
    else {p.wait+=task.start-p.queued;b.wait.push({t:task.start,v:p.wait,id:p.id,stop:b.target});b.load.push(p);}
  }
  service(b){this.finishService(b);this.prepareExpress(b);const stop=this.stops[b.target];if(b.alight.length){b.service={kind:'off',p:b.alight.shift(),start:this.time};b.due=this.time+this.c.debark;return;}
    const index=stop.queue.findIndex(p=>!Array.from({length:b.express},(_,i)=>(b.target+i+1)%this.c.stops).includes(p.dest));
    if(index>=0){b.service={kind:'on',p:stop.queue.splice(index,1)[0],start:this.time};b.due=this.time+this.c.board;return;}
    if(this.time<b.holdUntil){b.phase='hold';b.due=b.holdUntil;}else this.depart(b);
  }
  advance(seconds){if(!Number.isFinite(seconds)||seconds<0)throw Error('Invalid time');const end=this.time+seconds;let count=0;
    while(true){let next=end+1;let stop=null,bus=null;for(const s of this.stops)if(s.next<next){next=s.next;stop=s;bus=null;}for(const b of this.buses)if(b.due<next){next=b.due;bus=b;stop=null;}if(next>end)break;if(++count>2000000)throw Error('Too many events; reduce demand');this.time=next;
      if(stop){let ride=this.c.ride;if(this.c.rideMode==='random')ride=1+Math.floor(this.random()*(Math.min(this.c.stops-1,2*this.c.ride-1)));stop.queue.push({id:++this.created,born:this.time,queued:this.time,wait:0,dest:(stop.id+ride)%this.c.stops});stop.next=this.time+this.interval();for(const b of this.buses)if(b.phase==='hold'&&b.target===stop.id){b.phase='service';b.due=this.time;}}
      else if(bus.phase==='travel')this.arrive(bus);else {bus.phase='service';this.service(bus);}
    }this.time=end;
  }
  summary(){const waiting=this.stops.reduce((s,x)=>s+x.queue.length,0);const onboard=this.buses.reduce((s,b)=>s+b.load.length+(b.service?.kind==='on'?1:0),0);const positions=this.buses.map(b=>this.position(b)).sort((a,b)=>a-b);const gaps=positions.map((p,i)=>i===positions.length-1?positions[0]+this.c.stops-p:positions[i+1]-p);if(gaps.length===1)gaps[0]=this.c.stops;const mean=this.c.stops/this.c.buses;return {time:this.time,created:this.created,completed:this.completed,waiting,onboard,transfers:this.transfers,meanWait:this.completed?this.waitSum/this.completed:0,meanSystem:this.completed?this.systemSum/this.completed:0,gapCV:Math.sqrt(gaps.reduce((s,g)=>s+(g-mean)**2,0)/gaps.length)/mean};}
}
