import crypto from 'node:crypto';
import { loadConfig, readJson, MCP_FILE } from './config.mjs';

const MODERN='2026-07-28', LEGACY='2025-06-18';
function safeName(s){return String(s||'mcp').replace(/[^A-Za-z0-9_.-]+/g,'-').slice(0,48);}
class HttpMcp {
  constructor(def){this.def=def;this.url=def.url;this.headers={...(def.headers||{})};this.session='';this.protocol=MODERN;this.modern=true;}
  async req(method,params={},notification=false,toolName=''){
    const id=notification?undefined:crypto.randomUUID();const body={jsonrpc:'2.0',method,params};if(id)body.id=id;
    const headers={'content-type':'application/json',accept:'application/json, text/event-stream',...this.headers};
    if(this.modern){headers['MCP-Protocol-Version']=MODERN;headers['Mcp-Method']=method;if(toolName)headers['Mcp-Name']=toolName;}else if(this.session){headers['Mcp-Session-Id']=this.session;headers['MCP-Protocol-Version']=LEGACY;}
    const r=await fetch(this.url,{method:'POST',headers,body:JSON.stringify(body)});if(!r.ok&&r.status!==202)throw new Error(`MCP ${r.status}: ${await r.text()}`);
    if(notification||r.status===202)return null;const sid=r.headers.get('mcp-session-id');if(sid)this.session=sid;
    const ct=r.headers.get('content-type')||'';let data;if(ct.includes('text/event-stream')){const text=await r.text();const lines=text.split(/\r?\n/).filter(x=>x.startsWith('data:'));data=JSON.parse(lines.at(-1)?.slice(5).trim()||'{}');}else data=await r.json();
    if(data?.error){const e=new Error(data.error.message||'MCP RPC error');e.code=data.error.code;throw e;}return data?.result;
  }
  async init(){
    try{await this.req('server/discover',{});this.modern=true;this.protocol=MODERN;return;}catch(e){if(e.code!==-32601&&!/method not found/i.test(e.message))throw e;}
    this.modern=false;this.protocol=LEGACY;await this.req('initialize',{protocolVersion:LEGACY,capabilities:{},clientInfo:{name:'FlexLab',version:'0.4.0'}});await this.req('notifications/initialized',{},true);
  }
  listTools(){return this.req('tools/list',{});} callTool(name,args){return this.req('tools/call',{name,arguments:args||{}},false,name);} close(){return Promise.resolve();}
}
function convert(def,serverName){const fn=safeName(serverName);return (def.tools||[]).map(t=>({type:'function',function:{name:`mcp__${fn}__${safeName(t.name)}`,description:t.description||`MCP tool ${t.name}`,parameters:t.inputSchema||{type:'object',properties:{}}},_mcp:{server:serverName,raw:t.name}}));}
export async function buildMcpToolset(integrations=[],includeConfigured=false){
  const cfg=await loadConfig();const defs=[];
  if(includeConfigured&&cfg.allowConfiguredMcp){const file=await readJson(MCP_FILE,{servers:[]});defs.push(...(Array.isArray(file)?file:file.servers||[]));}
  for(const i of integrations||[])if(i?.url&&['ephemeral_mcp','mcp'].includes(i.type||'ephemeral_mcp'))defs.push(i);
  const clients=new Map(),tools=[];
  for(const d of defs.slice(0,12)){const name=safeName(d.name||new URL(d.url).hostname);const c=new HttpMcp(d);await c.init();const listed=await c.listTools();clients.set(name,c);for(const t of convert(listed||{},name))tools.push(t);}
  return {tools,async execute(call){const fn=call?.function?.name||'';const tool=tools.find(t=>t.function.name===fn);if(!tool)throw new Error(`MCP tool bulunamadı: ${fn}`);let args={};try{args=JSON.parse(call.function.arguments||'{}');}catch{}const c=clients.get(tool._mcp.server);return c.callTool(tool._mcp.raw,args);},close(){for(const c of clients.values())void c.close();}};
}
