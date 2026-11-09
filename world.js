import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createBuddha } from './buddha.js?v=d3fa739a8e';

// Coordinates and public API: INTERFACES.md §0–3.1. All scenery is procedural.
export const BOUNDS = Object.freeze({ minX: -44, maxX: 36, minZ: -42, maxZ: 62 });
export const VEST_COLORS = ['#e59a52','#e8c95a','#5a7fb0','#9cc06a','#e79aa6','#9a86c0'];
export const LANTERN_PLAIN = '#eab3a8';
export const LANTERN_COLORS = ['#c8323a', '#e9b949', '#2f8f86', '#f1e6c8', '#2e4f8f'];
export const SKY_PRESET_HOURS = { dawn: 5.8, day: 13, dusk: 17.8, night: 21.5 };
const PI = Math.PI, TAU = PI * 2, clamp = THREE.MathUtils.clamp, lerp = THREE.MathUtils.lerp;
const LEAVES = [[-16.5,15.5],[-14.5,1.5],[-17.5,-2],[-2.5,16],[0,9],[-1.5,-2],[6,10],[-12.5,-.5]];
const C = { wood:'#8b3f2c', dark:'#3a3430', pine:'#8a5a3c', plaster:'#efe6d2', green:'#3f7d6b', blue:'#2f5d7c', red:'#b4523a', tile:'#4a5058', gold:'#c4ac79', stone:'#a39e8d', floor:'#977552' };
const inside = (x,z,a,b,c,d) => x >= a && x <= b && z >= c && z <= d;
const riverX = z => -35 + 1.2 * Math.sin(.09*z);
function pondRadius(a) { return 1 + .055*Math.sin(3*a+.6) + .025*Math.cos(5*a); }
function inPond(x,z,pad=0) {
  const dx=(x+23)/(5.65+pad), dz=(z+20)/(4.15+pad), a=Math.atan2(dz,dx);
  return dx*dx+dz*dz < pondRadius(a)**2;
}
function groundHeight(x,z) {
  // All routes and architectural pads are level; only distant woodland undulates.
  const edge=Math.max(0,Math.abs(x+4)-29, -z-34, z-59);
  return Math.min(1.6,edge*.055)*(1+.22*Math.sin(x*.24)*Math.cos(z*.19));
}
export async function buildWorld({scene, renderer, camera, quality='high', onProgress=()=>{}}) {
  const high=quality!=='low', root=new THREE.Group(); root.name='몽산사 세계'; scene.add(root);
  const pickRoot=new THREE.Group(); pickRoot.name='세계 상호작용'; root.add(pickRoot);
  const parts=new Map(), ownedGeometry=new Set(), ownedMaterials=new Set(), ownedTextures=new Set();
  const scratch=new THREE.Object3D(), color=new THREE.Color(), matrix=new THREE.Matrix4();
  let seed=87021;
  const rnd=()=>{ seed=(Math.imul(seed,1664525)+1013904223)>>>0; return seed/4294967296; };
  const stage=async(f,label)=>{onProgress(f,label); await new Promise(requestAnimationFrame);};
  const material=(opts={})=>{const m=new THREE.MeshStandardMaterial({color:0xffffff,roughness:.88,flatShading:true,vertexColors:true,...opts});ownedMaterials.add(m);return m;};
  const solid=material(), metal=material({metalness:.55,roughness:.42});
  const glow=material({emissive:'#ffd69b',emissiveIntensity:.12});
  const lanternMat=material({emissive:'#ffe0bf',emissiveIntensity:.1,roughness:.65,side:THREE.DoubleSide});
  const windowMat=material({emissive:'#ffcb80',emissiveIntensity:.1});
  const flameMat=new THREE.MeshBasicMaterial({color:'#ffda8e',vertexColors:true}); ownedMaterials.add(flameMat);
  const templates={box:new THREE.BoxGeometry(1,1,1), sphere:high?new THREE.IcosahedronGeometry(1,0):new THREE.OctahedronGeometry(1,0), pebble:new THREE.OctahedronGeometry(1,0),
    cylinder:new THREE.CylinderGeometry(1,1,1,high?8:6), cone:new THREE.ConeGeometry(1,1,6),
    disk:new THREE.CylinderGeometry(1,1,1,8), rod:new THREE.CylinderGeometry(1,1,1,4,1,true), reed:new THREE.CylinderGeometry(1,1,1,4,1,true), trunk:new THREE.CylinderGeometry(1,1,1,6,1,true)};
  Object.values(templates).forEach(g=>ownedGeometry.add(g));
  function geometry(g, tint, position=[0,0,0], scale=[1,1,1], rotation=[0,0,0]) {
    const b=g.index?g.toNonIndexed():g.clone(); b.deleteAttribute('uv');
    scratch.position.set(...position); scratch.scale.set(...scale); scratch.rotation.set(...rotation); scratch.updateMatrix(); b.applyMatrix4(scratch.matrix);
    const n=b.attributes.position.count, a=new Float32Array(n*3); color.set(tint);
    for(let j=0;j<n;j++){a[j*3]=color.r;a[j*3+1]=color.g;a[j*3+2]=color.b;}
    b.setAttribute('color',new THREE.BufferAttribute(a,3)); if(!b.attributes.normal)b.computeVertexNormals(); return b;
  }
  function emit(g,tint,p,s,r=[0,0,0],parent=root,mat=solid) {
    const key=parent.uuid+mat.uuid;
    if(!parts.has(key))parts.set(key,{parent,mat,geos:[]});
    parts.get(key).geos.push(geometry(g,tint,p,s,r));
  }
  const box=(x,y,z,w,h,d,tint=C.wood,parent=root,mat=solid,rot=0)=>emit(templates.box,tint,[x,y,z],[w,h,d],[0,rot,0],parent,mat);
  const cyl=(x,y,z,r,h,tint=C.wood,parent=root,mat=solid,rotation=[0,0,0])=>emit(templates.cylinder,tint,[x,y,z],[r,h,r],rotation,parent,mat);
  const ball=(x,y,z,sx,sy,sz,tint,parent=root,mat=solid)=>emit(templates.sphere,tint,[x,y,z],[sx,sy,sz],[0,0,0],parent,mat);
  function rod(a,b,r,tint=C.wood,parent=root,mat=solid) {
    const v=new THREE.Vector3(...b).sub(new THREE.Vector3(...a)), q=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),v.clone().normalize());
    const e=new THREE.Euler().setFromQuaternion(q), p=a.map((n,i)=>(n+b[i])/2);
    emit(templates.rod,tint,p,[r,v.length(),r],[e.x,e.y,e.z],parent,mat);
  }
  function group(parent=root,name='') {const g=new THREE.Group();g.name=name;parent.add(g);return g;}
  function pick(id) {const g=group(pickRoot,id);g.userData.pick={kind:'spot',id};return g;}
  function flush() {
    for(const {parent,mat,geos} of parts.values()) {
      const g=mergeGeometries(geos,false); geos.forEach(v=>v.dispose()); ownedGeometry.add(g);
      const m=new THREE.Mesh(g,mat);m.castShadow=true;m.receiveShadow=true;
      if(parent.userData.pick)m.userData.pick={...parent.userData.pick};parent.add(m);
    }
    parts.clear();
  }
  function instanced(g,entries,mat=solid,parent=root) {
    const geo=geometry(g,0xffffff);ownedGeometry.add(geo);
    const m=new THREE.InstancedMesh(geo,mat,entries.length); m.castShadow=true;m.receiveShadow=true;
    entries.forEach((v,i)=>{scratch.position.set(...v.p);scratch.rotation.set(...(v.r||[0,0,0]));scratch.scale.set(...(v.s||[1,1,1]));scratch.updateMatrix();m.setMatrixAt(i,scratch.matrix);m.setColorAt(i,color.set(v.c||'#ffffff'));});
    m.instanceMatrix.needsUpdate=true;if(m.instanceColor)m.instanceColor.needsUpdate=true; m.computeBoundingSphere();parent.add(m);return m;
  }
  const colliders=[], buckets=new Map(), CELL=4;
  function collider(o) {if(o.type==='box'){o.rot=o.rot||0;Object.defineProperties(o,{cs:{value:Math.cos(o.rot)},sn:{value:Math.sin(o.rot)}});}colliders.push(o);}
  const cb=(x,z,w,d,rot=0)=>collider({type:'box',x,z,hw:w/2,hd:d/2,rot});
  const cc=(x,z,r)=>collider({type:'circle',x,z,r});
  const cellKey=(x,z)=>(x+128)*256+z+128;
  function indexCollisions() {
    buckets.clear();
    for(const c of colliders){const cr=c.type==='circle'?Math.max(c.r,c.navR||0):0,rx=c.type==='circle'?cr:Math.abs(c.cs)*c.hw+Math.abs(c.sn)*c.hd,rz=c.type==='circle'?cr:Math.abs(c.sn)*c.hw+Math.abs(c.cs)*c.hd;
      for(let ix=Math.floor((c.x-rx-1)/CELL);ix<=Math.floor((c.x+rx+1)/CELL);ix++)for(let iz=Math.floor((c.z-rz-1)/CELL);iz<=Math.floor((c.z+rz+1)/CELL);iz++){
        const k=cellKey(ix,iz);if(!buckets.has(k))buckets.set(k,[]);buckets.get(k).push(c);
      }
    }
  }
  function collides(c,x,z,r,fixed) {
    const dx=x-c.x,dz=z-c.z;
    if(c.type==='circle'){const cr=(fixed&&c.navR!==undefined?c.navR:c.r)+r;return dx*dx+dz*dz<cr*cr;}
    const lx=Math.abs(dx*c.cs-dz*c.sn)-c.hw,lz=Math.abs(dx*c.sn+dz*c.cs)-c.hd,ox=Math.max(0,lx),oz=Math.max(0,lz);
    return ox*ox+oz*oz<r*r || (lx<=0&&lz<=0);
  }
  function blockedBy(x,z,r,fixed) {
    if(!Number.isFinite(x+z+r))return true;r=Math.max(0,r);
    if(x-r<BOUNDS.minX||x+r>BOUNDS.maxX||z-r<BOUNDS.minZ||z+r>BOUNDS.maxZ||x<riverX(z)+1.6+r||inPond(x,z,r))return true;
    if(r<=1){const list=buckets.get(cellKey(Math.floor(x/CELL),Math.floor(z/CELL)));if(list)for(let i=0;i<list.length;i++){const c=list[i];if(!(fixed&&c.soft)&&collides(c,x,z,r,fixed))return true;}}
    else { // Rare large-agent query: no fixed-radius assumption.
      const n=Math.ceil((r-1)/CELL),cx=Math.floor(x/CELL),cz=Math.floor(z/CELL);
      for(let a=cx-n;a<=cx+n;a++)for(let b=cz-n;b<=cz+n;b++){const list=buckets.get(cellKey(a,b));if(list)for(const c of list)if(!(fixed&&c.soft)&&collides(c,x,z,r,fixed))return true;}
    }
    return false;
  }
  function blocked(x,z,r=.3){return blockedBy(x,z,r,false);}
  // 고양이 길: 그래픽 품질(나무·대나무 수)이 달라도 모든 방문객에게 같은 판정
  function blockedFixed(x,z,r=.3){return blockedBy(x,z,r,true);}
  function heightAt(x,z) {
    if(inside(x,z,-16,0,-15,-5))return 1.25;
    if(inside(x,z,-10,-6,-5,-3.4))return 1.25*(-3.4-z)/1.6;
    if(inside(x,z,-28,-18,2.5,9.5))return .75;
    if(inside(x,z,-18,-17,5,7))return .75*(-17-x);
    if(inside(x,z,19,29,20.5,27.5))return .75;
    if(inside(x,z,22.8,25.2,27.5,28.5))return .75*(28.5-z);
    if(inside(x,z,1.5,6.5,-.5,4.5))return .45;
    if(inside(x,z,3.1,4.9,4.5,5.3))return .45*(5.3-z)/.8;
    if(inside(x,z,-17,-13.4,-21.8,-18.2))return .55;
    if(inside(x,z,-16,-14.4,-18.2,-17.2))return .55*(-17.2-z);
    if(inside(x,z,4.5,19.5,-16,-10))return .6;
    return groundHeight(x,z);
  }
  const roadSegments=[[[0,62],[0,50],3],[[0,50],[-8,45],3],[[0,50],[9,45],2.6],[[-8,45],[-8,18],3.4],[[-30,44],[-30,-42],1.6],[[9,43],[12,40],2],[[12,40],[18,34],2],[[18,34],[24,28.5],2],[[5,26],[18,26],1.8],[[-8,21],[-30,21],1.5],[[-16,-2],[-16,-17],1.6],[[-30,-26],[-22,-34],1.6],[[-22,-34],[-16,-40],1.6]];
  function nearRoad(x,z) {for(const [a,b,w] of roadSegments){const dx=b[0]-a[0],dz=b[1]-a[1],t=clamp(((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz),0,1);if((x-a[0]-t*dx)**2+(z-a[1]-t*dz)**2<(w*.5)**2)return true;}return false;}
  function surfaceAt(x,z) {
    if(inside(x,z,-14.5,-1.5,-13.5,-6.5)||inside(x,z,-27.5,-18,3,9)||inside(x,z,19.5,28.5,21,27)||inside(x,z,-17,-13.4,-21.8,-18.2))return 'wood';
    if(heightAt(x,z)>.4||nearRoad(x,z)||Math.abs(Math.hypot(x+8,z-5)-3.4)<.55)return 'stone';
    if(inside(x,z,-20,6,-4,18))return 'gravel';
    return inside(x,z,5,36,18,44)?'dirt':'grass';
  }
  function zoneAt(x,z) {
    if(inside(x,z,-14.5,-1.5,-13.5,-6.5))return 'hall';
    if(inside(x,z,19.5,28.5,21,27))return 'chamber';
    if(inside(x,z,-27.5,-18,3,9))return 'tea';
    if(inside(x,z,5,36,18,44))return 'musang';
    if(Math.abs(x-riverX(z))<7.6||inPond(x,z,6))return 'water';
    if(inside(x,z,-31,-12,-42,-27))return 'bamboo';
    if(z>44||x>25||z<-32)return 'forest';return 'outdoor';
  }
  function raycastGround(ray) {
    const p=ray.origin,d=ray.direction;if(d.lengthSq()<1e-10)return null;
    let prev=0,prevH=p.y-heightAt(p.x,p.z);
    for(let t=.35;t<=120;t+=.35){const x=p.x+d.x*t,z=p.z+d.z*t,h=p.y+d.y*t-heightAt(x,z);
      if(h<=0&&prevH>=0){let lo=prev,hi=t;for(let i=0;i<15;i++){const m=(lo+hi)/2,mx=p.x+d.x*m,mz=p.z+d.z*m;if(p.y+d.y*m>heightAt(mx,mz))lo=m;else hi=m;}const q=(lo+hi)/2,xx=p.x+d.x*q,zz=p.z+d.z*q;return blocked(xx,zz,0)?null:{x:xx,y:heightAt(xx,zz),z:zz};}
      prev=t;prevH=h;
    }return null;
  }
  await stage(.03,'산사의 풍경을 불러오고 있어요');
  // Vertex-coloured terrain, including a lower bed beneath water.
  const terrain=new THREE.PlaneGeometry(116,136,high?48:24,high?60:30);terrain.rotateX(-PI/2);terrain.translate(-4,0,10);
  const pos=terrain.attributes.position, colors=new Float32Array(pos.count*3);
  for(let i=0;i<pos.count;i++){const x=pos.getX(i),z=pos.getZ(i);pos.setY(i,inPond(x,z,1.7)||Math.abs(x-riverX(z))<2.9?-.3:groundHeight(x,z));
    color.set(inside(x,z,-20,6,-4,18)?'#d8cdb6':nearRoad(x,z)?'#c9bfae':rnd()<.55?'#a69a62':'#8a9a62');color.multiplyScalar(.92+rnd()*.13);colors.set([color.r,color.g,color.b],i*3);}
  terrain.setAttribute('color',new THREE.BufferAttribute(colors,3));terrain.computeVertexNormals();ownedGeometry.add(terrain);
  const ground=new THREE.Mesh(terrain,solid);ground.receiveShadow=true;root.add(ground);
  function ribbon(a,b,w,tint,parent=root){const dx=b[0]-a[0],dz=b[1]-a[1],l=Math.hypot(dx,dz);box((a[0]+b[0])/2,.018,(a[1]+b[1])/2,w,.035,l,tint,parent,solid,Math.atan2(dx,dz));}
  roadSegments.forEach(([a,b,w])=>ribbon(a,b,w,'#c0b6a0'));
  // Individual flat pavers form the entrance and pagoda circuit.
  const stones=[], grass=[], moss=[], groundLeaves=[], trunks=[], crowns=[], pineCrowns=[], fruit=[], bamboo=[], bambooBands=[];
  for(let z=45;z<62;z+=.95)for(let x=-.7;x<=.7;x+=1.4)stones.push({p:[x+(z<50?-.2:0),.065,z],s:[.58,.07,.39],c:'#aaa69b',r:[0,rnd()*.2,0]});
  for(let i=0;i<32;i++){const a=i*TAU/32;stones.push({p:[-8+Math.sin(a)*3.4,.075,5+Math.cos(a)*3.4],s:[.39,.08,.29],c:'#a7a394',r:[0,a,0]});}
  function wall(x1,z1,x2,z2,h=1.6){const l=Math.hypot(x2-x1,z2-z1),a=Math.atan2(x2-x1,z2-z1),x=(x1+x2)/2,z=(z1+z2)/2;
    box(x,h/2,z,.42,h,l,'#898c80',root,solid,a);box(x,h+.06,z,.66,.2,l+.12,C.tile,root,solid,a);cb(x,z,.5,l,a);
    const n=Math.ceil(l/1.15);for(let j=0;j<n;j++){const t=(j+.5)/n;box(lerp(x1,x2,t),h-.36,lerp(z1,z2,t),.445,.065,l/n*.92,'#b7b3a3',root,solid,a);}
  }
  wall(-37,44,-10.1,44);wall(-5.9,44,7.5,44);wall(10.5,44,36,44);
  wall(5,18,5,25);wall(5,27,5,44);wall(5,18,36,18);
  wall(35.5,-42,35.5,62,1.2);wall(-34,-41.5,35.5,-41.5,1.1);
  await stage(.16,'대웅전과 돌길을 준비하고 있어요');
  // Architecture: material batches are separate only where a cutaway needs it.
  const cutaways={}, cameraBlockers=[], signboards=[], signMaterials=[];
  await Promise.race([document.fonts.load('600 64px "Noto Serif KR"','夢山寺無常門大雄殿無常堂解脫門'),new Promise(r=>setTimeout(r,2500))]);
  function sign(text,x,y,z,w=2.6,parent=root,rot=0) {
    const canvas=document.createElement('canvas');canvas.width=512;canvas.height=176;const ctx=canvas.getContext('2d');
    ctx.fillStyle='#23332b';ctx.fillRect(0,0,512,176);ctx.strokeStyle='#b59b67';ctx.lineWidth=5;ctx.strokeRect(9,9,494,158);
    ctx.font='600 100px "Noto Serif KR", serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle='#e9d8a8';ctx.fillText(text,256,86);
    const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;ownedTextures.add(texture);
    const mat=new THREE.MeshStandardMaterial({map:texture,emissiveMap:texture,emissive:0xffffff,emissiveIntensity:.06,roughness:.85});ownedMaterials.add(mat);signMaterials.push(mat);
    const geo=new THREE.PlaneGeometry(w,w*176/512);ownedGeometry.add(geo);const m=new THREE.Mesh(geo,mat);m.position.set(x,y,z);m.rotation.y=rot;m.name=text;parent.add(m);signboards.push(m);
  }
  // Curved hip/gable roof: raised corners follow y += k * (abs(x)/halfWidth)^3.
  function roof(cx,cy,cz,w,d,hip=true,parent=root,plain=false) {
    const hw=w/2,hd=d/2,ridge=hip?hw*.58:hw,lift=.5,rise=Math.min(2.15,d*.28),nx=high?16:10,ny=high?5:3;
    const roofY=(x,t)=>cy+rise*(1-t)**1.55+lift*(Math.abs(x)/hw)**3*t*t+.10*t**5;
    const verts=[];
    for(const side of [-1,1])for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){
      const point=(u,t)=>{const x=(u*2-1)*lerp(ridge,hw,t);return [cx+x,roofY(x,t),cz+side*hd*t];};
      const a=point(i/nx,j/ny),b=point((i+1)/nx,j/ny),c=point(i/nx,(j+1)/ny),e=point((i+1)/nx,(j+1)/ny);
      if(side===1)verts.push(...a,...c,...b,...b,...c,...e);else verts.push(...a,...b,...c,...b,...e,...c);
    }
    if(hip)for(const side of [-1,1]){const a=[cx+side*ridge,cy+rise,cz],b=[cx+side*hw,roofY(hw,1),cz-hd],c=[cx+side*hw,roofY(hw,1),cz+hd];if(side===1)verts.push(...a,...c,...b);else verts.push(...a,...b,...c);}
    const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(verts,3));geo.computeVertexNormals();
    emit(geo,C.tile,[0,0,0],[1,1,1],[0,0,0],parent);geo.dispose();
    // Raised longitudinal tile channels, curved eave fascia and round tile end-caps.
    const rows=Math.ceil(w/(high?.34:.52));
    for(let i=0;i<=rows;i++){const u=i/rows*2-1;for(const side of [-1,1]){
      const ribs=[];for(let j=0;j<4;j++){const t=j/4,t2=(j+1)/4,x=u*lerp(ridge,hw,t),xx=u*lerp(ridge,hw,t2);for(const q of [-1,1]){const a=[cx+x,roofY(x,t)+.06,cz+side*hd*t],b=[cx+x+q*.055,roofY(x,t),cz+side*hd*t],c=[cx+xx,roofY(xx,t2)+.06,cz+side*hd*t2],d=[cx+xx+q*.055,roofY(xx,t2),cz+side*hd*t2];if(q*side>0)ribs.push(...a,...b,...c,...b,...d,...c);else ribs.push(...a,...c,...b,...b,...c,...d);}}
      const rg=new THREE.BufferGeometry();rg.setAttribute('position',new THREE.Float32BufferAttribute(ribs,3));rg.computeVertexNormals();emit(rg,'#60676b',[0,0,0],[1,1,1],[0,0,0],parent);rg.dispose();
      const cap=new THREE.CircleGeometry(.075,6);emit(cap,'#7c7e77',[cx+u*hw,roofY(u*hw,1),cz+side*(hd+.035)],[1,1,1],[0,side===1?0:PI,0],parent);cap.dispose();
    }}
    for(const side of [-1,1])for(let i=0;i<12;i++){const x1=-hw+i*w/12,x2=x1+w/12;rod([cx+x1,roofY(x1,1)-.10,cz+side*hd],[cx+x2,roofY(x2,1)-.10,cz+side*hd],.13,plain?C.dark:C.green,parent);}
    rod([cx-ridge,cy+rise+.12,cz],[cx+ridge,cy+rise+.12,cz],.14,'#777b7c',parent);
    for(const s of [-1,1])rod([cx+s*ridge,cy+rise+.12,cz],[cx+s*(ridge+.35),cy+rise+.4,cz],.14,'#777b7c',parent);
  }
  const latticeCanvas=document.createElement('canvas');latticeCanvas.width=latticeCanvas.height=128;const lc=latticeCanvas.getContext('2d');
  lc.fillStyle='#ead7aa';lc.fillRect(0,0,128,128);lc.strokeStyle='#715341';lc.lineWidth=5;
  for(let i=-128;i<256;i+=32){lc.beginPath();lc.moveTo(i,0);lc.lineTo(i+128,128);lc.moveTo(i,128);lc.lineTo(i+128,0);lc.stroke();}
  const lattice=new THREE.CanvasTexture(latticeCanvas);lattice.colorSpace=THREE.SRGBColorSpace;ownedTextures.add(lattice);windowMat.map=lattice;windowMat.emissiveMap=lattice;windowMat.vertexColors=false;
  const windowParts=new Map();
  function panel(x,y,z,w,h,rot,parent) {const g=new THREE.PlaneGeometry(w,h);scratch.position.set(x,y,z);scratch.rotation.set(0,rot,0);scratch.scale.set(1,1,1);scratch.updateMatrix();g.applyMatrix4(scratch.matrix);if(!windowParts.has(parent))windowParts.set(parent,[]);windowParts.get(parent).push(g);}
  function plinth(x,z,w,d,h,entry='south',width=4) {
    box(x,h/2,z,w,h,d,C.stone);box(x,h+.07,z,w+.08,.14,d+.08,'#c5beb0');
    // Thin edge colliders leave exactly the contractual stair opening.
    if(entry!=='east')cb(x+w/2,z,.16,d);cb(x-w/2,z,.16,d);cb(x,z-d/2,w,.16);
    if(entry==='south'){const side=(w-width)/2;cb(x-w/2+side/2,z+d/2,side,.16);cb(x+w/2-side/2,z+d/2,side,.16);}
    else {cb(x,z+d/2,w,.16);const side=(d-width)/2;cb(x+w/2,z-d/2+side/2,.16,side);cb(x+w/2,z+d/2-side/2,.16,side);}
  }
  function steps(x,z,w,len,h,east=false) {const n=5;for(let i=0;i<n;i++){const a=(i+.5)/n;if(east)box(x+len*a,h*(1-i/n)/2,z,len/n,h*(1-i/n),w,'#b4aea0');else box(x,h*(1-i/n)/2,z+len*a,w,h*(1-i/n),len/n,'#b4aea0');}}
  function building(name,x,z,w,d,floor,plain=false,east=false,bays=3) {
    const upper=group(root,name+' 지붕·윗벽');cutaways[name]=upper;const timber=plain?C.dark:C.wood,top=floor+3.05;
    box(x,floor-.065,z,w,.13,d,C.floor);
    for(let i=0;i<=bays;i++)for(const side of [-1,1]){const px=x-w/2+i*w/bays,pz=z+side*d/2;cyl(px,floor+.05,pz,.28,.2,C.stone);cyl(px,floor+1.45,pz,.18,2.9,timber);cc(px,pz,.19);}
    for(const side of [-1,1])for(let j=1;j<3;j++){const px=x+side*w/2,pz=z-d/2+j*d/3;cyl(px,floor+.05,pz,.28,.2,C.stone);cyl(px,floor+1.45,pz,.18,2.9,timber);cc(px,pz,.19);}
    for(const side of [-1,1]){box(x,top,z+side*d/2,w+.35,.23,.28,plain?C.dark:C.green,upper);if(!plain){box(x,top+.15,z+side*d/2,w+.4,.07,.34,C.blue,upper);box(x,top-.13,z+side*d/2,w+.4,.06,.32,C.red,upper);}}
    function wallPiece(px,pz,ww,dd){box(px,floor+.55,pz,ww,1.1,dd,C.plaster);box(px,floor+1.9,pz,ww,1.6,dd,C.plaster,upper);cb(px,pz,ww,dd);}
    wallPiece(x,z-d/2,w,.16);wallPiece(x-w/2,z,.16,d);
    if(!east)wallPiece(x+w/2,z,.16,d);
    if(name==='hall'){const bw=w/bays;for(const side of [-1,1]){const px=x+side*(w/2-bw/2);wallPiece(px,z+d/2,bw,.16);panel(px,floor+1.6,z+d/2+.10,bw-.24,1.85,0,upper);}}
    else if(name==='mujang'){wallPiece(x-(w/2+1)/2,z+d/2,(w-2)/2,.16);wallPiece(x+(w/2+1)/2,z+d/2,(w-2)/2,.16);panel(x-3,floor+1.65,z+d/2+.10,1.35,1.7,0,upper);panel(x+3,floor+1.65,z+d/2+.10,1.35,1.7,0,upper);}
    else if(east){wallPiece(x,z+d/2,w,.16);for(let j=-1;j<=1;j++){box(x+w/2+.05,top-.18,z+j*1.8,1.6,.09,1.65,C.dark,upper);panel(x-w/2+.10,floor+1.6,z+j*1.8,1.45,1.8,PI/2,upper);}}
    else {wallPiece(x,z+d/2,w,.16);for(let i=0;i<bays;i++)panel(x-w/2+(i+.5)*w/bays,floor+1.6,z+d/2+.10,w/bays-.35,1.8,0,upper);}
    roof(x,top+.15,z,w+2.5,d+2.4,!plain,upper,plain);cameraBlockers.push({type:'box',x,z,hw:w/2,hd:d/2,top},{type:'box',x,z,hw:w/2+1.25,hd:d/2+1.2,bottom:top,top:top+.5+Math.min(2.15,(d+2.4)*.28)}); // walls to the wall top, then the roof out to the eaves (open under the eaves = porch)
    // Repeated painted bracket arms under the eaves, denser on the main hall.
    if(!plain)for(let i=0;i<=bays;i++)for(const side of [-1,1]){const px=x-w/2+i*w/bays,pz=z+side*(d/2+.25);box(px,top-.32,pz,.72,.16,.8,C.green,upper);box(px,top-.46,pz,.4,.12,.65,C.red,upper);}
    return upper;
  }
  plinth(-8,-10,16,10,1.1,'south',4);steps(-8,-5,4,1.6,1.25);
  const hallUpper=building('hall',-8,-10,13,7,1.25,false,false,5);sign('大雄殿',-8,4.05,-5.98,3.1,hallUpper);
  // 대웅전 안에서 윗벽·지붕이 숨어도 바깥 숲이 비치지 않게: 안쪽에서만 보이는 한 면짜리 벽·천장
  {const f=1.25,wallM=new THREE.MeshStandardMaterial({color:C.plaster,roughness:.9}),ceilM=new THREE.MeshStandardMaterial({color:'#5a3a28',roughness:.9});ownedMaterials.add(wallM);ownedMaterials.add(ceilM);
   const pl=(w,h,x,y,z,ry,rx,m)=>{const g=new THREE.PlaneGeometry(w,h);ownedGeometry.add(g);const p=new THREE.Mesh(g,m);p.position.set(x,y,z);p.rotation.set(rx,ry,0);p.receiveShadow=true;root.add(p);};
   pl(13,2,-8,f+2.1,-13.41,0,0,wallM);pl(7,2,-14.41,f+2.1,-10,PI/2,0,wallM);pl(7,2,-1.59,f+2.1,-10,-PI/2,0,wallM);pl(13,7,-8,f+3,-10,0,PI/2,ceilM);}
  plinth(-23,6,10,7,.6,'east',2);steps(-18,6,2,1,.75,true);building('tea',-23.5,6,8,6,.75,false,true,3);box(-18.75,.675,6,1.5,.15,6,C.floor);
  plinth(24,24,10,7,.6,'south',2.4);steps(24,27.5,2.4,1,.75);const muUpper=building('mujang',24,24,9,6,.75,true);sign('無常堂',24,3.5,27.12,2.5,muUpper);
  box(12,.3,-13,15,.6,6,C.stone);building('yosa',12,-13,14,5,.6,false,false,6);cb(12,-13,15,6);
  function gate(name,x,z,w,plain=false,rot=0){const g=group();g.position.set(x,0,z);g.rotation.y=rot;const wood=plain?C.dark:C.wood;
    for(const s of [-1,1]){cyl(s*w/2,.12,0,.35,.24,C.stone,g);cyl(s*w/2,1.85,0,.22,3.5,wood,g);cc(x+Math.cos(rot)*s*w/2,z-Math.sin(rot)*s*w/2,.25);}
    box(0,3.4,0,w+.6,.35,.4,plain?C.dark:C.green,g);roof(0,3.65,0,w+2.5,3.2,!plain,g,plain);sign(name,0,3.05,.28,w*.7,g);
    if(plain)for(const s of [-1,1])box(s*(w/2-.1),1.5,-.5,.12,2.5,1.0,C.dark,g);
  }
  gate('夢山寺',-8,45,4);gate('無常門',9,45,3,true);gate('解脫門',5,26,2,true,-PI/2);
  // Handwritten wayfinding, painted after its font is ready.
  const fork=pick('fork');cyl(.9,1.25,49.5,.105,2.5,C.dark,fork);
  const directionCanvas=document.createElement('canvas');directionCanvas.width=1024;directionCanvas.height=256;const dc=directionCanvas.getContext('2d');
  await Promise.race([document.fonts.load('600 64px "Noto Serif KR"','← 일주문 · 템플스테이 무상문 · 임종체험 →'),new Promise(r=>setTimeout(r,2500))]);
  dc.fillStyle='#584738';dc.fillRect(0,0,1024,256);dc.fillStyle='#efe6d2';dc.font='600 64px "Noto Serif KR",serif';dc.textAlign='center';dc.textBaseline='middle';dc.fillText('← 일주문 · 템플스테이',512,74);dc.fillStyle='#f4cf8e';dc.fillText('무상문 · 임종체험 →',512,186);
  const directionTex=new THREE.CanvasTexture(directionCanvas);directionTex.colorSpace=THREE.SRGBColorSpace;ownedTextures.add(directionTex);
  const directionMat=new THREE.MeshStandardMaterial({map:directionTex,emissiveMap:directionTex,emissive:0xffffff,emissiveIntensity:.1,roughness:1});ownedMaterials.add(directionMat);
  const directionGeo=new THREE.PlaneGeometry(3.6,.9);ownedGeometry.add(directionGeo);const directionMesh=new THREE.Mesh(directionGeo,directionMat);directionMesh.position.set(.9,2.05,49.64);directionMesh.userData.pick={kind:'spot',id:'fork'};fork.add(directionMesh);
  const cushions=[],candleFlames=[];
  function cushion(x,y,z,id,tint='#9e5e4b'){const g=pick(id);cyl(x,y+.055,z,.43,.11,tint,g);cyl(x,y+.113,z,.35,.018,'#c6a073',g);return g;}
  for(let row=0;row<2;row++)for(let j=0;j<3;j++){const x=-10.2+j*2.2,z=-10.4+row*1.8,i=row*3+j;cushions.push({x,z,yaw:PI});cushion(x,1.25,z,'cushion-'+i);}
  box(-8,1.65,-12.65,8,.8,1.3,'#794731');box(-8,2.08,-12.65,8.25,.12,1.5,C.gold);cb(-8,-12.65,8,1.4);
  // 불상: buddha.js의 매끈한 금동 삼존상(본존 + 좌우 보살 .8배). 원점은 대좌 바닥, 제단 윗면 y=2.16, 정면 +z.
  const statues=[createBuddha({renderer,quality}),createBuddha({variant:'bodhisattva',side:-1,renderer,quality}),createBuddha({variant:'bodhisattva',side:1,renderer,quality})];
  statues.forEach((g,i)=>{g.position.set([-8,-10.35,-5.65][i],2.16,-12.35);g.scale.setScalar(i?.8:1);root.add(g);});
  function candle(x,y,z,parent=root){cyl(x,y+.25,z,.045,.5,'#b39b68',parent,metal);cyl(x,y+.48,z,.14,.045,'#baa375',parent,metal);cyl(x,y+.65,z,.07,.34,'#f4e9cb',parent);
    const g=geometry(templates.sphere,0xffffff,[0,0,0],[.055,.13,.055]);ownedGeometry.add(g);const f=new THREE.Mesh(g,flameMat);f.position.set(x,y+.9,z);parent.add(f);candleFlames.push(f);if(parent.userData.pick)f.userData.pick={...parent.userData.pick};}
  candle(-11.4,2.14,-12.1);candle(-4.6,2.14,-12.1);
  // Pagoda: stacked stone plinths, three body/roof pairs and the finial total 5.5 m.
  const pagoda=pick('pagoda');box(-8,.19,5,2.7,.38,2.7,'#93988f',pagoda);box(-8,.48,5,2.3,.22,2.3,'#b8b9ad',pagoda);
  for(let i=0;i<3;i++){const y=.62+i*1.24,w=1.55-i*.24;box(-8,y+.43,5,w,.86,w,'#b8b9ac',pagoda);box(-8,y+.88,5,w+.5,.16,w+.5,'#a0a69b',pagoda);
    emit(new THREE.CylinderGeometry((w+.08)*.56,(w+.62)*.71,.28,4), '#aeb2a6',[-8,y+1.08,5],[1,1,1],[0,PI/4,0],pagoda);}
  cyl(-8,4.48,5,.35,.22,'#9ba293',pagoda);cyl(-8,4.82,5,.12,.65,'#b1b8aa',pagoda);ball(-8,5.12,5,.23,.20,.23,'#aeb5a6',pagoda);emit(templates.cone,'#bcc2b1',[-8,5.38,5],[.15,.24,.15],[0,0,0],pagoda);cc(-8,5,1.5);cameraBlockers.push({type:'circle',x:-8,z:5,r:1.5,top:5.6});
  const incense=pick('incense'),incensePos=new THREE.Vector3(-8,1.35,-1.4);
  for(let i=0;i<3;i++){const a=i*TAU/3;cyl(-8+Math.cos(a)*.3,.28,-1.4+Math.sin(a)*.3,.07,.55,'#706949',incense,metal);}
  const bowlGeo=new THREE.LatheGeometry([new THREE.Vector2(.12,0),new THREE.Vector2(.38,.08),new THREE.Vector2(.5,.38),new THREE.Vector2(.47,.48)],12);
  emit(bowlGeo,'#716f4e',[-8,.45,-1.4],[1,1,1],[0,0,0],incense,metal);bowlGeo.dispose();cyl(-8,.85,-1.4,.44,.04,'#b6ac8c',incense);cc(-8,-1.4,.5);
  const incenseSticks=group(root),smokeCount=high?45:24,smokeData=new Float32Array(smokeCount*3),smokeAge=new Float32Array(smokeCount);
  for(let i=0;i<3;i++)cyl((i-1)*.08,.25,0,.011,.5,'#997144',incenseSticks);incenseSticks.position.set(-8,.87,-1.4);incenseSticks.visible=false;
  const smokeGeo=new THREE.BufferGeometry();smokeGeo.setAttribute('position',new THREE.BufferAttribute(smokeData,3));ownedGeometry.add(smokeGeo);
  const smokeMat=new THREE.PointsMaterial({color:'#dddcd4',size:.11,transparent:true,opacity:.22,depthWrite:false});ownedMaterials.add(smokeMat);
  const smoke=new THREE.Points(smokeGeo,smokeMat);smoke.frustumCulled=false;smoke.visible=false;root.add(smoke);let incenseLeft=0,incenseDuration=600;
  await stage(.34,'화톳불에 장작을 쌓고 있어요');
  const fireCenter=new THREE.Vector3(-8,0,13),woodpilePos=new THREE.Vector3(-10.9,.65,11.6);
  for(let i=0;i<14;i++){const a=i*TAU/14;stones.push({p:[-8+Math.sin(a)*1.12,.16,13+Math.cos(a)*1.12],s:[.28,.23,.22],c:i%2?'#85887a':'#a8a38d',r:[0,a,0]});}cc(-8,13,1.15);
  // Logs inside the hearth are geometry; flame, embers and hearth lighting belong to fx.js.
  for(let i=0;i<6;i++){const a=i*TAU/6;rod([-8+Math.sin(a)*.75,.12,13+Math.cos(a)*.75],[-8+Math.sin(a+.8)*.1,.65,13+Math.cos(a+.8)*.1],.12,'#4a3625');}
  function bench(x,z,yaw,id,log=false){const g=pick(id),y=heightAt(x,z),a=new THREE.Vector3(Math.cos(yaw),0,-Math.sin(yaw));
    if(log){rod([x-a.x*.95,y+.24,z-a.z*.95],[x+a.x*.95,y+.24,z+a.z*.95],.23,C.pine,g);}
    else {box(x,y+.39,z,1.8,.12,.5,'#88633f',g,solid,yaw);for(const s of [-1,1])box(x+a.x*s*.62,y+.18,z+a.z*s*.62,.16,.36,.4,C.dark,g,solid,yaw);}
  }
  bench(-8,15.8,PI,'fire-s',true);bench(-10.6,14.6,2.12,'fire-sw',true);bench(-5.4,14.6,-2.12,'fire-se',true);
  bench(11.6,14.2,-PI/2,'bench-ginkgo');bench(-30.2,18,-PI/2,'bench-river-n');bench(-30.2,-4,-PI/2,'bench-river-s');
  const woodpile=pick('fire-s');for(let row=0;row<3;row++)for(let i=0;i<4-row;i++){const x=-11.35+i*.28+row*.12,y=.14+row*.23;rod([x,y,11.1],[x,y,12.1],.13,C.pine,woodpile);cyl(x,y,12.12,.107,.025,'#c8a571',woodpile,solid,[PI/2,0,0]);}cb(-10.9,11.6,1.3,1.2);
  // Bell pavilion and a suspended north-striking mallet.
  box(4,.225,2,5,.45,5,C.stone);steps(4,4.5,1.8,.8,.45);
  for(const x of [1.85,6.15])for(const z of [-.15,4.15]){cyl(x,.55,z,.29,.2,C.stone);cyl(x,2.05,z,.18,3,C.wood);cc(x,z,.24);}
  roof(4,3.7,2,6.4,6.4,true);box(4,3.5,2,4.8,.25,.3,C.green);
  const bellPick=pick('bell'),bellSwing=group(bellPick);bellSwing.position.set(4,3.35,2);bellSwing.userData.pick={kind:'spot',id:'bell'};
  const bellGeo=new THREE.LatheGeometry([new THREE.Vector2(.25,0),new THREE.Vector2(.45,-.15),new THREE.Vector2(.53,-.55),new THREE.Vector2(.58,-1.2),new THREE.Vector2(.72,-1.45),new THREE.Vector2(.68,-1.51)],high?20:12);
  emit(bellGeo,'#697454',[0,0,0],[1,1,1],[0,0,0],bellSwing,metal);bellGeo.dispose();
  for(let y=-.45;y>=-1.25;y-=.4)cyl(0,y,0,.59,.05,'#9a9b6e',bellSwing,metal);
  cyl(4,3.52,2,.08,.36,C.dark,bellPick);cc(4,2,.73);
  const mallet=group(bellPick);mallet.position.set(4,3.6,3.7);mallet.userData.pick={kind:'spot',id:'bell'};
  rod([0,0,-.35],[0,-1.25,-.35],.022,'#c0ae84',mallet);rod([0,0,.65],[0,-1.25,.65],.022,'#c0ae84',mallet);
  rod([0,-1.25,-.75],[0,-1.25,1.05],.18,C.pine,mallet);rod([0,-1.25,1.05],[0,-2,1.1],.028,'#c0ae84',mallet);
  const bellPos=new THREE.Vector3(4,2.55,2);let bellAnim=null,bellRinging=0,bellResolve=null,bellPromise=null;
  // Tea room furnishings, pourable kettle and visible personal cup.
  const teaGroup=pick('tea-seat');box(-22.6,1.02,6,1.65,.13,1.1,'#775334',teaGroup);
  for(const x of [-23.2,-22])for(const z of [5.65,6.35])box(x,.85,z,.10,.2,.1,C.dark,teaGroup);cb(-22.6,6,1.6,1.05);
  cushion(-21.2,.75,6,'tea-seat','#74846b');cushion(-24,.75,6,'tea-seat','#74846b');
  const maru=pick('tea-maru');box(-18.7,.76,3.6,1,.035,1,C.floor,maru);
  const kettlePos=new THREE.Vector3(-24.6,1.26,6.9),teaCupPos=new THREE.Vector3(-22.02,1.23,6);
  cyl(-24.6,.96,6.9,.30,.4,'#514a3c',teaGroup);cyl(-24.6,1.18,6.9,.23,.035,'#9e6742',teaGroup);
  const kettle=group(teaGroup);kettle.userData.pick={kind:'spot',id:'tea-seat'};kettle.position.copy(kettlePos);
  ball(0,.07,0,.24,.20,.24,'#5b695c',kettle,metal);cyl(0,.23,0,.16,.05,'#798576',kettle,metal);ball(0,.28,0,.05,.05,.05,C.dark,kettle);
  rod([.12,.08,0],[.4,.22,0],.055,'#6f7966',kettle,metal);const handleGeo=new THREE.TorusGeometry(.23,.025,4,12,PI);emit(handleGeo,'#4c5247',[0,.17,0],[1,1,1],[0,0,0],kettle);handleGeo.dispose();
  function cup(parent,x,y,z){cyl(x,y,z,.105,.13,'#dad8ba',parent);cyl(x,y+.069,z,.088,.008,'#968b42',parent);}
  const teaCup=group(teaGroup);teaCup.userData.pick={kind:'spot',id:'tea-seat'};cup(teaCup,...teaCupPos.toArray());cup(teaGroup,-23.15,1.23,6);
  const streamGeo=new THREE.CylinderGeometry(.013,.018,1,5);ownedGeometry.add(streamGeo);const streamMat=material({color:'#c7b67a',transparent:true,opacity:.65,vertexColors:false});
  const teaStream=new THREE.Mesh(streamGeo,streamMat);teaStream.visible=false;teaStream.userData.pick={kind:'spot',id:'tea-seat'};teaGroup.add(teaStream);
  function teaPour(t){t=clamp(Number(t)||0,0,1);const k=Math.sin(t*PI);kettle.position.copy(kettlePos).lerp(new THREE.Vector3(-22.48,1.75,6),Math.min(1,t*5));kettle.rotation.z=-.8*k;
    teaStream.visible=t>.12&&t<.93;const sp=new THREE.Vector3(.4,.22,0).applyEuler(kettle.rotation).add(kettle.position),end=teaCupPos.clone().add(new THREE.Vector3(0,.08,0));
    teaStream.position.copy(sp).add(end).multiplyScalar(.5);teaStream.scale.y=sp.distanceTo(end);teaStream.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),end.sub(sp).normalize());if(t>=1){kettle.position.copy(kettlePos);kettle.rotation.z=0;}}
  const broom=pick('broom');box(8.5,1.35,-9.6,2.1,.10,.14,C.dark,broom);
  for(const x of [7.65,9.35])cyl(x,.75,-9.6,.065,1.5,C.pine,broom);
  for(let i=0;i<4;i++){const x=7.9+i*.4;rod([x,.26,-9.5],[x,1.6,-9.6],.025,'#9b8151',broom);emit(templates.cone,'#aa8b55',[x,.3,-9.5],[.15,.55,.07],[0,0,PI],broom);}
  cb(8.5,-9.6,2,.3);
  // Persimmons hung beneath a timber drying rack.
  for(const x of [14.8,18.2])for(const z of [-7.7,-6.7])cyl(x,1.3,z,.085,2.6,C.pine);
  for(const z of [-7.7,-6.7])rod([14.7,2.6,z],[18.3,2.6,z],.09,C.pine);
  for(let i=0;i<10;i++){const x=15+i*.33;rod([x,2.6,-7.2],[x,.7,-7.2],.011,'#b5a47c');for(let j=0;j<5;j++)fruit.push({p:[x,.85+j*.33,-7.2],s:[.11,.14,.11],c:'#c5752c'});}cb(16.5,-7.2,3.6,1.1);
  // Pond-side pavilion, with a south approach that stays out of the water.
  const pavilion=pick('pavilion');box(-15.2,.48,-20,3.6,.14,3.6,C.floor,pavilion);steps(-15.2,-18.2,1.6,1,.55);
  for(const x of [-16.7,-13.7])for(const z of [-21.5,-18.5]){cyl(x,1.65,z,.13,2.8,C.wood,pavilion);cc(x,z,.16);}roof(-15.2,3.15,-20,5,5,true);
  // Lotus flowers and stepping stones are decorative; the pond remains non-walkable.
  for(let i=0;i<8;i++){const a=i*.38;stones.push({p:[-18.2-Math.sin(a)*1.7,.05,-17.1-i*.55],s:[.38,.15,.3],c:'#939e8a',r:[0,a,0]});}
  await stage(.52,'무상당의 촛불을 켜고 있어요');
  const muStart=pick('mujang-start');cyl(21.5,.04,30.2,.7,.06,'#b7b4a3',muStart);
  const altar=group();box(24,1.05,21.6,4,.6,.65,C.dark,altar);box(24,1.37,21.6,4.15,.08,.78,'#73644d',altar);cb(24,21.6,4,.8);
  box(24,2.05,21.49,1.0,1.25,.13,'#2e2b28',altar);box(24,2.05,21.57,.88,1.12,.04,C.gold,altar);
  const portraitGeo=new THREE.PlaneGeometry(.76,1.0);ownedGeometry.add(portraitGeo);const portraitMat=new THREE.MeshStandardMaterial({color:'#d9d4c4',roughness:1});ownedMaterials.add(portraitMat);
  const portrait=new THREE.Mesh(portraitGeo,portraitMat);portrait.position.set(24,2.05,21.6);altar.add(portrait);
  box(23.61,2.49,21.64,.13,.42,.025,'#38342e',altar,solid,-.65);box(24.39,2.49,21.64,.13,.42,.025,'#38342e',altar,solid,.65);
  // Quiet white chrysanthemums, not horror imagery.
  for(const x of [22.5,25.5,19.25,28.75]){const z=x<21||x>27?27.6:21.65,y=x<21||x>27?.12:1.4;cyl(x,y+.15,z,.18,.3,'#cbc8b7');
    for(let j=0;j<7;j++){const a=j*2.4,r=.19*Math.sqrt(j/7),xx=x+Math.sin(a)*r,zz=z+Math.cos(a)*r;rod([x,y+.2,z],[xx,y+.6,zz],.012,'#75855e');for(let k=0;k<6;k++)ball(xx+Math.sin(k*TAU/6)*.055,y+.61,zz+Math.cos(k*TAU/6)*.055,.065,.04,.06,'#f7f2de');ball(xx,y+.65,zz,.025,.03,.025,'#d6ba65');}}
  candle(22.2,1.4,21.6);candle(25.8,1.4,21.6);
  const envelope=group();box(24,1.435,21.9,.42,.025,.23,'#faf4e4',envelope);rod([23.8,1.453,21.8],[24,1.453,21.95],.006,'#d6cdb9',envelope);rod([24.2,1.453,21.8],[24,1.453,21.95],.006,'#d6cdb9',envelope);envelope.visible=false;
  const coffinPick=pick('coffin'),coffinLid=group(coffinPick);coffinLid.userData.pick={kind:'spot',id:'coffin'};
  for(let i=0;i<3;i++){const x=22.2+i*1.8;box(x,.91,24,.95,.16,2.0,'#c9a77a',coffinPick);for(const s of [-1,1]){box(x+s*.47,1.12,24,.09,.42,2.08,'#c9a77a',coffinPick);box(x,1.12,24+s*1.0,.96,.42,.09,'#c9a77a',coffinPick);}
    box(x,1.005,24,.78,.045,1.8,'#eee4d0',coffinPick);cb(x,24,1.06,2.14);
    if(i!==1)box(x-.63,1.33,24,.08,.98,2.08,'#bd9769',coffinPick);
  }
  box(0,0,0,1.06,.12,2.14,'#c9a77a',coffinLid);for(const x of [-.33,0,.33])box(x,.063,0,.016,.005,2.0,'#b18a5e',coffinLid);
  function setLid(t){t=clamp(Number(t)||0,0,1);const a=t*t*(3-2*t);coffinLid.position.set(lerp(23.34,24,a),lerp(1.34,1.39,a),24);coffinLid.rotation.z=lerp(PI/2,0,a);}setLid(0);
  bench(20.6,25.4,0,'portrait-seat');const portraitCamPos=new THREE.Vector3(20.6,1.65,26.48),photo=pick('portrait-seat');
  box(20.6,1.64,26.7,.38,.32,.27,'#493b2e',photo);cyl(20.6,1.65,26.5,.12,.2,'#22282a',photo,metal,[PI/2,0,0]);
  for(let i=0;i<3;i++){const a=i*TAU/3;rod([20.6,1.5,26.7],[20.6+Math.sin(a)*.4,.76,26.7+Math.cos(a)*.4],.028,C.pine,photo);}cc(20.6,26.7,.27);
  const letter=pick('letter-desk');box(27.9,1.05,25.6,.95,.10,.9,C.dark,letter);box(27.9,1.108,25.6,.5,.015,.55,'#f3ebd7',letter);rod([27.7,1.13,25.85],[28.1,1.13,25.85],.018,C.dark,letter);cb(27.9,25.6,1,.9);
  for(const x of [27.55,28.25])for(const z of [25.3,25.9])box(x,.9,z,.07,.25,.07,C.dark,letter);cushion(27,.75,25.6,'letter-desk','#8c8a77');
  const robe=pick('robe-rack');for(const z of [22.1,23.1])cyl(27.9,1.57,z,.035,1.65,C.dark,robe);rod([27.9,2.4,22],[27.9,2.4,23.2],.04,C.dark,robe);
  box(27.9,1.7,22.6,.12,1.15,.62,'#ece6d6',robe);box(27.9,2.14,22.6,.13,.28,1.04,'#ece6d6',robe);box(27.99,1.7,22.6,.015,1.1,.035,'#d2c9b7',robe);cb(27.9,22.6,.35,1.2);
  // Trees share trunks/crowns, including deliberately dense perimeter woodland.
  const treeRecords=[];
  function tree(x,z,type='maple',size=1,collision=true,soft=false,navR=.22*size){const y=groundHeight(x,z),h=(3.7+rnd()*.8)*size;treeRecords.push({x,z,type,size});
    trunks.push({p:[x,y+h*.42,z],s:[.17*size,h*.84,.17*size],c:type==='bamboo'?'#8aa65a':C.pine,r:[0,rnd(),.035]});
    if(collision)collider({type:'circle',x,z,r:.22*size,soft,navR});
    const tint=type==='pine'?'#3f5a3a':type==='ginkgo'?'#e7b53c':type==='persimmon'?'#a28b3c':rnd()>.5?'#c8452e':'#d9702e';
    if(type==='pine'){for(let j=0;j<3;j++)pineCrowns.push({p:[x+Math.sin(j*2.4)*.5,y+h-.45+j*.3,z+Math.cos(j*2.4)*.35],s:[(1.7-j*.25)*size,.45*size,(1.6-j*.25)*size],c:j%2?'#425e40':'#354d35'});}
    else for(let j=0;j<(high?4:2);j++){const a=j*2.4,r=j===0?0:.8*size;crowns.push({p:[x+Math.sin(a)*r,y+h+(j===0?.4:0),z+Math.cos(a)*r],s:[1.3*size,(1.05+rnd()*.4)*size,1.2*size],c:tint,r:[rnd(),rnd(),rnd()]});}
    if(type==='persimmon')for(let j=0;j<14;j++){const a=j*2.4;fruit.push({p:[x+Math.sin(a)*(1+rnd()*.4),y+h-.6+rnd()*.7,z+Math.cos(a)*(1+rnd()*.4)],s:[.13,.12,.13],c:'#e9822b'});}
    if(type==='ginkgo')for(let j=0;j<95;j++){const a=rnd()*TAU,r=Math.sqrt(rnd())*3.2;groundLeaves.push({p:[x+Math.cos(a)*r,.04,z+Math.sin(a)*r],s:[.10,.08,.12],c:'#d6af40',r:[-PI/2,0,rnd()*TAU]});}
  }
  // Explicit trees define the recognisable landmarks.
  tree(10,12,'ginkgo',1.45);for(const [x,z] of [[14,-4],[17,-3.5],[19,-6]])tree(x,z,'persimmon',.85);
  for(const [x,z] of [[-20,20],[-17,27],[-18,35],[-23,40],[-3,33],[-2,22],[-1,40],[-27,14],[-26,-3],[-22,-8],[-18,-25],[-8,-25],[2,-23],[21,7],[25,12],[25,-6],[29,-14]])tree(x,z,'maple',.9+rnd()*.3,true,false,.264);
  for(const [x,z] of [[9,39],[14,36],[19,31],[26,32],[16,29],[29,37],[33,24],[8,22]])tree(x,z,'pine',.8);
  function gardenReserved(x,z){return inside(x,z,-14,15,46.5,62)||nearRoad(x,z)||inPond(x,z,1.1)||Math.abs(x-riverX(z))<2.8||inside(x,z,-29,2,-16,11)||inside(x,z,1,21,-18,0)||inside(x,z,18,30,19,31)||inside(x,z,-18,14,-4,18)||inside(x,z,-17.8,-12.6,-23,-17)||inside(x,z,7,11,42,47)||inside(x,z,-11,-5,42,47)||Math.hypot(x-.9,z-49.5)<2.2;}
  // 품질마다 수가 다른 무작위 나무·대나무가 설 수 있는 곳(위 반복문 세 개의 범위). 고양이 쉼터는 여기서 .7m 넘게 떨어뜨린다.
  const DIR8=[[1,0],[.7071067811865476,.7071067811865476],[0,1],[-.7071067811865476,.7071067811865476],[-1,0],[-.7071067811865476,-.7071067811865476],[0,-1],[.7071067811865476,-.7071067811865476]];
  function treeSpot(x,z){return (inside(x,z,-41,-33,-45,65)||inside(x,z,31,43,-45,65)||inside(x,z,-43,43,-47,-39)||inside(x,z,-30,30,48,65))&&!gardenReserved(x,z)&&!(Math.abs(x)<3.5&&z>48)
    ||inside(x,z,-29,30,-37,41)&&!gardenReserved(x,z)&&!inside(x,z,-31,-12,-42,-27)
    ||inside(x,z,-30,-13,-40,-28)&&!nearRoad(x,z);}
  function treeFree(x,z){if(treeSpot(x,z))return false;for(const [a,b] of DIR8)if(treeSpot(x+a*.7,z+b*.7))return false;return true;}
  for(let i=0;i<(high?265:120);i++){let x,z;const side=i%4;
    if(side===0){x=-41+rnd()*8;z=-45+rnd()*110;}else if(side===1){x=31+rnd()*12;z=-45+rnd()*110;}else if(side===2){x=-43+rnd()*86;z=-47+rnd()*8;}else {x=-30+rnd()*60;z=48+rnd()*17;}
    if(gardenReserved(x,z)||Math.abs(x)<3.5&&z>48)continue;tree(x,z,i%4===0?'pine':i%5===0?'ginkgo':'maple',.8+rnd()*.65,x>=-32&&x<=36&&z<=62&&z>=-42,true);
  }
  // Fill remaining garden pockets without obstructing doors, paths or spots.
  for(let i=0;i<(high?55:22);i++){const x=-29+rnd()*59,z=-37+rnd()*78;if(gardenReserved(x,z)||inside(x,z,-31,-12,-42,-27))continue;tree(x,z,i%3===0?'pine':'maple',.7+rnd()*.45,true,true);}
  for(let i=0;i<(high?160:60);i++){const x=-30+rnd()*17,z=-40+rnd()*12;if(nearRoad(x,z))continue;const h=3.6+rnd()*2.5;
    bamboo.push({p:[x,h/2,z],s:[.045,h,.045],c:'#8aa65a'});for(let y=.6;y<h;y+=high?.75:1)bambooBands.push({p:[x,y,z],s:[.058,.05,.058],c:'#536d43'});
    for(let j=0;j<2;j++)crowns.push({p:[x+(rnd()-.5)*.5,h-.4-j*.65,z],s:[.55,.16,.36],c:'#657d48',r:[0,rnd()*TAU,.3]});collider({type:'circle',x,z,r:.075,soft:true});
  }
  const bladeGeo=new THREE.BufferGeometry();bladeGeo.setAttribute('position',new THREE.Float32BufferAttribute([-.13,0,0,.13,0,0,.04,1,.025,0,0,-.13,0,0,.13,-.04,.8,.025],3));bladeGeo.computeVertexNormals();
  const leafGeo=new THREE.BufferGeometry();leafGeo.setAttribute('position',new THREE.Float32BufferAttribute([0,-1,0,-.7,0,0,0,1,.14,0,-1,0,0,1,.14,.7,0,0],3));leafGeo.computeVertexNormals();
  for(let i=0;i<(high?3200:1300);i++){const x=-42+rnd()*84,z=-43+rnd()*106;if(inPond(x,z,1.1)||Math.abs(x-riverX(z))<2.8||heightAt(x,z)>.25||nearRoad(x,z))continue;
    const y=heightAt(x,z),yard=inside(x,z,-20,6,-4,18);if(yard&&rnd()>.15)continue;
    grass.push({p:[x,y+.025,z],s:[.4+rnd()*.45,.12+rnd()*.28,.6],c:rnd()>.6?'#9d9c5c':'#647851',r:[0,rnd()*TAU,0]});
    if(i%6===0)moss.push({p:[x,y+.025,z],s:[.32+rnd()*.4,.045,.26+rnd()*.25],c:'#71805c'});
    if(i%3===0)groundLeaves.push({p:[x,y+.04,z],s:[.08,.12,.08],c:rnd()>.5?'#b16b32':'#cc9637',r:[-PI/2,0,rnd()*TAU]});
  }
  for(let i=0;i<(high?240:130);i++){const z=-42+rnd()*104,x=i%2?riverX(z)+2+rnd()*.5:33+rnd()*4;stones.push({p:[x,groundHeight(x,z)+.14,z],s:[.25+rnd()*.5,.18+rnd()*.4,.25+rnd()*.45],c:i%3?'#8e9380':'#a8aa97',r:[0,rnd()*TAU,0]});}
  instanced(templates.trunk,trunks);instanced(templates.sphere,crowns);instanced(templates.sphere,pineCrowns);instanced(templates.sphere,fruit);
  instanced(templates.reed,bamboo);instanced(templates.reed,bambooBands);instanced(templates.pebble,stones);
  const vegetationMat=material({side:THREE.DoubleSide});instanced(bladeGeo,grass,vegetationMat);instanced(templates.pebble,moss);instanced(leafGeo,groundLeaves,vegetationMat);bladeGeo.dispose();
  // Eight sweepable piles retain individual pick ids and scale to zero cleanly.
  const pileMeshes=[],pileEntries=[],leafPiles=LEAVES.map(([x,z])=>({x,z}));
  LEAVES.forEach(([x,z],i)=>{const entries=[];for(let k=0;k<(high?55:28);k++){const a=rnd()*TAU,r=Math.sqrt(rnd())*.73;entries.push({p:[Math.cos(a)*r,.07+(1-r/.73)*rnd()*.19,Math.sin(a)*r],s:[.11,.17,.12],c:['#bb7c34','#c4a048','#a8582e'][k%3],r:[-PI/2+rnd()*.35,0,rnd()*TAU]});}
    const g=pick('leaf-'+i);g.position.set(x,heightAt(x,z),z);const m=instanced(leafGeo,entries,vegetationMat,g);m.userData.pick={kind:'spot',id:'leaf-'+i};pileMeshes.push(m);pileEntries.push(entries);
  });
  const ringGeo=new THREE.TorusGeometry(.84,.018,4,24);ringGeo.rotateX(PI/2);
  const markerMat=material({color:'#dcc783',emissive:'#d3b976',emissiveIntensity:.7,transparent:true,opacity:.65,vertexColors:false});
  const leafMarkers=instanced(ringGeo,LEAVES.map(([x,z])=>({p:[x,heightAt(x,z)+.04,z]})),markerMat);leafMarkers.visible=false;leafMarkers.castShadow=false;ringGeo.dispose();
  function setLeafPile(i,amount){if(!pileMeshes[i])return;const a=clamp(Number(amount)||0,0,1);pileMeshes[i].scale.set(a,Math.sqrt(a),a);pileMeshes[i].visible=a>0;}
  // Falling leaves: a single instanced draw, deterministic slow loops.
  const fallingEntries=Array.from({length:high?54:28},()=>({p:[-23+rnd()*46,2+rnd()*6,-23+rnd()*62],s:[.09,.15,.10],c:rnd()>.5?'#cf8035':'#e1b545',r:[rnd(),rnd(),rnd()]}));
  const fallingLeaves=instanced(leafGeo,fallingEntries,vegetationMat);fallingLeaves.castShadow=false;fallingLeaves.frustumCulled=false;leafGeo.dispose();
  // Stone lanterns use two instances (stone casing / luminous paper) for the whole world.
  const lampPositions=[[-17,17],[-1,17],[-18,-3],[1,-3],[-28,40],[-28,30],[-28,20],[-28,10],[-28,0],[-28,-11],[-28,-21],[-28,-31],[-28,-41],[-11.7,37],[-4.3,27],[-11.7,18],[7.3,42],[11.4,37.2],[17,32.3],[22.6,30],[7.3,45],[10.7,45],[19,29],[29.3,29]];
  const lampPieces=[geometry(templates.box,'#aeb0a0',[0,.08,0],[.6,.16,.6]),geometry(templates.cylinder,'#aeb0a0',[0,.55,0],[.12,.9,.12]),geometry(templates.box,'#b9bbaa',[0,.98,0],[.43,.1,.43]),geometry(templates.cone,'#969f91',[0,1.58,0],[.43,.28,.43])];
  for(const x of [-.18,.18])for(const z of [-.18,.18])lampPieces.push(geometry(templates.box,'#aeb0a0',[x,1.25,z],[.06,.48,.06]));
  const lampGeo=mergeGeometries(lampPieces,false);lampPieces.forEach(g=>g.dispose());ownedGeometry.add(lampGeo);
  instanced(lampGeo,lampPositions.map(([x,z])=>({p:[x,heightAt(x,z),z],c:x>5?'#f4f1e1':'#d2cbb5'})));
  instanced(templates.box,lampPositions.map(([x,z])=>({p:[x,heightAt(x,z)+1.25,z],s:[.29,.35,.29],c:x>5?'#fff8dd':'#f4d5a4'})),glow);
  lampPositions.forEach(([x,z])=>cc(x,z,.24));
  await stage(.70,'산문 앞 첫 화면을 그리고 있어요');
  // Lotus lantern body, sculpted petals and tassel, 108 stable instance ids.
  function lanternGeometry(){const parts=[];
    const body=new THREE.LatheGeometry([new THREE.Vector2(.05,-.15),new THREE.Vector2(.18,-.1),new THREE.Vector2(.23,.08),new THREE.Vector2(.12,.19)],high?10:6);
    parts.push(geometry(body,0xffffff));body.dispose();
    const petals=[];for(let i=0;i<6;i++){const a=i*TAU/6,point=(r,y,t)=>[Math.sin(a+t)*r,y,Math.cos(a+t)*r],p=point(.10,-.15,0),l=point(.25,.02,-.30),tip=point(.27,.27,0),r=point(.25,.02,.30);petals.push(...p,...tip,...l,...p,...r,...tip);}
    const p=new THREE.BufferGeometry();p.setAttribute('position',new THREE.Float32BufferAttribute(petals,3));p.computeVertexNormals();parts.push(geometry(p,0xffffff));p.dispose();
    parts.push(geometry(templates.rod,0xffffff,[0,-.25,0],[.018,.18,.018]));
    const geo=mergeGeometries(parts,false);parts.forEach(g=>g.dispose());ownedGeometry.add(geo);return geo;}
  const lanternGeo=lanternGeometry(),lanternEntries=Array.from({length:108},(_,i)=>({p:[i<54?-10.2:-5.8,2.3,42-(i%54)*23/53],c:'#eab3a8'}));
  const lanterns=instanced(lanternGeo,lanternEntries,lanternMat,pickRoot);lanterns.userData.pick={kind:'lantern'};lanterns.frustumCulled=false;
  const tagGeo=new THREE.PlaneGeometry(.11,.27);const tagMat=material({side:THREE.DoubleSide});
  const tags=instanced(tagGeo,lanternEntries.map(v=>({p:[v.p[0],1.86,v.p[2]],s:[0,0,0],c:'#f5edda'})),tagMat,pickRoot);tags.userData.pick={kind:'lantern'};tags.frustumCulled=false;tagGeo.dispose();
  const mineGeo=new THREE.RingGeometry(.22,.25,8);mineGeo.rotateX(-PI/2);
  const mineMat=material({emissive:'#e9b758',emissiveIntensity:.8});
  const mineRings=instanced(mineGeo,lanternEntries.map(v=>({p:v.p,s:[0,0,0],c:'#eed292'})),mineMat,pickRoot);mineRings.userData.pick={kind:'lantern'};mineRings.frustumCulled=false;mineGeo.dispose();
  const lanternState=Array.from({length:108},()=>({wish:false,mine:false,color:null}));
  function setLantern(i,{color:col=null,wish=false,mine=false}={}){if(!Number.isInteger(i)||i<0||i>=108)return;const valid=Number.isInteger(col)&&col>=0&&col<5;lanternState[i]={color:valid?col:null,wish:!!wish,mine:!!mine};lanterns.setColorAt(i,color.set(valid?LANTERN_COLORS[col]:'#eab3a8'));lanterns.instanceColor.needsUpdate=true;updateLanterns(lastElapsed);}
  function lanternPos(i){i=clamp(Math.floor(Number(i)||0),0,107);lanterns.getMatrixAt(i,matrix);return new THREE.Vector3().setFromMatrixPosition(matrix).applyMatrix4(lanterns.matrixWorld);}
  function makeLantern(col){const g=new THREE.Group(),mat=lanternMat.clone();mat.color.set(LANTERN_COLORS[col]||'#eab3a8');mat.vertexColors=true;ownedMaterials.add(mat);mat.addEventListener('dispose',()=>ownedMaterials.delete(mat));const m=new THREE.Mesh(lanternGeo,mat);m.castShadow=true;g.add(m);return g;}
  for(const x of [-10.2,-5.8]){for(const z of [18.5,26.5,34.5,42.5]){cyl(x,1.4,z,.065,2.8,C.dark);cc(x,z,.09);}rod([x,2.65,18.5],[x,2.65,42.5],.014,'#605c4a');}
  const desk=pick('lantern-desk');box(-12.5,.83,20,1.35,.12,1.7,C.pine,desk);for(const x of [-13,-12])for(const z of [19.35,20.65])box(x,.4,z,.09,.8,.09,C.dark,desk);box(-12.5,.9,20,.7,.02,.8,'#f3ead7',desk);cb(-12.5,20,1.35,1.7);
  const whiteLanterns=[];for(const [x,z] of [[7.5,45],[10.5,45],[10.9,40.5],[14.4,36.9],[19.8,31.8],[22.6,28.1],[25.4,28.1]]){whiteLanterns.push({p:[x,2.35,z],s:[.9,1.25,.9],c:'#f5efda'});rod([x,2.6,z],[x,2.95,z],.014,C.dark);}
  instanced(lanternGeo,whiteLanterns,lanternMat);
  function updateLanterns(t){for(let i=0;i<108;i++){const e=lanternEntries[i],a=Math.sin(t*.85+i*.32)*.055,s=lanternState[i];
    scratch.position.set(e.p[0]+Math.sin(a)*.3,e.p[1],e.p[2]);scratch.rotation.set(0,0,a);scratch.scale.set(1,1,1);scratch.updateMatrix();lanterns.setMatrixAt(i,scratch.matrix);
    scratch.position.y-=.42;scratch.scale.setScalar(s.wish?1:0);scratch.updateMatrix();tags.setMatrixAt(i,scratch.matrix);
    scratch.position.y+=.47;scratch.scale.setScalar(s.mine?1:0);scratch.updateMatrix();mineRings.setMatrixAt(i,scratch.matrix);
  }lanterns.instanceMatrix.needsUpdate=true;tags.instanceMatrix.needsUpdate=true;mineRings.instanceMatrix.needsUpdate=true;}
  let lastElapsed=0;
  // Water: subtle procedural ripples, sky tint and fake grazing reflection; no texture fetch.
  const waterMat=new THREE.ShaderMaterial({uniforms:{time:{value:0},night:{value:0},skyTint:{value:new THREE.Color('#a9c4bc')}},transparent:true,opacity:.91,side:THREE.DoubleSide,
    vertexShader:`varying vec3 vWorld; void main(){ vec4 p=modelMatrix*vec4(position,1.);vWorld=p.xyz;gl_Position=projectionMatrix*viewMatrix*p; }`,
    fragmentShader:`uniform float time;uniform float night;uniform vec3 skyTint;varying vec3 vWorld;
    void main(){float ripple=sin(vWorld.x*4.1+time*.8+sin(vWorld.z*2.7-time*.35))*.5+.5;float band=pow(max(0.,sin(vWorld.x*1.7+vWorld.z*5.-time*.6)),18.);
    vec3 n=normalize(vec3(.035*cos(vWorld.x*4.+time),1.,.045*sin(vWorld.z*3.-time)));float fr=pow(1.-max(0.,dot(n,normalize(cameraPosition-vWorld))),3.);
    vec3 c=mix(vec3(.07,.16,.145),skyTint,.08+fr*.12)+vec3(.06,.09,.08)*ripple*.12+band*.018;c*=1.-night*.72;gl_FragColor=vec4(c,.78);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    }`});ownedMaterials.add(waterMat);
  const waterVertices=[];for(let i=0;i<72;i++){const a=i*TAU/72,b=(i+1)*TAU/72;waterVertices.push(-23,-.06,-20,-23+Math.cos(a)*5.65*pondRadius(a),-.06,-20+Math.sin(a)*4.15*pondRadius(a),-23+Math.cos(b)*5.65*pondRadius(b),-.06,-20+Math.sin(b)*4.15*pondRadius(b));}
  for(let z=-54;z<76;z+=1){const a=riverX(z),b=riverX(z+1);waterVertices.push(a-1.6,-.08,z,a+1.6,-.08,z,b-1.6,-.08,z+1,a+1.6,-.08,z,b+1.6,-.08,z+1,b-1.6,-.08,z+1);}
  // A narrow continuous bank covers the coarse terrain cells at the waterline.
  const banks=[];function bankQuad(a,b,c,d){banks.push(...a,...b,...c,...b,...d,...c);}
  for(let i=0;i<72;i++){const a=i*TAU/72,b=(i+1)*TAU/72,r=pondRadius(a),rr=pondRadius(b);bankQuad([-23+Math.cos(a)*5.65*r,-.075,-20+Math.sin(a)*4.15*r],[-23+Math.cos(b)*5.65*rr,-.075,-20+Math.sin(b)*4.15*rr],[-23+Math.cos(a)*(5.65*r+1.75),.025,-20+Math.sin(a)*(4.15*r+1.75)],[-23+Math.cos(b)*(5.65*rr+1.75),.025,-20+Math.sin(b)*(4.15*rr+1.75)]);}
  for(let z=-54;z<76;z++)for(const side of [-1,1]){const a=[riverX(z)+side*1.6,-.085,z],b=[riverX(z+1)+side*1.6,-.085,z+1],c=[riverX(z)+side*3,.025,z],d=[riverX(z+1)+side*3,.025,z+1];if(side===1)bankQuad(a,b,c,d);else bankQuad(b,a,d,c);}
  const bankGeo=new THREE.BufferGeometry();bankGeo.setAttribute('position',new THREE.Float32BufferAttribute(banks,3));bankGeo.computeVertexNormals();emit(bankGeo,'#9a9c7b',[0,0,0],[1,1,1]);bankGeo.dispose();
  const waterGeo=new THREE.BufferGeometry();waterGeo.setAttribute('position',new THREE.Float32BufferAttribute(waterVertices,3));waterGeo.computeVertexNormals();ownedGeometry.add(waterGeo);const water=new THREE.Mesh(waterGeo,waterMat);water.renderOrder=1;root.add(water);
  const pads=[],flowers=[];for(let i=0;i<24;i++){const a=rnd()*TAU,r=.45+rnd()*.4,x=-23+Math.cos(a)*5.2*r,z=-20+Math.sin(a)*3.7*r;pads.push({p:[x,-.015+i*.0005,z],s:[.25+rnd()*.2,.022,.29],c:i%3?'#6d875b':'#8d9e67'});if(i%4===0)flowers.push({p:[x,.07,z],s:[.65,.4,.65],c:'#f3c4b3'});}
  instanced(templates.disk,pads);instanced(lanternGeo,flowers,solid);
  const fishEntries=Array.from({length:high?7:4},(_,i)=>({p:[-23,-.14,-20],s:[.1,.07,.32],c:i%3===0?'#f1e4bc':i%3===1?'#d68c46':'#deaa7d'}));
  const fish=instanced(templates.sphere,fishEntries,solid);fish.castShadow=false;fish.frustumCulled=false;const tails=instanced(templates.cone,fishEntries,solid);tails.castShadow=false;tails.frustumCulled=false;
  // Gradient sky, stars, moon and three softly receding mountain silhouettes.
  const skyMat=new THREE.ShaderMaterial({side:THREE.BackSide,depthWrite:false,uniforms:{top:{value:new THREE.Color()},bottom:{value:new THREE.Color()}},
    vertexShader:'varying vec3 vDir;void main(){vDir=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader:`uniform vec3 top;uniform vec3 bottom;varying vec3 vDir;void main(){float f=pow(clamp(normalize(vDir).y,0.,1.),.65);gl_FragColor=vec4(mix(bottom,top,f),1.);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    }`});ownedMaterials.add(skyMat);
  const skyGeo=new THREE.SphereGeometry(245,24,12);ownedGeometry.add(skyGeo);const sky=new THREE.Mesh(skyGeo,skyMat);sky.renderOrder=-10;sky.frustumCulled=false;root.add(sky);
  const starPositions=[];for(let i=0;i<(high?420:220);i++){const a=rnd()*TAU,y=.12+rnd()*.85,r=Math.sqrt(1-y*y)*222;starPositions.push(Math.sin(a)*r,y*222,Math.cos(a)*r);}
  const starGeo=new THREE.BufferGeometry();starGeo.setAttribute('position',new THREE.Float32BufferAttribute(starPositions,3));ownedGeometry.add(starGeo);
  const starMat=new THREE.PointsMaterial({color:'#e7ecff',size:.48,sizeAttenuation:true,transparent:true,opacity:0,depthWrite:false,fog:false});ownedMaterials.add(starMat);const stars=new THREE.Points(starGeo,starMat);root.add(stars);
  const moonGeo=new THREE.SphereGeometry(3.6,12,8);ownedGeometry.add(moonGeo);const moonMat=new THREE.MeshBasicMaterial({color:'#f6ead4',transparent:true,opacity:0,fog:false});ownedMaterials.add(moonMat);const moon=new THREE.Mesh(moonGeo,moonMat);moon.position.set(-85,105,-135);root.add(moon);
  for(let layer=0;layer<3;layer++){
    const v=[],cols=[],n=96,r=120+layer*34,base=new THREE.Color(['#687765','#7c8c86','#9aa5a0'][layer]);
    function peak(i){const a=i*TAU/n;return 24+layer*6+13*Math.sin(a*5+layer*.7)+8*Math.sin(a*11+layer);}
    for(let i=0;i<n;i++){const a=i*TAU/n,b=(i+1)*TAU/n,p1=[Math.sin(a)*r,peak(i),Math.cos(a)*r],p2=[Math.sin(b)*r,peak(i+1),Math.cos(b)*r],p3=[Math.sin(a)*r,-7,Math.cos(a)*r],p4=[Math.sin(b)*r,-7,Math.cos(b)*r];v.push(...p1,...p3,...p2,...p2,...p3,...p4);for(let j=0;j<6;j++){const k=j===0||j===2||j===3?1:.75;cols.push(base.r*k,base.g*k,base.b*k);}}
    const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(v,3));geo.setAttribute('color',new THREE.Float32BufferAttribute(cols,3));geo.computeVertexNormals();ownedGeometry.add(geo);
    const mat=new THREE.MeshBasicMaterial({vertexColors:true,side:THREE.DoubleSide});ownedMaterials.add(mat);root.add(new THREE.Mesh(geo,mat));
  }
  const earthGeo=new THREE.CircleGeometry(230,64);earthGeo.rotateX(-PI/2);emit(earthGeo,'#778168',[-4,-.5,10],[1,1,1]);earthGeo.dispose();
  const previousFog=scene.fog;scene.fog=new THREE.FogExp2('#aabbbd',.0065);
  const sun=new THREE.DirectionalLight('#fff0d8',2.4);sun.castShadow=true;sun.shadow.mapSize.set(high?2048:1024,high?2048:1024);Object.assign(sun.shadow.camera,{left:-48,right:48,top:48,bottom:-48,near:1,far:240});sun.shadow.bias=-.00025;sun.shadow.normalBias=.045;sun.shadow.radius=2;
  const hemi=new THREE.HemisphereLight('#dde6ec','#a69b85',.9);
  const hallLight=new THREE.PointLight('#ffbd72',12,13,2);hallLight.position.set(-8,3,-11.6);
  const muLight=new THREE.PointLight('#ffdb9b',14,10,2);muLight.position.set(24,2.7,22.0);hallLight.castShadow=muLight.castShadow=false;
  root.add(sun,sun.target,hemi,hallLight,muLight); // Exactly four lights, never added/removed during play.
  const palettes=[
    {top:'#0a1424',bottom:'#24304a',sun:'#b2c0e5',power:.6,hemi:'#adbcdb',ground:'#8f9b8c',ambient:.35,fog:'#1a2236',night:1,offset:[-30,65,-45]},
    {top:'#8fa5c8',bottom:'#f2c9a0',sun:'#ffd2a8',power:1.4,hemi:'#b8c4d8',ground:'#8a7a68',ambient:.6,fog:'#c9b8a8',night:0,offset:[70,24,-5]},
    {top:'#9fc0de',bottom:'#e6e4da',sun:'#fff0d8',power:2.4,hemi:'#dde6ec',ground:'#a69b85',ambient:.9,fog:'#aabbbd',night:0,offset:[35,75,30]},
    {top:'#5a6e98',bottom:'#f0a774',sun:'#ffb27a',power:1.6,hemi:'#b9a8b8',ground:'#7a6a5a',ambient:.6,fog:'#8a7a88',night:.3,offset:[-70,24,20]}
  ];
  let nightFactor=0,sunOffset=new THREE.Vector3(35,75,30),hallBase=0,disposed=false;
  const blendColor=(target,a,b,f)=>target.set(a).lerp(color.set(b),f);
  function setTime(hour){hour=((Number(hour)||0)%24+24)%24;let a,b,f=0;
    if(hour<4.75||hour>=19.25)a=b=0;
    else if(hour<5.25){a=0;b=1;f=(hour-4.75)/.5;}
    else if(hour<6.75)a=b=1;
    else if(hour<7.25){a=1;b=2;f=(hour-6.75)/.5;}
    else if(hour<16.25)a=b=2;
    else if(hour<16.75){a=2;b=3;f=(hour-16.25)/.5;}
    else if(hour<18.75)a=b=3;
    else {a=3;b=0;f=(hour-18.75)/.5;}
    f=f*f*(3-2*f);const p=palettes[a],q=palettes[b];
    blendColor(skyMat.uniforms.top.value,p.top,q.top,f);blendColor(skyMat.uniforms.bottom.value,p.bottom,q.bottom,f);blendColor(sun.color,p.sun,q.sun,f);sun.intensity=lerp(p.power,q.power,f);
    blendColor(hemi.color,p.hemi,q.hemi,f);blendColor(hemi.groundColor,p.ground,q.ground,f);hemi.intensity=lerp(p.ambient,q.ambient,f);blendColor(scene.fog.color,p.fog,q.fog,f);
    nightFactor=lerp(p.night,q.night,f);scene.fog.density=.0065+nightFactor*.0015;sunOffset.fromArray(p.offset).lerp(new THREE.Vector3(...q.offset),f);
    starMat.opacity=nightFactor;moonMat.opacity=nightFactor;stars.visible=moon.visible=nightFactor>.01;
    glow.emissiveIntensity=.10+nightFactor*1.8;lanternMat.emissiveIntensity=.10+nightFactor*.8;windowMat.emissiveIntensity=.07+nightFactor*1.2;
    for(const m of signMaterials)m.emissiveIntensity=.04+nightFactor*.4;
    hallBase=1.5+nightFactor*17;hallLight.intensity=hallBase;waterMat.uniforms.night.value=nightFactor;waterMat.uniforms.skyTint.value.copy(skyMat.uniforms.bottom.value);updateShadow({x:0,z:10});
  }
  const lightRight=new THREE.Vector3(),lightUp=new THREE.Vector3(),lightDirection=new THREE.Vector3(),shadowCenter=new THREE.Vector3(),focusV=new THREE.Vector3();
  function updateShadow(focus){const step=96/(high?2048:1024);lightDirection.copy(sunOffset).normalize();lightRight.crossVectors(new THREE.Vector3(0,1,0),lightDirection).normalize();lightUp.crossVectors(lightDirection,lightRight).normalize();focusV.set(focus?.x||0,0,focus?.z||0);
    shadowCenter.copy(lightRight).multiplyScalar(Math.round(focusV.dot(lightRight)/step)*step).addScaledVector(lightUp,Math.round(focusV.dot(lightUp)/step)*step).addScaledVector(lightDirection,focusV.dot(lightDirection));
    sun.target.position.copy(shadowCenter);sun.position.copy(shadowCenter).add(sunOffset);sun.target.updateMatrixWorld();
  }
  function update(dt,elapsed,focus){if(disposed)return;dt=clamp(Number(dt)||0,0,.1);elapsed=Number.isFinite(elapsed)?elapsed:lastElapsed+dt;lastElapsed=elapsed;
    waterMat.uniforms.time.value=elapsed;updateShadow(focus);updateLanterns(elapsed);
    const flicker=.94+.045*Math.sin(elapsed*13.1)+.025*Math.sin(elapsed*23.3);hallLight.intensity=hallBase*flicker;muLight.intensity=14*flicker;
    for(let i=0;i<candleFlames.length;i++){const f=candleFlames[i];f.scale.y=1+.13*Math.sin(elapsed*12+i*2.1);f.scale.x=1+.07*Math.cos(elapsed*9+i);}
    fallingEntries.forEach((e,i)=>{const y=7-((elapsed*(.25+(i%4)*.035)+i*.31)%7),x=e.p[0]+Math.sin(elapsed*.45+i)*.6,z=e.p[2]+Math.cos(elapsed*.33+i)*.3;scratch.position.set(x,y,z);scratch.rotation.set(elapsed*.6+i,elapsed*.45+i,Math.sin(elapsed+i));scratch.scale.set(...e.s);scratch.updateMatrix();fallingLeaves.setMatrixAt(i,scratch.matrix);});fallingLeaves.instanceMatrix.needsUpdate=true;
    for(let i=0;i<fishEntries.length;i++){const a=elapsed*(.055+i*.004)+i*TAU/fishEntries.length,x=-23+Math.sin(a)*(2.5+i*.23),z=-20+Math.cos(a)*(1.6+i*.13),yaw=Math.atan2(Math.cos(a),-Math.sin(a));scratch.position.set(x,-.14,z);scratch.rotation.set(0,yaw,0);scratch.scale.set(...fishEntries[i].s);scratch.updateMatrix();fish.setMatrixAt(i,scratch.matrix);scratch.position.x-=Math.sin(yaw)*.31;scratch.position.z-=Math.cos(yaw)*.31;scratch.rotation.set(PI/2,yaw+Math.sin(elapsed*3+i)*.18,0);scratch.scale.set(.10,.20,.025);scratch.updateMatrix();tails.setMatrixAt(i,scratch.matrix);}fish.instanceMatrix.needsUpdate=true;tails.instanceMatrix.needsUpdate=true;
    if(incenseLeft>0){incenseLeft=Math.max(0,incenseLeft-dt);incenseSticks.scale.y=incenseLeft/incenseDuration;incensePos.y=.87+.5*incenseSticks.scale.y;incenseSticks.visible=smoke.visible=incenseLeft>0;
      for(let i=0;i<smokeCount;i++){smokeAge[i]=(smokeAge[i]+dt*.22)%1;const a=smokeAge[i];smokeData[i*3]=-8+Math.sin(a*8+elapsed*.6+i*.2)*a*.16;smokeData[i*3+1]=incensePos.y+a*1.7;smokeData[i*3+2]=-1.4+Math.cos(a*6+elapsed*.4)*a*.13;}smokeGeo.attributes.position.needsUpdate=true;
    }
    if(bellAnim!==null){bellAnim+=dt;const t=bellAnim;
      if(t<.62)mallet.rotation.x=-.4*Math.sin(t/.62*PI/2);
      else if(t<.88)mallet.rotation.x=lerp(-.4,.21,((t-.62)/.26)**2);
      else {if(bellResolve){bellRinging=4.5;const done=bellResolve;bellResolve=null;bellPromise=null;done();}mallet.rotation.x=.21*Math.cos((t-.88)*7)*Math.exp(-(t-.88)*3);if(t>2.5){bellAnim=null;mallet.rotation.x=0;}}
    }
    if(bellRinging>0){bellRinging=Math.max(0,bellRinging-dt);bellSwing.rotation.x=Math.sin(elapsed*9)*.022*bellRinging/4.5;}
  }
  const spots={};function spot(id,x,z,yaw,r,label){spots[id]={id,x,z,y:heightAt(x,z),yaw,r,label};}
  spot('fork',0,49.5,PI,3.5,'이정표 보기');spot('fire-s',-8,15.8,PI,2.2,'불멍 하기');spot('fire-sw',-10.6,14.6,2.12,1.2,'불멍 하기');spot('fire-se',-5.4,14.6,-2.12,1.2,'불멍 하기');
  spot('pagoda',-8,8.6,PI,2.4,'탑돌이');spot('incense',-8,.2,PI,1.8,'향 올리기');cushions.forEach((p,i)=>spot('cushion-'+i,p.x,p.z,PI,.7,'참선하기'));
  spot('bell',4,3.6,PI,2.6,'범종 치기');spot('tea-seat',-21.2,6,-PI/2,2,'스님과 차담');spot('tea-maru',-18.7,3.6,PI/2,1.2,'툇마루에 앉기');spot('broom',8.5,-8.4,PI,1.8,'싸리비 들기');
  leafPiles.forEach((p,i)=>spot('leaf-'+i,p.x,p.z,0,1.6,'쓸기'));spot('lantern-desk',-11.2,20,-PI/2,2.4,'소원 연등 달기');
  spot('bench-ginkgo',11.6,14.2,-PI/2,1.4,'앉아 쉬기');spot('bench-river-n',-30.2,18,-PI/2,1.4,'앉아 쉬기');spot('bench-river-s',-30.2,-4,-PI/2,1.4,'앉아 쉬기');spot('pavilion',-15.2,-20,-PI/2,1.6,'정자에 앉기');
  spot('mujang-start',21.5,30.2,PI,2.6,'임종체험 시작하기');spot('portrait-seat',20.6,25.4,0,1,'영정 사진');spot('letter-desk',27,25.6,PI/2,1,'마지막 편지');spot('robe-rack',27,22.6,PI/2,1,'수의 입기');spot('coffin',24,26,PI,1,'입관');
  const places=[
    ['start','돌길 입구',0,58,3,'돌길을 따라 산사로 들어오세요.'],['fork','갈림길',0,50,3,'두 산문으로 길이 나뉘어요.'],['ilju','일주문',-8,46.5,2.5,'몽산사의 첫 산문이에요.'],['musang-gate','무상문',9,46.5,2.5,'삶을 돌아보는 무상당으로 이어져요.'],
    ['lantern','연등길',-8,30,4,'소원을 담은 연등이 바람에 흔들려요.'],['yard','마당',-3,12,8,'잠시 발걸음을 늦추어 보세요.'],['fire','불멍 터',-8,16.6,3.5,'통나무 의자에 앉아 불을 바라보는 곳이에요.'],['pagoda','삼층석탑',-8,9,4,'돌탑을 천천히 돌아보세요.'],
    ['hall','대웅전',-8,-8,6,'방석에 앉아 숨을 가다듬어 보세요.'],['bell','범종각',4,3.6,3,'범종의 깊은 울림을 느껴 보세요.'],['tea','다실',-21.2,6,4,'스님과 따뜻한 차 한 잔을 나누어요.'],['yosa','요사채',12,-8,6,'산사 식구들이 머무는 집이에요.'],
    ['ginkgo','은행나무',11,14.5,4,'노란 잎 아래에서 쉬어 가세요.'],['gotgam','감나무 덕장',16.5,-5,5,'가을 햇살에 곶감이 익어 가요.'],['pond','연못',-15.5,-17,8,'물결과 잉어를 바라보세요.'],['bamboo','대나무숲',-22,-34,9,'대나무 사이로 바람이 지나가요.'],
    ['river','강변 산책로',-30,8,6,'개울을 따라 천천히 걸어요.'],['mujang','무상당',24,29.5,5,'지금의 삶을 돌아보는 곳이에요.'],['haetal','해탈문',3.8,26,2.5,'다시 산사 마당으로 이어져요.']
  ].map(([id,name,x,z,r,desc])=>({id,name,desc,x,z,r}));
  const placeAt=(x,z)=>{let best=null,r=Infinity;for(const p of places)if(p.r<r&&(x-p.x)**2+(z-p.z)**2<=p.r*p.r){best=p.id;r=p.r;}return best;};
  const mapUV=(x,z)=>({u:(x-BOUNDS.minX)/(BOUNDS.maxX-BOUNDS.minX),v:(z-BOUNDS.minZ)/(BOUNDS.maxZ-BOUNDS.minZ)});
  function drawMap(ctx,w,h){ctx.save();ctx.clearRect(0,0,w,h);ctx.fillStyle='#f3efe5';ctx.fillRect(0,0,w,h);const sx=w/80,sz=h/104;ctx.translate(44*sx,42*sz);ctx.scale(sx,sz);
    ctx.fillStyle='#e0dfc7';ctx.fillRect(-44,-42,80,104);ctx.fillStyle='#ede3cd';ctx.fillRect(-20,-4,26,22);
    // Fixed hash for paper grain: drawing the map never alters the world RNG.
    ctx.fillStyle='#c4b89a';for(let i=0;i<600;i++){const x=((i*73.31)%80)-44,z=((i*41.17)%104)-42;ctx.globalAlpha=.13;ctx.fillRect(x,z,.11,.16);}ctx.globalAlpha=1;
    ctx.strokeStyle='#9fbab3';ctx.lineWidth=3.2;ctx.beginPath();for(let z=-42;z<=62;z++)z===-42?ctx.moveTo(riverX(z),z):ctx.lineTo(riverX(z),z);ctx.stroke();
    ctx.fillStyle='#a9bdb0';ctx.beginPath();for(let i=0;i<=64;i++){const a=i*TAU/64,x=-23+Math.cos(a)*5.65*pondRadius(a),z=-20+Math.sin(a)*4.15*pondRadius(a);i?ctx.lineTo(x,z):ctx.moveTo(x,z);}ctx.closePath();ctx.fill();ctx.strokeStyle='#7b927c';ctx.lineWidth=.22;ctx.stroke();
    for(const [a,b,width] of roadSegments){ctx.strokeStyle='#c3b59b';ctx.lineWidth=width;ctx.lineCap='round';ctx.beginPath();ctx.moveTo(...a);ctx.lineTo(...b);ctx.stroke();}
    for(const t of treeRecords){ctx.fillStyle=t.type==='pine'?'#718266':t.type==='ginkgo'?'#d5b956':'#c38659';ctx.globalAlpha=.72;ctx.beginPath();ctx.arc(t.x,t.z,t.size*.85,0,TAU);ctx.fill();}ctx.globalAlpha=1;
    ctx.fillStyle='#899874';for(let i=0;i<80;i++){const x=-30+(i*2.17)%17,z=-40+(i*3.61)%12;if(nearRoad(x,z))continue;ctx.fillRect(x,z,.18,.8);}
    ctx.strokeStyle='#676b5d';ctx.lineWidth=.65;for(const [a,b] of [[[-37,44],[-10.1,44]],[[-5.9,44],[7.5,44]],[[10.5,44],[36,44]],[[5,18],[36,18]],[[5,18],[5,25]],[[5,27],[5,44]]]){ctx.beginPath();ctx.moveTo(...a);ctx.lineTo(...b);ctx.stroke();}
    const structures=[[-8,-10,16,10,'大雄殿'],[-23,6,10,7,'茶'],[12,-13,15,6,'寮'],[24,24,10,7,'無常堂'],[-8,45,6,3,'夢山寺'],[9,45,4,3,'無常門'],[5,26,2.3,3,'解脫門'],[4,2,5,5,'鐘'],[-15.2,-20,4,4,'亭']];
    for(const [x,z,ww,dd,text] of structures){ctx.fillStyle='#626b65';ctx.fillRect(x-ww/2,z-dd/2,ww,dd);ctx.strokeStyle='#3f4b42';ctx.lineWidth=.23;ctx.strokeRect(x-ww/2,z-dd/2,ww,dd);ctx.beginPath();ctx.moveTo(x-ww/2,z);ctx.lineTo(x+ww/2,z);ctx.stroke();ctx.fillStyle='#f0dec1';ctx.font='1.15px "Noto Serif KR",serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,x,z,ww-.5);}
    ctx.fillStyle='#9b9c8a';ctx.fillRect(-9.1,3.9,2.2,2.2);ctx.strokeStyle='#b9ae8e';ctx.lineWidth=.3;ctx.beginPath();ctx.arc(-8,5,3.4,0,TAU);ctx.stroke();ctx.fillStyle='#b76f46';ctx.beginPath();ctx.arc(-8,13,1.2,0,TAU);ctx.fill();
    for(let i=0;i<108;i++){const p=lanternEntries[i].p;ctx.fillStyle=lanternState[i].color===null?'#d5a69a':LANTERN_COLORS[lanternState[i].color];ctx.beginPath();ctx.arc(p[0],p[2],.18,0,TAU);ctx.fill();}
    ctx.restore();
  }
  flush();
  for(const [parent,geos] of windowParts){const g=mergeGeometries(geos,false);geos.forEach(v=>v.dispose());ownedGeometry.add(g);const m=new THREE.Mesh(g,windowMat);m.castShadow=m.receiveShadow=true;parent.add(m);}
  // Every pickable descendant has its own data, even dynamic subgroups.
  pickRoot.traverse(o=>{if(!o.isMesh)return;if(!o.userData.pick){let p=o.parent;while(p&&!p.userData.pick)p=p.parent;if(p)o.userData.pick={...p.userData.pick};}});
  indexCollisions();
  await stage(.91,'산문 앞 첫 화면을 그리고 있어요');
  const world={root,pickRoot,colliders,cameraBlockers,bounds:BOUNDS,spots,places,heightAt,surfaceAt,zoneAt,blocked,raycastGround,placeAt,blockedFixed,treeFree,mapUV,drawMap,
    startPos:{x:0,z:58,yaw:PI},pagodaRing:{x:-8,z:5,r:3.4},fireCenter,woodpilePos,catFireSpot:{x:-7,z:15.3},
    npc:{abbot:{x:-12.2,z:-11.2,yaw:PI},tea:{x:-24,z:6,yaw:PI/2},guide:{x:20.4,z:29.4,yaw:0},fireGuest:{x:-5.4,z:14.6,yaw:-2.12}},
    paths:{cat:[{x:-15.2,z:-20},{x:-15.2,z:-17},{x:-17.2,z:-16.5},{x:-17.2,z:-3.5},{x:-14,z:-3},{x:-13,z:17.5},{x:-3,z:17.5},{x:0,z:15.7},{x:7,z:15},{x:11.6,z:14.2},{x:7,z:15},{x:0,z:15.7},{x:-3,z:17.5},{x:-13,z:17.5},{x:-17.2,z:-3.5},{x:-17.2,z:-16.5},{x:-15.2,z:-17}],
      novice:[{x:-16.2,z:16.8},{x:-2,z:17.3},{x:1,z:14},{x:0,z:6},{x:-2,z:-2.8},{x:-13,z:-2.8},{x:-17,z:0}]},
    setTime,get nightFactor(){return nightFactor;},update,setShadows(on){sun.castShadow=!!on;},
    setCutaway(name){for(const [id,g] of Object.entries(cutaways))g.visible=id!==name;},
    lanternSlots:108,setLantern,lanternPos,makeLantern,leafPiles,setLeafPile,showLeafMarkers(on){leafMarkers.visible=!!on;},
    lightIncense(sec=600){incenseDuration=Math.max(.01,Number(sec)||600);incenseLeft=incenseDuration;incenseSticks.visible=smoke.visible=true;incenseSticks.scale.y=1;incensePos.y=1.37;for(let i=0;i<smokeCount;i++)smokeAge[i]=i/smokeCount;},incensePos,
    strikeBell(){if(bellPromise)return null;bellAnim=0;bellPromise=new Promise(resolve=>{bellResolve=resolve;});return bellPromise;},bellPos,
    teaPour,teaCupVisible(on){teaCup.visible=!!on;},teaCupPos,kettlePos,
    hall:{floorY:1.25,cushions,candlePos:new THREE.Vector3(-11.4,3.04,-12.1)},
    mujang:{floorY:.75,setLid,setPortrait(texture){portraitMat.map=texture||null;portraitMat.color.set(texture?'#ffffff':'#d9d4c4');portraitMat.needsUpdate=true;},showEnvelope(on){envelope.visible=!!on;},coffinCenter(i){return new THREE.Vector3(22.2+clamp(Math.floor(i)||0,0,2)*1.8,1.03,24);},portraitCamPos},signboards,
    // Optional lifecycle for the test page and graphics-quality rebuilds. Supplied portrait textures remain caller-owned.
    dispose(){if(disposed)return;disposed=true;root.removeFromParent();if(scene.fog===world.fog)scene.fog=previousFog;ownedGeometry.forEach(g=>g.dispose());ownedMaterials.forEach(m=>m.dispose());ownedTextures.forEach(t=>t.dispose());statues.forEach(g=>g.userData.dispose());sun.shadow.map?.dispose();if(bellResolve){bellResolve();bellResolve=null;}},fog:scene.fog
  };
  setTime((Date.now()/3600000+9)%24);update(0,0,{x:0,z:58});root.updateMatrixWorld(true);
  await stage(1,'산문 앞 첫 화면을 그리고 있어요');return world;
}
