import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { buildMcpToolset } from '../native/mcp.mjs';

function listen(handler){return new Promise((resolve)=>{const s=http.createServer(handler);s.listen(0,'127.0.0.1',()=>resolve(s));});}
function close(s){return new Promise((resolve)=>s.close(resolve));}
async function rawBody(req){const a=[];for await(const c of req)a.push(c);return JSON.parse(Buffer.concat(a).toString('utf8')||'{}');}
function rpc(res,id,result,status=200,headers={}){const body=JSON.stringify({jsonrpc:'2.0',id,result});res.writeHead(status,{'content-type':'application/json',...headers});res.end(body);}
function rpcError(res,id,code,message){const body=JSON.stringify({jsonrpc:'2.0',id,error:{code,message}});res.writeHead(200,{'content-type':'application/json'});res.end(body);}

async function exerciseMcp(mode){
  let session='';const seen=[];
  const server=await listen(async(req,res)=>{
    const body=await rawBody(req);seen.push({method:body.method,headers:req.headers,params:body.params});
    if(mode==='modern'){
      assert.equal(req.headers['mcp-protocol-version'],'2026-07-28');
      assert.equal(req.headers['mcp-method'],body.method);
      if(body.method==='server/discover')return rpc(res,body.id,{protocolVersion:'2026-07-28',capabilities:{tools:{}}});
      if(body.method==='tools/list')return rpc(res,body.id,{tools:[{name:'echo',description:'Echo',inputSchema:{type:'object',properties:{text:{type:'string'}}}}]});
      if(body.method==='tools/call'){assert.equal(req.headers['mcp-name'],'echo');return rpc(res,body.id,{content:[{type:'text',text:body.params.arguments.text}]});}
    }else{
      if(body.method==='server/discover')return rpcError(res,body.id,-32601,'Method not found');
      if(body.method==='initialize'){session='legacy-session';return rpc(res,body.id,{protocolVersion:'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'mock',version:'1'}},200,{'mcp-session-id':session});}
      if(body.method==='notifications/initialized'){assert.equal(req.headers['mcp-session-id'],session);res.writeHead(202);return res.end();}
      assert.equal(req.headers['mcp-session-id'],session);
      if(body.method==='tools/list')return rpc(res,body.id,{tools:[{name:'echo',inputSchema:{type:'object',properties:{text:{type:'string'}}}}]});
      if(body.method==='tools/call')return rpc(res,body.id,{content:[{type:'text',text:body.params.arguments.text}]});
    }
    rpcError(res,body.id,-32601,'Method not found');
  });
  try{
    const addr=server.address();const toolset=await buildMcpToolset([{type:'ephemeral_mcp',name:`${mode}-srv`,url:`http://127.0.0.1:${addr.port}/mcp`}],false);
    assert.equal(toolset.tools.length,1);const call={id:'1',type:'function',function:{name:`mcp__${mode}-srv__echo`,arguments:JSON.stringify({text:'hello'})}};
    const result=await toolset.execute(call);assert.equal(result.content[0].text,'hello');toolset.close();
    assert.ok(seen.some(x=>x.method==='tools/list'));assert.ok(seen.some(x=>x.method==='tools/call'));
  }finally{await close(server);}
}

test('MCP 2026-07-28 stateless HTTP works',()=>exerciseMcp('modern'));
test('MCP legacy HTTP fallback works',()=>exerciseMcp('legacy'));

test('native daemon separates management access from public API',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'flexlab-test-'));const token='test-'+Math.random().toString(36).slice(2);const port=18000+Math.floor(Math.random()*1000);
  const child=spawn(process.execPath,['native/server.mjs'],{cwd:path.resolve('.'),env:{...process.env,FLEXLAB_HOME:root,FLEXLAB_PORT:String(port),FLEXLAB_MANAGEMENT_TOKEN:token},stdio:['ignore','pipe','pipe']});let logs='';child.stdout.on('data',d=>logs+=d);child.stderr.on('data',d=>logs+=d);
  try{
    let ready=false;for(let i=0;i<60;i++){try{const r=await fetch(`http://127.0.0.1:${port}/health`);if(r.ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}assert.ok(ready,`daemon not ready: ${logs}`);
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/server`)).status,403);
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/server`,{headers:{'x-flexlab-management-token':token}})).status,200);
    assert.equal((await fetch(`http://127.0.0.1:${port}/v1/models`)).status,503);
    assert.equal((await fetch(`http://127.0.0.1:${port}/v1/models`,{headers:{'x-flexlab-management-token':token}})).status,200);
  }finally{child.kill('SIGTERM');await new Promise(r=>setTimeout(r,150));if(child.exitCode==null)child.kill('SIGKILL');await fs.rm(root,{recursive:true,force:true});}
});
