import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENGINE_PORT_BASE, loadConfig } from './config.mjs';
import { ensureLlamaCpp } from './runtime-installer.mjs';
import { ensurePythonAiRuntime } from './python-runtime.mjs';
import { getInstalled } from './library.mjs';
import { hardwareInfo, estimateModelMemory } from './hardware.mjs';

const instances = new Map();
let nextPort = ENGINE_PORT_BASE;
let sweepTimer = null;

function pushLog(inst,line){inst.logs.push(String(line));if(inst.logs.length>250)inst.logs=inst.logs.slice(-250);}
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
async function waitReady(inst,timeout=180000){const start=Date.now();while(Date.now()-start<timeout){if(inst.proc?.exitCode!=null)throw new Error(`${inst.model.runtime||'runtime'} kapandı. ${inst.logs.slice(-10).join('\n')}`);try{const r=await fetch(`http://127.0.0.1:${inst.port}/health`);if(r.ok)return;}catch{}await sleep(350);}throw new Error(`${inst.model.runtime||'runtime'} zaman aşımına uğradı.`);}
function normalizeLoadOptions(o={}){return {context:Number(o.context_length??o.context??o.ctx??8192),gpuLayers:Number(o.gpu_layers??o.gpuLayers??999),threads:o.threads?Number(o.threads):undefined,batch:Number(o.eval_batch_size??o.batch??512),ubatch:Number(o.ubatch??256),parallel:Number(o.parallel??1),flashAttention:o.flash_attention??o.flashAttention??true,kvOffload:o.offload_kv_cache_to_gpu??o.kvOffload??true,cacheTypeK:String(o.cache_type_k??o.cacheTypeK??'f16'),cacheTypeV:String(o.cache_type_v??o.cacheTypeV??'f16'),fit:o.fit!==false,vramOnly:Boolean(o.vram_only??o.vramOnly??false),embedding:Boolean(o.embedding),reranking:Boolean(o.reranking),ttl:o.ttl===0?0:Number(o.ttl||0),jit:Boolean(o.jit)};}
function argsFor(model,port,o){
  const args=['-m',model.localPath,'--host','127.0.0.1','--port',String(port),'--ctx-size',String(Math.max(512,o.context)),'--jinja','--reasoning-format','deepseek','--reasoning','auto','--parallel',String(Math.max(1,o.parallel)),'--batch-size',String(Math.max(32,o.batch)),'--ubatch-size',String(Math.max(16,o.ubatch)),'--cache-type-k',o.cacheTypeK,'--cache-type-v',o.cacheTypeV,'--flash-attn',o.flashAttention?'on':'off'];
  const gpuLayers=o.vramOnly?999:o.gpuLayers;
  if(gpuLayers!==0)args.push('-ngl',String(gpuLayers)); else args.push('-ngl','0');
  if(model.mmprojPath)args.push('--mmproj',model.mmprojPath);
  if(o.threads)args.push('--threads',String(o.threads));
  if(!o.kvOffload)args.push('--no-kv-offload');
  if(o.fit&&!o.vramOnly)args.push('--fit','on');
  if(o.embedding)args.push('--embedding');
  if(o.reranking)args.push('--reranking');
  return args;
}
function workerPath(name){let p=fileURLToPath(new URL(`./${name}`,import.meta.url));if(p.includes('app.asar'+path.sep))p=p.replace('app.asar'+path.sep,'app.asar.unpacked'+path.sep);return p;}
async function evictIfNeeded(requestedId,o){
  const cfg=await loadConfig();
  const running=[...instances.values()].filter(i=>i.proc&&i.proc.exitCode==null&&i.id!==requestedId);
  if(o.jit&&cfg.autoEvict&&cfg.keepOnlyLastJit){for(const i of running.filter(i=>i.jit))await unloadModel(i.id);return;}
  const max=Math.max(1,Number(cfg.maxLoadedModels||2));
  while([...instances.values()].filter(i=>i.proc&&i.proc.exitCode==null).length>=max){
    if(!cfg.autoEvict) throw new Error(`Yüklü model limiti (${max}) dolu ve Auto-Evict kapalı.`);
    const victim=[...instances.values()].filter(i=>i.id!==requestedId&&!i.busy).sort((a,b)=>a.lastUsed-b.lastUsed)[0];if(!victim)throw new Error('Tüm model instance’ları meşgul; evict edilecek idle model yok.');await unloadModel(victim.id);
  }
}
function startSweeper(){if(sweepTimer)return;sweepTimer=setInterval(()=>{const now=Date.now();for(const i of instances.values()){if(i.ttl>0&&!i.busy&&now-i.lastUsed>i.ttl*1000)void unloadModel(i.id);}},15000);sweepTimer.unref?.();}
export async function loadModel(id,options={}){
  const existing=instances.get(id);if(existing?.proc&&existing.proc.exitCode==null){if(options.force_reload||options.reload){await unloadModel(id);}else{existing.lastUsed=Date.now();if(options.ttl!==undefined)existing.ttl=Math.max(0,Number(options.ttl)||0);return describe(existing);}}
  const model=await getInstalled(id);if(!model)throw new Error('Model kurulu değil.');if(!['llama.cpp','transformers-python'].includes(model.runtime))throw new Error(`Bu model sohbet runtime'ı ile çalışmıyor: ${model.runtime||'bilinmiyor'}`);
  const o=normalizeLoadOptions(options);const cfg=await loadConfig();if(o.jit&&!o.ttl)o.ttl=Number(cfg.defaultTtl||3600);await evictIfNeeded(id,o);
  const port=nextPort++;const inst={id,port,proc:null,logs:[],options:o,jit:o.jit,ttl:o.ttl,lastUsed:Date.now(),busy:false,startedAt:Date.now(),model};
  if(model.runtime==='transformers-python'){
    const python=await ensurePythonAiRuntime('transformers');
    const root=model.localDir||model.localPath;
    const args=[workerPath('transformers_worker.py'),'--model',root,'--port',String(port)];if(o.embedding||model.embedding)args.push('--embedding');if(o.vramOnly)args.push('--vram-only');
    inst.proc=spawn(python,args,{windowsHide:true,stdio:['ignore','pipe','pipe']});
  }else{
    const exe=await ensureLlamaCpp();
    inst.proc=spawn(exe,argsFor(model,port,o),{windowsHide:true,stdio:['ignore','pipe','pipe']});
  }
  inst.proc.stdout.on('data',d=>pushLog(inst,d));inst.proc.stderr.on('data',d=>pushLog(inst,d));inst.proc.on('exit',()=>{instances.delete(id);});instances.set(id,inst);
  try{await waitReady(inst);}catch(e){await unloadModel(id);throw e;}startSweeper();return describe(inst);
}
export async function unloadModel(id){
  if(!id){for(const k of [...instances.keys()])await unloadModel(k);return true;}const inst=instances.get(id);if(!inst)return false;instances.delete(id);if(inst.proc&&inst.proc.exitCode==null){inst.proc.kill('SIGTERM');await sleep(500);if(inst.proc.exitCode==null)inst.proc.kill('SIGKILL');}return true;
}
export async function ensureLoaded(id,options={}){let inst=instances.get(id);if(inst?.proc&&inst.proc.exitCode==null){const needsEmbedding=Boolean(options.embedding)&&!inst.options.embedding;const needsRerank=Boolean(options.reranking)&&!inst.options.reranking;if(needsEmbedding||needsRerank){const carry={...inst.options,...options,force_reload:true,jit:options.jit??inst.jit};await unloadModel(id);await loadModel(id,carry);inst=instances.get(id);}else{inst.lastUsed=Date.now();if(options.ttl!==undefined)inst.ttl=Math.max(0,Number(options.ttl)||0);}}else{await loadModel(id,{...options,jit:options.jit??true});inst=instances.get(id);}return inst;}
export function touchModel(id,busy=false){const i=instances.get(id);if(i){i.lastUsed=Date.now();i.busy=busy;}}
export function getInstance(id){return instances.get(id)||null;}
export function instanceUrl(id){const i=getInstance(id);if(!i)throw new Error('Model yüklü değil.');return `http://127.0.0.1:${i.port}`;}
export function runtimeState(){return {loadedModelId:[...instances.keys()][0]||null,running:instances.size>0,instances:[...instances.values()].map(describe)};}
function describe(i){return {id:i.id,instance_id:i.id,status:'loaded',runtime:i.model.runtime,pid:i.proc?.pid||null,port:i.port,context:i.options.context,embedding:i.options.embedding,reranking:i.options.reranking,jit:i.jit,ttl:i.ttl,lastUsed:i.lastUsed,load_time_seconds:(Date.now()-i.startedAt)/1000,load_config:{context_length:i.options.context,eval_batch_size:i.options.batch,flash_attention:i.options.flashAttention,offload_kv_cache_to_gpu:i.options.kvOffload,gpu_layers:i.options.vramOnly?999:i.options.gpuLayers,vram_only:i.options.vramOnly,parallel:i.options.parallel,cache_type_k:i.options.cacheTypeK,cache_type_v:i.options.cacheTypeV},logs:i.logs.slice(-50)};}
export async function modelEstimate(id,options={}){const model=await getInstalled(id);if(!model)throw new Error('Model kurulu değil.');const hw=await hardwareInfo();return {hardware:hw,estimate:estimateModelMemory(model,{...normalizeLoadOptions(options),kvOffload:normalizeLoadOptions(options).kvOffload},hw)};}
