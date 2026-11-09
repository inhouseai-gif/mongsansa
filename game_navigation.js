// 0.5m A*, no diagonal corner cutting, followed by collision-checked string pulling.
export function createNavigator(world) {
  const step=.5, radius=.29, b=world.bounds, w=Math.round((b.maxX-b.minX)/step)+1, h=Math.round((b.maxZ-b.minZ)/step)+1;
  const point=i=>({x:b.minX+(i%w)*step,z:b.minZ+Math.floor(i/w)*step});
  const index=(x,z)=>Math.max(0,Math.min(h-1,Math.round((z-b.minZ)/step)))*w+Math.max(0,Math.min(w-1,Math.round((x-b.minX)/step)));
  const free=(x,z)=>!world.blocked(x,z,radius);
  const len=(x,z)=>Math.sqrt(x*x+z*z); // sqrt는 모든 엔진에서 같은 값(hypot은 엔진마다 끝자리가 달라 고양이 길이 갈릴 수 있다)
  function clear(a,c) {const d=len(c.x-a.x,c.z-a.z),n=Math.max(1,Math.ceil(d/.2));for(let j=0;j<=n;j++)if(!free(a.x+(c.x-a.x)*j/n,a.z+(c.z-a.z)*j/n))return false;return true;}
  function nearest(p) {if(free(p.x,p.z))return p;for(let r=.5;r<=3;r+=.5)for(let k=0;k<24;k++){const a=k*Math.PI/12,q={x:p.x+Math.cos(a)*r,z:p.z+Math.sin(a)*r};if(free(q.x,q.z))return q;}return null;}
  function gridAnchor(p){const base=index(p.x,p.z),bx=base%w,bz=Math.floor(base/w);for(let r=0;r<=5;r++){const options=[];for(let dz=-r;dz<=r;dz++)for(let dx=-r;dx<=r;dx++){const x=bx+dx,z=bz+dz;if(x<0||x>=w||z<0||z>=h||Math.max(Math.abs(dx),Math.abs(dz))!==r)continue;const i=z*w+x,q=point(i);if(free(q.x,q.z)&&clear(p,q))options.push({i,d:len(q.x-p.x,q.z-p.z)});}if(options.length)return options.sort((a,b)=>a.d-b.d)[0].i;}return -1;}
  function path(from,to) {
    const target=nearest(to),origin=nearest(from);if(!target||!origin)return [];
    if(clear(origin,target))return [target];
    const start=gridAnchor(origin),end=gridAnchor(target);if(start<0||end<0)return [];
    const cost=new Float32Array(w*h).fill(Infinity),parent=new Int32Array(w*h).fill(-1),closed=new Uint8Array(w*h),heap=[];
    const pass=new Int8Array(w*h);const valid=i=>{if(i<0||i>=w*h)return false;if(!pass[i]){const p=point(i);pass[i]=free(p.x,p.z)?1:-1;}return pass[i]===1;};
    const heuristic=i=>len(i%w-end%w,Math.floor(i/w)-Math.floor(end/w));
    const push=(i,f)=>{let j=heap.length;heap.push({i,f});while(j){const k=(j-1)>>1;if(heap[k].f<=f)break;[heap[k],heap[j]]=[heap[j],heap[k]];j=k;}};
    const pop=()=>{const a=heap[0],last=heap.pop();if(heap.length){heap[0]=last;let j=0;for(;;){let k=j*2+1;if(k>=heap.length)break;if(k+1<heap.length&&heap[k+1].f<heap[k].f)k++;if(heap[j].f<=heap[k].f)break;[heap[j],heap[k]]=[heap[k],heap[j]];j=k;}}return a.i;};
    cost[start]=0;push(start,heuristic(start));let found=false;
    while(heap.length){const i=pop();if(closed[i])continue;if(i===end){found=true;break;}closed[i]=1;const x=i%w,z=Math.floor(i/w);
      for(let dz=-1;dz<=1;dz++)for(let dx=-1;dx<=1;dx++){if(!dx&&!dz)continue;const nx=x+dx,nz=z+dz,j=nz*w+nx;if(nx<0||nx>=w||nz<0||nz>=h||closed[j]||!valid(j))continue;if(dx&&dz&&(!valid(i+dx)||!valid(i+dz*w)))continue;const g=cost[i]+(dx&&dz?Math.SQRT2:1);if(g<cost[j]){cost[j]=g;parent[j]=i;push(j,g+heuristic(j));}}
    }
    if(!found)return [];
    const raw=[target];for(let i=end;i!==start&&i!==-1;i=parent[i])raw.push(point(i));raw.push(point(start),origin);raw.reverse();
    const result=[];let anchor=0;while(anchor<raw.length-1){let next=anchor+1;for(let j=next+1;j<raw.length;j++){if(clear(raw[anchor],raw[j]))next=j;else break;}result.push(raw[next]);anchor=next;}return result;
  }
  function slide(p,dx,dz) {const n=Math.max(1,Math.ceil(len(dx,dz)/.18));for(let i=0;i<n;i++){const x=dx/n,z=dz/n;if(free(p.x+x,p.z+z)){p.x+=x;p.z+=z;}else{if(free(p.x+x,p.z))p.x+=x;if(free(p.x,p.z+z))p.z+=z;}}return p;}
  return {path,slide,clear,nearest};
}

// First fraction t in (0,1] where the camera segment a→b enters a blocker's volume (bottom..top, bottom defaults to the ground); 1 = clear.
// A segment that starts inside a blocker (player in a building, beside the pagoda) ignores that one; the cutaway handles insides.
// shortcut: axis-aligned boxes and the pagoda cylinder only; trees, gates and low walls never pull the camera in — add them here if they hide the player.
export function cameraHit(blockers,a,b) {
  const dx=b.x-a.x,dy=b.y-a.y,dz=b.z-a.z;let best=1;
  // Narrow the range t to where p+d·t stays within [lo,hi]; null = never.
  const slab=(p,d,lo,hi,t)=>{if(Math.abs(d)<1e-9)return p<lo||p>hi?null:t;let u=(lo-p)/d,v=(hi-p)/d;if(u>v)[u,v]=[v,u];return [Math.max(t[0],u),Math.min(t[1],v)];};
  for(const o of blockers){let t=slab(a.y,dy,o.bottom??-Infinity,o.top,[0,1]);if(!t)continue;
    if(o.type==='circle'){const fx=a.x-o.x,fz=a.z-o.z,A=dx*dx+dz*dz,B=2*(fx*dx+fz*dz),C=fx*fx+fz*fz-o.r*o.r;
      if(A<1e-9){if(C>0)continue;}else{const D=B*B-4*A*C;if(D<=0)continue;const s=Math.sqrt(D);t=[Math.max(t[0],(-B-s)/(2*A)),Math.min(t[1],(-B+s)/(2*A))];}}
    else{t=slab(a.x,dx,o.x-o.hw,o.x+o.hw,t);if(t)t=slab(a.z,dz,o.z-o.hd,o.z+o.hd,t);if(!t)continue;}
    if(t[0]>0&&t[0]<=t[1]&&t[0]<best)best=t[0];}
  return best;
}
