import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execFileAsync=promisify(execFile);

async function nvidiaGpus(){
  try{
    const cmd=process.platform==='win32'?'nvidia-smi.exe':'nvidia-smi';
    const {stdout}=await execFileAsync(cmd,['--query-gpu=name,memory.total,memory.free,compute_cap','--format=csv,noheader,nounits'],{timeout:4000,windowsHide:true});
    return stdout.trim().split(/\r?\n/).filter(Boolean).map((line,i)=>{const [name,total,free,cc]=line.split(',').map(s=>s.trim());return {index:i,vendor:'NVIDIA',name,totalVramBytes:Number(total)*1024*1024,freeVramBytes:Number(free)*1024*1024,computeCapability:cc};});
  }catch{return[];}
}
async function linuxDrmGpus(){
  if(process.platform!=='linux')return[];const root='/sys/class/drm';const out=[];
  for(const ent of await fs.readdir(root,{withFileTypes:true}).catch(()=>[])){
    if(!ent.isDirectory()||!/^card\d+$/.test(ent.name))continue;const dev=path.join(root,ent.name,'device');
    try{
      const vendorHex=(await fs.readFile(path.join(dev,'vendor'),'utf8')).trim().toLowerCase();
      if(vendorHex==='0x10de')continue;
      const vendor=vendorHex==='0x1002'?'AMD':vendorHex==='0x8086'?'Intel':'GPU';
      const total=Number((await fs.readFile(path.join(dev,'mem_info_vram_total'),'utf8').catch(()=>'' )).trim()||0);
      const used=Number((await fs.readFile(path.join(dev,'mem_info_vram_used'),'utf8').catch(()=>'' )).trim()||0);
      const name=(await fs.readFile(path.join(dev,'product_name'),'utf8').catch(()=>`${vendor} ${ent.name}`)).trim();
      out.push({index:out.length,vendor,name,totalVramBytes:total||0,freeVramBytes:total?Math.max(0,total-used):0});
    }catch{}
  }
  return out;
}
async function windowsGpus(){
  if(process.platform!=='win32')return[];
  try{
    const script="Get-CimInstance Win32_VideoController | Select-Object Name,AdapterRAM,PNPDeviceID | ConvertTo-Json -Compress";
    const {stdout}=await execFileAsync('powershell.exe',['-NoProfile','-Command',script],{timeout:5000,windowsHide:true,maxBuffer:1024*1024});
    const raw=JSON.parse(stdout.trim()||'[]');const rows=Array.isArray(raw)?raw:[raw];
    return rows.filter(Boolean).map((r,i)=>{const n=String(r.Name||'GPU');const vendor=/nvidia/i.test(n)?'NVIDIA':/amd|radeon/i.test(n)?'AMD':/intel/i.test(n)?'Intel':'GPU';const total=Number(r.AdapterRAM||0);return{index:i,vendor,name:n,totalVramBytes:total,freeVramBytes:0,approximate:true};});
  }catch{return[];}
}
async function macGpus(){
  if(process.platform!=='darwin')return[];
  try{
    const {stdout}=await execFileAsync('system_profiler',['SPDisplaysDataType','-json'],{timeout:8000,maxBuffer:2*1024*1024});const d=JSON.parse(stdout);const rows=d.SPDisplaysDataType||[];
    return rows.map((r,i)=>({index:i,vendor:/apple/i.test(String(r.sppci_vendor||r._name||''))?'Apple':'GPU',name:String(r.sppci_model||r._name||'Apple GPU'),totalVramBytes:os.totalmem(),freeVramBytes:os.freemem(),unifiedMemory:true}));
  }catch{return process.arch==='arm64'?[{index:0,vendor:'Apple',name:'Apple GPU',totalVramBytes:os.totalmem(),freeVramBytes:os.freemem(),unifiedMemory:true}]:[];}
}
function dedupeGpus(rows){const out=[];for(const g of rows){if(out.some(x=>x.name.toLowerCase()===String(g.name).toLowerCase()))continue;out.push({...g,index:out.length});}return out;}
export async function hardwareInfo(){
  const [nv,drm,win,mac]=await Promise.all([nvidiaGpus(),linuxDrmGpus(),windowsGpus(),macGpus()]);const gpus=dedupeGpus([...nv,...drm,...win,...mac]);
  return {platform:process.platform,arch:process.arch,cpu:{model:os.cpus()?.[0]?.model||'Unknown',logicalCores:os.cpus().length},memory:{totalBytes:os.totalmem(),freeBytes:os.freemem()},gpus};
}
export function estimateModelMemory(model,{context=8192,gpuLayers=999,parallel=1,cacheTypeK='f16',cacheTypeV='f16',kvOffload=true}={},hw=null){
  const weights=Number(model?.quant?.sizeBytes||model?.sizeBytes||0);const ctx=Math.max(512,Number(context)||8192);const par=Math.max(1,Number(parallel)||1);
  const quantFactor=(x)=>String(x).startsWith('q8')?0.55:String(x).startsWith('q4')?0.3:1;const kvFactor=(quantFactor(cacheTypeK)+quantFactor(cacheTypeV))/2;
  const hidden=Number(model?.metadata?.embeddingLength||model?.embeddingLength||4096);const layers=Math.max(1,Number(model?.metadata?.blockCount||model?.blockCount||32));
  const kv=Math.round(ctx*hidden*4*par*kvFactor*1.15);const overhead=Math.max(512*1024*1024,Math.round(weights*0.08));
  const gl=Number(gpuLayers);const gpuFraction=gl<=0?0:gl>=999?1:Math.min(1,gl/layers);const gpuWeights=Math.round(weights*gpuFraction);const cpuWeights=weights-gpuWeights;
  const gpuKv=kvOffload&&gpuFraction>0?kv:0;const ramKv=kv-gpuKv;const gpuBytes=Math.round(gpuWeights+gpuKv+overhead*0.35);const ramBytes=Math.round(cpuWeights+ramKv+overhead*0.75);
  const total=weights+kv+overhead;const unified=hw?.gpus?.some(g=>g.unifiedMemory);const vram=hw?.gpus?.reduce((n,g)=>n+Number(g.freeVramBytes||0),0)||0;const freeRam=Number(hw?.memory?.freeBytes||0);
  return {weightsBytes:weights,kvBytes:kv,overheadBytes:overhead,totalBytes:total,estimatedVramBytes:gpuBytes,estimatedRamBytes:ramBytes,gpuFraction,blockCount:layers,fitsVram:unified?(gpuBytes+ramBytes<=freeRam):(vram?gpuBytes<=vram:null),fitsRam:unified?(gpuBytes+ramBytes<=freeRam):ramBytes<=freeRam};
}
